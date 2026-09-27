import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeServer } from '../test/fake-server'
import { db, wipeLocalData } from './db'
import { __resetSyncEngineForTests, ensureDefaultSpace, runSync, requestAttachmentPrefetch } from './sync'
import { getAppState } from './app-state'
import { addLocalAttachment, updateNoteLocal, deleteLocalAttachment } from './local-writes'
import { processNextJob, retryFailedJobs, MAX_ATTEMPTS } from './jobs-worker'
import { recoverLegacyConflicts, CONFLICT_TAG } from './sync-push'
import type { NoteRecord } from './types'

let server: FakeServer

async function localNote(spaceId: number, text: string, extra: Partial<NoteRecord> = {}): Promise<number> {
  const now = new Date().toISOString()
  return db.notes.add({ spaceId, title: null, text, tags: [], createdAt: now, modifiedAt: now, date: now, parentId: null, deletedAt: null, isDirty: 1, serverId: null, clientId: crypto.randomUUID(), ...extra })
}

async function drainJobs(max = 20) {
  for (let i = 0; i < max; i++) {
    const r = await processNextJob()
    if (r !== 'did') return r
  }
  return 'did'
}

beforeEach(async () => {
  server = new FakeServer()
  vi.stubGlobal('fetch', server.fetch)
  localStorage.clear()
  localStorage.setItem('authToken', 'test-token')
  __resetSyncEngineForTests()
  await wipeLocalData()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('push', () => {
  it('creates notes on the server and records server id + version', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'hello')
    await runSync(true)

    const local = (await db.notes.get(id))!
    expect(local.serverId).toBeTypeOf('number')
    expect(local.isDirty).toBe(0)
    expect(local.serverModifiedAt).toBe(server.notes.get(local.serverId!)!.modified_at)
    expect([...server.notes.values()].map(n => n.text)).toEqual(['hello'])
  })

  it('sends the parent server id for a reply created before its parent was synced', async () => {
    const space = await ensureDefaultSpace()
    // Make local and server ids diverge, as on any second device.
    server.addNote('someone else', { user_id: 99 })
    server.addNote('someone else 2', { user_id: 99 })
    const parent = await localNote(space, 'parent')
    const reply = await localNote(space, 'reply', { parentId: parent })

    await runSync(true)

    const p = (await db.notes.get(parent))!
    const r = (await db.notes.get(reply))!
    expect(p.serverId).not.toBe(parent)
    expect(server.notes.get(r.serverId!)!.parent_id).toBe(p.serverId)
    expect(r.parentId).toBe(parent)
    expect(r.parentServerId).toBe(p.serverId)
    expect(r.isDirty).toBe(0)
  })

  it('keeps a note dirty when it is edited while the push is in flight', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'v1')
    let edited = false
    server.onRequest = async (method, path) => {
      if (method === 'POST' && path === '/sync' && !edited) {
        edited = true
        await new Promise(r => setTimeout(r, 5))
        await updateNoteLocal(id, { text: 'v2' })
      }
    }
    await runSync(true)
    expect((await db.notes.get(id))!.isDirty).toBe(1)

    server.onRequest = null
    await runSync(true)
    const local = (await db.notes.get(id))!
    expect(local.isDirty).toBe(0)
    expect(server.notes.get(local.serverId!)!.text).toBe('v2')
    expect(server.notes.size).toBe(1)
  })

  it('does not report false conflicts when the device clock is behind the server', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'v1')
    await runSync(true)
    // Local timestamp far in the past vs server clock (2030): old LWW would reject it.
    await db.notes.update(id, { text: 'edited offline', modifiedAt: '2001-01-01T00:00:00.000Z', isDirty: 1 })
    await runSync(true)
    const local = (await db.notes.get(id))!
    expect(server.notes.get(local.serverId!)!.text).toBe('edited offline')
    expect(await db.notes.count()).toBe(1)
  })

  it('keeps both versions on a real concurrent edit (conflict copy)', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'original')
    await runSync(true)
    const sid = (await db.notes.get(id))!.serverId!

    server.editNote(sid, 'edited on phone')
    await updateNoteLocal(id, { text: 'edited on laptop', tags: ['x'] })
    await runSync(true)

    const notes = await db.notes.toArray()
    const main = notes.find(n => n.id === id)!
    expect(main.text).toBe('edited on phone')
    expect(main.isDirty).toBe(0)
    const copy = notes.find(n => n.id !== id)!
    expect(copy.text).toBe('edited on laptop')
    expect(copy.tags).toEqual(expect.arrayContaining(['x', CONFLICT_TAG]))
    // The copy is a normal note and gets synced too.
    expect(copy.serverId).toBeTypeOf('number')
    expect(getAppState().lastConflictCount).toBe(1)
  })

  it('does not create duplicates when a push is retried after a lost response', async () => {
    const space = await ensureDefaultSpace()
    await localNote(space, 'once')
    let first = true
    const realFetch = server.fetch
    vi.stubGlobal('fetch', async (input: any, init: any) => {
      const res = await realFetch(input, init)
      if (first && (init?.method === 'POST') && String(input).endsWith('/sync')) { first = false; throw new TypeError('connection reset') }
      return res
    })
    await runSync(true)
    await runSync(true)
    expect([...server.notes.values()].filter(n => n.text === 'once')).toHaveLength(1)
    expect((await db.notes.toArray()).every(n => n.isDirty === 0)).toBe(true)
  })
})

