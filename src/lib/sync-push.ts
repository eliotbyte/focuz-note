// Push: send dirty local records to POST /sync and apply the server's answer.
import { db } from './db'
import { api } from './api'
import type { ActivityRecord, ActivityTypeRecord, AttachmentRecord, FilterRecord, NoteRecord, TagRecord } from './types'
import { toServerActivityValue } from './activity-values'

export interface PushResult {
  applied: number
  /** Notes held back because their parent has no server id yet (they go in the next round). */
  deferred: number
  /** New server ids assigned in this round (a deferred child may now be sendable). */
  mapped: number
  conflicts: number
}

export const CONFLICT_TAG = 'conflict'

/** Server space id for a local space, creating the space on the server if needed. */
async function serverSpaceId(localSpaceId: number, cache: Map<number, number>): Promise<number> {
  const cached = cache.get(localSpaceId)
  if (cached) return cached
  const s = await db.spaces.get(localSpaceId)
  if (!s) throw new Error(`Space ${localSpaceId} not found`)
  let sid = s.serverId ?? 0
  if (!sid) {
    const resp = await api('/spaces', { method: 'POST', body: JSON.stringify({ name: s.name }) })
    sid = Number(resp?.data?.id) || 0
    if (!sid) throw new Error('Server did not return a space id')
    await db.spaces.update(localSpaceId, { serverId: sid, isDirty: 0 })
  }
  cache.set(localSpaceId, sid)
  return sid
}

type ParentResolution = { kind: 'ok'; parentServerId: number | null } | { kind: 'wait' }

/** parent_id to send for a note, or 'wait' when the parent exists locally but is not on the server yet. */
async function resolveParent(n: NoteRecord): Promise<ParentResolution> {
  if (n.parentId == null) return { kind: 'ok', parentServerId: n.parentServerId ?? null }
  const p = await db.notes.get(n.parentId)
  if (p?.serverId) return { kind: 'ok', parentServerId: p.serverId }
  if (p && !p.deletedAt) return { kind: 'wait' }
  return { kind: 'ok', parentServerId: n.parentServerId ?? null }
}

function toFilterChange(f: FilterRecord, spaceId: number) {
  return {
    id: f.serverId ?? null,
    clientId: f.serverId ? null : (f.clientId || `tmp-${f.id}`),
    space_id: spaceId,
    parent_id: f.parentId ?? null,
    name: f.name,
    params: f.params as any,
    created_at: f.createdAt,
    modified_at: f.modifiedAt,
    deleted_at: f.deletedAt ?? null,
    base_modified_at: f.serverId ? (f.serverModifiedAt ?? undefined) : undefined,
  }
}

function toTagChange(t: TagRecord, spaceId: number) {
  return {
    id: t.serverId ?? null,
    space_id: spaceId,
    name: t.name,
    created_at: t.createdAt,
    modified_at: t.modifiedAt,
    deleted_at: t.deletedAt ?? null,
  }
}

function groupByNote<T extends { noteId: number }>(items: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const it of items) {
    const list = m.get(it.noteId) ?? []
    list.push(it)
    m.set(it.noteId, list)
  }
  return m
}

