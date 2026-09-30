import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'

// Schema exactly as shipped before this change (v8).
const V8 = {
  spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
  notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
  noteConflicts: '++id, noteLocalId, noteServerId, isResolved, createdAt',
  tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
  filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
  activities: '++id, serverId, noteId, typeId, createdAt, modifiedAt, deletedAt, isDirty',
  activityTypes: '++id, serverId, spaceId, name, valueType, createdAt, modifiedAt, deletedAt',
  charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
  meta: 'key',
  attachments: '++id, serverId, clientId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
  jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
}

const t = '2025-05-01T10:00:00.000Z'
const note = (id: number, extra: Record<string, unknown>) => ({ id, spaceId: 1, title: null, text: `note ${id}`, tags: ['a'], createdAt: t, modifiedAt: t, date: t, parentId: null, deletedAt: null, isDirty: 0, clientId: null, ...extra })

describe('IndexedDB upgrade v8 -> v9', () => {
  it('keeps every record and converts parent ids to local ids', async () => {
    const old = new Dexie('focuz-db')
    old.version(8).stores(V8)
    await old.open()
    await old.table('spaces').add({ id: 1, serverId: 7, name: 'My Space', createdAt: t, modifiedAt: t, deletedAt: null, isDirty: 0 })
    await old.table('notes').bulkAdd([
      note(1, { serverId: 101 }), // parent (pulled)
      note(2, { serverId: 102, parentId: 101 }), // pulled reply: parentId held the *server* id
      note(3, { serverId: null, clientId: 'c3', parentId: 1, isDirty: 1 }), // local draft reply: local id
      note(4, { serverId: 104, parentId: 999 }), // parent not on this device
      note(5, { serverId: 105, isDirty: 1, text: 'edited offline' }), // pending edit
    ])
    await old.table('filters').add({ id: 1, serverId: 11, clientId: null, spaceId: 1, parentId: null, name: 'F', params: { includeTags: ['a'] }, createdAt: t, modifiedAt: t, deletedAt: null, isDirty: 0 })
    await old.table('attachments').add({ id: 1, serverId: 'att-1', clientId: null, noteId: 1, fileName: 'a.webp', fileType: 'image/webp', fileSize: 3, data: null, createdAt: t, modifiedAt: t, deletedAt: null, isDirty: 0 })
    await old.table('jobs').bulkAdd([
      { id: 1, kind: 'attachment-download', attachmentId: 1, priority: 1, status: 'running', attempts: 0, createdAt: t, updatedAt: t },
      { id: 2, kind: 'attachment-download', attachmentId: 1, priority: 1, status: 'failed', attempts: 7, createdAt: t, updatedAt: t },
    ])
    await old.table('meta').put({ key: 'lastSyncAt', value: JSON.stringify(t) })
    old.close()

    const { db, ensureDbOpen } = await import('./db')
    await ensureDbOpen()
    expect(db.verno).toBe(9)

    const notes = await db.notes.orderBy('id').toArray()
    expect(notes).toHaveLength(5)
    expect(notes.map(n => n.text)).toEqual(['note 1', 'note 2', 'note 3', 'note 4', 'edited offline'])
    expect(notes[1]).toMatchObject({ parentId: 1, parentServerId: 101 })
    expect(notes[2]).toMatchObject({ parentId: 1, parentServerId: 101, isDirty: 1 })
    expect(notes[3]).toMatchObject({ parentId: null, parentServerId: 999 })
    // Clean notes get their server version as base; pending edits keep the old conflict rule.
    expect(notes[0].serverModifiedAt).toBe(t)
    expect(notes[4].serverModifiedAt ?? null).toBeNull()
    expect(notes[4].isDirty).toBe(1)

    expect((await db.filters.get(1))!.serverModifiedAt).toBe(t)
    expect(await db.attachments.count()).toBe(1)
    expect(await db.spaces.count()).toBe(1)
    expect((await db.meta.get('lastSyncAt'))!.value).toBe(JSON.stringify(t))
    const jobs = await db.jobs.toArray()
    expect(jobs.map(j => [j.status, j.attempts])).toEqual([['pending', 0], ['pending', 0]])
  })
})