describe('server rejections', () => {
  it('recreates a note the server no longer knows', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'survives a server restore')
    await runSync(true)
    const oldSid = (await db.notes.get(id))!.serverId!
    server.notes.delete(oldSid) // server restored from an older backup
    await updateNoteLocal(id, { text: 'edited after restore' })
    await runSync(true)
    const local = (await db.notes.get(id))!
    expect(local.isDirty).toBe(0)
    expect(local.serverId).not.toBe(oldSid)
    expect(server.notes.get(local.serverId!)!.text).toBe('edited after restore')
  })

  it('stops retrying a note it has no access to', async () => {
    const space = await ensureDefaultSpace()
    const foreign = server.addNote('not yours', { user_id: 99 })
    const id = await localNote(space, 'local edit', { serverId: foreign.id, isDirty: 1 })
    await runSync(true)
    expect((await db.notes.get(id))!.isDirty).toBe(0)
    expect(server.notes.get(foreign.id)!.text).toBe('not yours')
    expect(getAppState().syncError).toBeNull()
  })
})

describe('pull', () => {
  it('maps server parent ids to local ids on a fresh device', async () => {
    server.addNote('other user', { user_id: 99 })
    const parent = server.addNote('parent')
    const reply = server.addNote('reply', { parent_id: parent.id })
    await ensureDefaultSpace()
    await runSync(true)

    const lp = (await db.notes.where('serverId').equals(parent.id).first())!
    const lr = (await db.notes.where('serverId').equals(reply.id).first())!
    expect(lp.id).not.toBe(parent.id)
    expect(lr.parentId).toBe(lp.id)
    expect(lr.parentServerId).toBe(parent.id)
  })

  it('links replies that arrive before their parent', async () => {
    const parent = server.addNote('parent')
    const reply = server.addNote('reply', { parent_id: parent.id })
    await ensureDefaultSpace()
    await runSync(true)
    // Parent edited later so that on the next device the reply may arrive alone first.
    const localParent = (await db.notes.where('serverId').equals(parent.id).first())!
    await db.notes.delete(localParent.id!)
    await db.notes.where('serverId').equals(reply.id).modify({ parentId: null })
    server.editNote(parent.id, 'parent v2')
    await runSync(true)
    const lp = (await db.notes.where('serverId').equals(parent.id).first())!
    const lr = (await db.notes.where('serverId').equals(reply.id).first())!
    expect(lr.parentId).toBe(lp.id)
  })

  it('does not overwrite local edits that are not pushed yet', async () => {
    const n = server.addNote('server text')
    await ensureDefaultSpace()
    await runSync(true)
    const local = (await db.notes.where('serverId').equals(n.id).first())!
    await db.notes.update(local.id!, { text: 'local unsaved', isDirty: 1 })
    server.failures.push({ match: /^POST \/sync$/, status: 500, times: 1 })
    await runSync(true) // push fails, nothing pulled
    expect((await db.notes.get(local.id!))!.text).toBe('local unsaved')
  })

  it('removes attachments deleted on another device', async () => {
    const n = server.addNote('with image')
    const att = server.addAttachment(n.id, 'a.webp')
    await ensureDefaultSpace()
    await runSync(true)
    expect(await db.attachments.where('serverId').equals(att.id).count()).toBe(1)
    server.attachments.delete(att.id)
    server.editNote(n.id, 'image removed')
    await runSync(true)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.jobs.count()).toBe(0)
  })
})