function sameTags(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = [...(a ?? [])].sort()
  const y = [...(b ?? [])].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export async function pushDirty(): Promise<PushResult> {
  const result: PushResult = { applied: 0, deferred: 0, mapped: 0, conflicts: 0 }

  const dirtyNotes = await db.notes.where('isDirty').equals(1).toArray()
  const filters = await db.filters.where('isDirty').equals(1).toArray()
  const tags = await db.tags.where('isDirty').equals(1).toArray()
  const attachments = await db.attachments.where('isDirty').equals(1).toArray()
  const activities = await db.activities.where('isDirty').equals(1).toArray()

  const attByNote = groupByNote<AttachmentRecord>(attachments)
  const actByNote = groupByNote<ActivityRecord>(activities)
  const candidates = new Map<number, NoteRecord>()
  for (const n of dirtyNotes) candidates.set(n.id!, n)
  // Attachment / activity edits travel inside their note.
  for (const noteId of [...attByNote.keys(), ...actByNote.keys()]) {
    if (candidates.has(noteId)) continue
    const note = await db.notes.get(noteId)
    if (note?.serverId) candidates.set(noteId, note)
  }
  if (candidates.size + filters.length + tags.length === 0) return result

  const spaceCache = new Map<number, number>()
  const sentNotes: NoteRecord[] = []
  const notesPayload: any[] = []
  for (const n of candidates.values()) {
    const parent = await resolveParent(n)
    if (parent.kind === 'wait') { result.deferred++; continue }
    const space_id = await serverSpaceId(n.spaceId, spaceCache)
    const out: any = {
      id: n.serverId ?? null,
      clientId: n.serverId ? null : (n.clientId || `tmp-${n.id}`),
      space_id,
      text: n.text,
      tags: n.tags ?? [],
      created_at: n.createdAt,
      modified_at: n.modifiedAt,
      deleted_at: n.deletedAt ?? null,
      parent_id: parent.parentServerId,
      date: n.date ?? n.createdAt,
      base_modified_at: n.serverId ? (n.serverModifiedAt ?? undefined) : undefined,
    }
    const atts = (attByNote.get(n.id!) ?? []).filter(a => !!a.serverId)
    if (atts.length > 0) {
      out.attachments = atts.map(a => ({ id: a.serverId as string, modified_at: a.modifiedAt, is_deleted: !!a.deletedAt }))
    }
    const acts = actByNote.get(n.id!) ?? []
    if (acts.length > 0) {
      const typeIds = Array.from(new Set(acts.map(a => a.typeId)))
      const types = await db.activityTypes.where('serverId').anyOf(typeIds).toArray()
      const typeById = new Map<number, ActivityTypeRecord>(types.map(t => [t.serverId!, t]))
      out.activities = acts.map(a => ({
        id: a.serverId ?? null,
        type_id: a.typeId,
        value: toServerActivityValue(typeById.get(a.typeId), a.valueRaw),
        created_at: a.createdAt,
        modified_at: a.modifiedAt,
        deleted_at: a.deletedAt ?? null,
      }))
    }
    notesPayload.push(out)
    sentNotes.push(n)
  }
  const filtersPayload = []
  for (const f of filters) filtersPayload.push(toFilterChange(f, await serverSpaceId(f.spaceId, spaceCache)))
  const tagsPayload = []
  for (const t of tags) tagsPayload.push(toTagChange(t, await serverSpaceId(t.spaceId, spaceCache)))

  if (notesPayload.length + filtersPayload.length + tagsPayload.length === 0) return result

  const resp = await api('/sync', {
    method: 'POST',
    body: JSON.stringify({ notes: notesPayload, filters: filtersPayload, tags: tagsPayload, charts: [] }),
  })
  const data = resp?.data ?? {}
  const mappings: Array<{ resource: string; clientId: string; serverId: number }> = data.mappings ?? []
  const conflicts: Array<{ resource?: string; id?: number; reason?: string; server?: any }> = data.conflicts ?? []
  const versions: Array<{ resource: string; id: number; modified_at: string }> = data.versions ?? []
  result.applied = Number(data.applied ?? 0)
  result.conflicts = conflicts.length

  const isRes = (r: string | undefined, name: string) => {
    const x = String(r ?? '').toLowerCase()
    return x === name || x === `${name}s`
  }
  const noteConflicts = new Map<number, any>()
  const conflictedFilterIds = new Set<number>()
  const conflictedActivityIds = new Set<number>()
  for (const c of conflicts) {
    if (typeof c?.id !== 'number') continue
    if (isRes(c.resource, 'note')) noteConflicts.set(c.id, c)
    else if (isRes(c.resource, 'filter')) conflictedFilterIds.add(c.id)
    else if (isRes(c.resource, 'activity') || c.resource === 'activities') conflictedActivityIds.add(c.id)
  }
  const noteVersion = new Map<number, string>()
  const filterVersion = new Map<number, string>()
  for (const v of versions) {
    if (isRes(v.resource, 'note')) noteVersion.set(v.id, v.modified_at)
    else if (isRes(v.resource, 'filter')) filterVersion.set(v.id, v.modified_at)
  }
  const noteMapping = new Map<string, number>()
  const filterMapping = new Map<string, number>()
  for (const m of mappings) {
    if (isRes(m.resource, 'note')) noteMapping.set(m.clientId, m.serverId)
    else if (isRes(m.resource, 'filter')) filterMapping.set(m.clientId, m.serverId)
  }

  await db.transaction('rw', [db.notes, db.filters, db.tags, db.attachments, db.activities, db.noteConflicts], async () => {
    const conflictedNoteLocalIds = new Set<number>()
    for (const sent of sentNotes) {
      const current = await db.notes.get(sent.id!)
      if (!current) continue
      const serverId = sent.serverId ?? (sent.clientId ? noteMapping.get(sent.clientId) : undefined) ?? null
      const conflict = serverId != null ? noteConflicts.get(serverId) : undefined
      if (conflict) {
        conflictedNoteLocalIds.add(sent.id!)
        await resolveNoteConflict(current, conflict)
        continue
      }
      const changes: Partial<NoteRecord> = {}
      if (serverId != null && current.serverId !== serverId) { changes.serverId = serverId; result.mapped++ }
      const version = serverId != null ? noteVersion.get(serverId) : undefined
      if (version) changes.serverModifiedAt = version
      if (current.parentId != null) {
        const p = await db.notes.get(current.parentId)
        if (p?.serverId) changes.parentServerId = p.serverId
      }
      // Only mark clean if nothing changed locally while the request was in flight.
      if (current.modifiedAt === sent.modifiedAt) changes.isDirty = 0
      await db.notes.update(sent.id!, changes)
    }
    for (const f of filters) {
      const current = await db.filters.get(f.id!)
      if (!current) continue
      const serverId = f.serverId ?? (f.clientId ? filterMapping.get(f.clientId) : undefined) ?? null
      const changes: Partial<FilterRecord> = {}
      if (serverId != null && current.serverId !== serverId) { changes.serverId = serverId; result.mapped++ }
      const version = serverId != null ? filterVersion.get(serverId) : undefined
      if (version) changes.serverModifiedAt = version
      // Filter conflicts: server wins, the next pull brings its version.
      if (serverId != null && conflictedFilterIds.has(serverId)) changes.serverModifiedAt = null
      if (current.modifiedAt === f.modifiedAt) changes.isDirty = 0
      await db.filters.update(f.id!, changes)
      // Children created before their parent reference it via params._parentClientId.
      if (changes.serverId != null && current.clientId) {
        const children = await db.filters.filter(ch => (ch.params as any)?._parentClientId === current.clientId).toArray()
        for (const ch of children) {
          const nextParams = { ...(ch.params as any) }
          delete nextParams._parentClientId
          await db.filters.update(ch.id!, { parentId: changes.serverId, params: nextParams, isDirty: 1, modifiedAt: new Date().toISOString() })
        }
      }
    }
    for (const t of tags) {
      const current = await db.tags.get(t.id!)
      if (current && current.modifiedAt === t.modifiedAt) await db.tags.update(t.id!, { isDirty: 0 })
    }
    const sentNoteIds = new Set(sentNotes.map(n => n.id!))
    for (const a of attachments) {
      // Local-only attachments are handled by the upload job; conflicted notes did not apply edits.
      if (!a.serverId || !sentNoteIds.has(a.noteId) || conflictedNoteLocalIds.has(a.noteId)) continue
      const current = await db.attachments.get(a.id!)
      if (current && current.modifiedAt === a.modifiedAt) await db.attachments.update(a.id!, { isDirty: 0 })
    }
    for (const a of activities) {
      if (!sentNoteIds.has(a.noteId)) continue
      if (a.serverId && conflictedActivityIds.has(a.serverId)) continue
      const current = await db.activities.get(a.id!)
      if (current && current.modifiedAt === a.modifiedAt) await db.activities.update(a.id!, { isDirty: 0 })
    }
  })

  return result
}

/**
 * The server kept a newer version of the note. The server version wins in place and the local
 * edit is preserved as a separate "conflict" note so nothing typed by the user is lost.
 */
async function resolveNoteConflict(local: NoteRecord, conflict: any): Promise<void> {
  const server = conflict?.server ?? {}
  const now = new Date().toISOString()
  const serverText = typeof server.text === 'string' ? server.text : null
  const serverTags: string[] | null = Array.isArray(server.tags) ? server.tags : null
  const differs = serverText == null || serverText !== local.text || (serverTags != null && !sameTags(serverTags, local.tags))
  if (differs && !local.deletedAt && local.text.trim()) {
    await db.notes.add({
      spaceId: local.spaceId,
      title: null,
      text: local.text,
      tags: Array.from(new Set([...(local.tags ?? []), CONFLICT_TAG])),
      createdAt: now,
      modifiedAt: now,
      date: local.date ?? now,
      parentId: local.parentId ?? null,
      parentServerId: local.parentServerId ?? null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    })
  }
  await db.noteConflicts.add({
    noteLocalId: local.id!,
    noteServerId: local.serverId!,
    reason: String(conflict?.reason ?? 'server-newer'),
    local: {
      serverId: local.serverId ?? null, clientId: local.clientId ?? null, spaceId: local.spaceId, title: local.title ?? null,
      text: local.text, tags: local.tags ?? [], createdAt: local.createdAt, modifiedAt: local.modifiedAt, date: local.date,
      parentId: local.parentId ?? null, deletedAt: local.deletedAt ?? null,
    },
    server,
    createdAt: now,
    isResolved: 1,
    resolvedAt: now,
  })
  const changes: Partial<NoteRecord> = { isDirty: 0 }
  if (serverText != null) {
    changes.text = serverText
    if (serverTags != null) changes.tags = serverTags
    if (typeof server.modified_at === 'string') { changes.modifiedAt = server.modified_at; changes.serverModifiedAt = server.modified_at }
    changes.deletedAt = server.deleted_at ?? null
    if (typeof server.date === 'string') changes.date = server.date
  } else {
    // Unknown server state: force the next pull to overwrite this note.
    changes.serverModifiedAt = null
  }
  await db.notes.update(local.id!, changes)
}

/**
 * Before this version, notes with an unresolved conflict were silently excluded from sync forever
 * and pull overwrote them with the server text. Turn every such leftover into a conflict copy
 * (when the saved local text differs from what the note shows now) and stop blocking the note.
 */
export async function recoverLegacyConflicts(): Promise<number> {
  const open = await db.noteConflicts.where('isResolved').equals(0).toArray()
  if (open.length === 0) return 0
  let restored = 0
  const now = new Date().toISOString()
  await db.transaction('rw', db.notes, db.noteConflicts, async () => {
    for (const c of open) {
      const note = await db.notes.get(c.noteLocalId)
      const local = c.local
      if (local?.text?.trim() && (!note || note.text !== local.text || !sameTags(note.tags, local.tags))) {
        await db.notes.add({
          spaceId: local.spaceId,
          title: null,
          text: local.text,
          tags: Array.from(new Set([...(local.tags ?? []), CONFLICT_TAG])),
          createdAt: now,
          modifiedAt: now,
          date: local.date ?? now,
          parentId: note?.parentId ?? null,
          parentServerId: note?.parentServerId ?? null,
          deletedAt: null,
          isDirty: 1,
          serverId: null,
          clientId: crypto.randomUUID(),
        })
        restored++
      }
      await db.noteConflicts.update(c.id!, { isResolved: 1, resolvedAt: now })
    }
  })
  return restored
}