describe('server loss', () => {
  it('reports the server as unreachable, keeps data and schedules a retry', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'written offline')
    server.down = true
    await expect(runSync(true)).resolves.toBeUndefined()

    const st = getAppState()
    expect(st.serverReachable).toBe(false)
    expect(st.syncError).toBe('Server unreachable')
    expect(st.nextRetryAt).not.toBeNull()
    expect(st.syncing).toBe(false)
    expect((await db.notes.get(id))!.isDirty).toBe(1)

    // Automatic retries are throttled by backoff...
    const before = server.log.length
    await runSync(false)
    expect(server.log.length).toBe(before)

    // ...and the next successful attempt clears the error.
    server.down = false
    await runSync(true)
    expect(getAppState().serverReachable).toBe(true)
    expect(getAppState().syncError).toBeNull()
    expect(getAppState().nextRetryAt).toBeNull()
    expect((await db.notes.get(id))!.isDirty).toBe(0)
  })

  it('times out a hanging server instead of blocking sync forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await ensureDefaultSpace()
      vi.stubGlobal('fetch', (_: any, init: any) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const p = runSync(true)
      await vi.advanceTimersByTimeAsync(21000)
      await p
      expect(getAppState().syncing).toBe(false)
      expect(getAppState().serverReachable).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('attachment jobs', () => {
  it('uploads after the note is mapped and a waiting upload does not block downloads', async () => {
    const remote = server.addNote('remote')
    const remoteAtt = server.addAttachment(remote.id, 'remote.webp', new Uint8Array([9, 9]))
    const space = await ensureDefaultSpace()
    await runSync(true)
    // Local note with an image, not pushed yet: its upload must wait.
    const id = await localNote(space, 'with photo')
    await addLocalAttachment(id, new File([new Uint8Array([7, 7, 7])], 'p.webp', { type: 'image/webp' }))

    await drainJobs()
    const downloaded = (await db.attachments.where('serverId').equals(remoteAtt.id).first())!
    expect(downloaded.data).toBeTruthy()
    expect(await db.jobs.where('kind').equals('attachment-upload').count()).toBe(1)

    await runSync(true) // note gets a server id
    await db.jobs.toCollection().modify({ nextAttemptAt: null })
    await drainJobs()
    const sid = (await db.notes.get(id))!.serverId!
    const uploaded = [...server.attachments.values()].filter(a => a.note_id === sid)
    expect(uploaded).toHaveLength(1)
    expect(await db.jobs.count()).toBe(0)
    const local = await db.attachments.where('noteId').equals(id).toArray()
    expect(local).toHaveLength(1)
    expect(local[0].serverId).toBe(uploaded[0].id)
  })

  it('does not count network errors as failures', async () => {
    const n = server.addNote('remote')
    server.addAttachment(n.id, 'x.webp')
    await ensureDefaultSpace()
    await runSync(true)
    await db.jobs.clear()
    const att = (await db.attachments.toArray())[0]
    await requestAttachmentPrefetch(att.id!)
    server.down = true
    expect(await processNextJob()).toBe('offline')
    const job = (await db.jobs.toArray())[0]
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
  })

  it('gives up after repeated server errors and can be retried manually', async () => {
    const n = server.addNote('remote')
    server.addAttachment(n.id, 'x.webp')
    await ensureDefaultSpace()
    await runSync(true)
    server.failures.push({ match: /^GET \/files\//, status: 500, times: MAX_ATTEMPTS })
    const onFailed = vi.fn()
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await db.jobs.toCollection().modify({ nextAttemptAt: null })
      await processNextJob(onFailed)
    }
    const job = (await db.jobs.toArray())[0]
    expect(job.status).toBe('failed')
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(await processNextJob()).toBe('idle')

    await retryFailedJobs()
    await drainJobs()
    expect(await db.jobs.count()).toBe(0)
    expect((await db.attachments.toArray())[0].data).toBeTruthy()
  })

  it('does not change image order when an image is downloaded', async () => {
    const n = server.addNote('remote')
    server.addAttachment(n.id, 'first.webp')
    server.addAttachment(n.id, 'second.webp')
    await ensureDefaultSpace()
    await runSync(true)
    const before = (await db.attachments.toArray()).map(a => [a.fileName, a.modifiedAt])
    await drainJobs()
    const after = (await db.attachments.toArray()).map(a => [a.fileName, a.modifiedAt])
    expect(after).toEqual(before)
  })

  it('pushes attachment deletions', async () => {
    const n = server.addNote('remote')
    server.addAttachment(n.id, 'x.webp')
    await ensureDefaultSpace()
    await runSync(true)
    const att = (await db.attachments.toArray())[0]
    await deleteLocalAttachment(att.id!)
    await runSync(true)
    expect(server.attachments.size).toBe(0)
  })
})

describe('legacy data', () => {
  it('turns conflicts that used to block a note into conflict copies', async () => {
    const space = await ensureDefaultSpace()
    const id = await localNote(space, 'server version now', { serverId: 5, isDirty: 0 })
    await db.noteConflicts.add({
      noteLocalId: id, noteServerId: 5, reason: 'server-newer', createdAt: new Date().toISOString(), isResolved: 0,
      local: { spaceId: space, text: 'my lost edit', tags: ['t'], createdAt: '', modifiedAt: '' },
    })
    expect(await recoverLegacyConflicts()).toBe(1)
    const copy = (await db.notes.toArray()).find(n => n.text === 'my lost edit')!
    expect(copy.tags).toContain(CONFLICT_TAG)
    expect(copy.isDirty).toBe(1)
    expect(await db.noteConflicts.where('isResolved').equals(0).count()).toBe(0)
  })
})
