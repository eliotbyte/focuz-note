// Pull: fetch server changes since the last checkpoint (GET /sync) and merge them locally.
import { db, getKV, setKV } from './db'
import { api } from './api'
import { fromServerActivityValue } from './activity-values'
import type { ActivityRecord, ActivityTypeRecord, AttachmentRecord, FilterRecord, JobRecord, NoteRecord, PublicShare, SpaceMember, SpaceRecord, SpaceRole, TagRecord } from './types'

export const LAST_SYNC_KV = 'lastSyncAt'
/** Priority of background image downloads (viewport prefetch uses 1, lower runs first). */
export const BACKGROUND_DOWNLOAD_PRIORITY = 20

export interface PullResult { pulled: number }

async function localSpaceId(serverSpaceId: number): Promise<number | undefined> {
  return (await db.spaces.where('serverId').equals(serverSpaceId).first())?.id
}

async function localNoteIdByServer(serverId: number): Promise<number | undefined> {
  return (await db.notes.where('serverId').equals(serverId).first())?.id
}

async function ensureDownloadJobInTx(attachmentLocalId: number, priority: number) {
  const existing = await db.jobs.where('attachmentId').equals(attachmentLocalId).filter(j => j.kind === 'attachment-download').first()
  if (existing) return
  const now = new Date().toISOString()
  await db.jobs.add({ kind: 'attachment-download', attachmentId: attachmentLocalId, priority, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: null } as JobRecord)
}

async function upsertNote(n: any): Promise<void> {
  let existing = await db.notes.where('serverId').equals(n.id).first()
  if (!existing && n.clientId) existing = await db.notes.where('clientId').equals(n.clientId).first()
  // Remove accidental duplicates bound to the same server id.
  const dups = await db.notes.where('serverId').equals(n.id).toArray()
  if (dups.length > 1) {
    const keep = existing ?? dups[0]
    for (const d of dups) if (d.id !== keep.id) await db.notes.delete(d.id!)
  }
  const spaceId = await localSpaceId(n.space_id)
  if (spaceId == null) return
  const parentServerId: number | null = n.parent_id ?? null
  const parentId = parentServerId != null ? (await localNoteIdByServer(parentServerId)) ?? null : null

  if (existing?.isDirty === 1) {
    // Local edits not pushed yet: keep them. If the server changed concurrently, the next
    // push reports a conflict and the local text is preserved as a conflict copy.
    if (existing.serverId !== n.id) await db.notes.update(existing.id!, { serverId: n.id })
    return
  }
  const rec: NoteRecord = {
    id: existing?.id,
    serverId: n.id ?? null,
    clientId: existing?.clientId ?? n.clientId ?? null,
    spaceId,
    title: null,
    text: n.text ?? '',
    tags: n.tags ?? [],
    createdAt: n.created_at,
    modifiedAt: n.modified_at,
    serverModifiedAt: n.modified_at,
    date: n.date ?? n.created_at,
    parentId,
    parentServerId,
    deletedAt: n.deleted_at ?? null,
    isDirty: 0,
    authorId: typeof n.user_id === 'number' ? n.user_id : null,
    authorName: n.author_name || null,
    modifiedById: typeof n.modified_by === 'number' ? n.modified_by : null,
    modifiedByName: n.modified_by_name || null,
  }
  if (existing) await db.notes.put(rec)
  else await db.notes.add(rec)
}

async function mergeNoteAttachments(n: any, noteLocalId: number): Promise<void> {
  const serverList: any[] = Array.isArray(n.attachments) ? n.attachments : []
  const serverIds = new Set<string>()
  for (const a of serverList) {
    serverIds.add(a.id)
    const existing = await db.attachments.where('serverId').equals(a.id).first()
    const rec: AttachmentRecord = {
      id: existing?.id,
      serverId: a.id,
      clientId: existing?.clientId ?? null,
      noteId: noteLocalId,
      fileName: a.file_name,
      fileType: a.file_type,
      fileSize: a.file_size,
      data: existing?.data ?? null,
      createdAt: a.created_at,
      modifiedAt: existing?.isDirty ? existing.modifiedAt : a.modified_at,
      deletedAt: existing?.deletedAt ?? null,
      isDirty: existing?.isDirty ?? 0,
    }
    const attId = existing ? (await db.attachments.put(rec)) : (await db.attachments.add(rec))
    // An upload from this device may still be mapping its record: merge local duplicates.
    const localDups = await db.attachments.where('noteId').equals(noteLocalId)
      .filter(x => !x.serverId && x.fileName === rec.fileName && x.fileSize === rec.fileSize).toArray()
    let hasData = !!rec.data
    for (const d of localDups) {
      if (!hasData && d.data) { await db.attachments.update(attId, { data: d.data }); hasData = true }
      await db.attachments.delete(d.id!)
      await db.jobs.where('attachmentId').equals(d.id!).delete()
    }
    if (!hasData && !rec.deletedAt) await ensureDownloadJobInTx(attId, BACKGROUND_DOWNLOAD_PRIORITY)
  }
  // The server returns the complete attachment list of a note and hard-deletes removed files:
  // anything server-backed that is missing here was deleted on another device.
  const local = await db.attachments.where('noteId').equals(noteLocalId).toArray()
  for (const a of local) {
    if (!a.serverId || serverIds.has(a.serverId) || a.isDirty) continue
    await db.attachments.delete(a.id!)
    await db.jobs.where('attachmentId').equals(a.id!).delete()
  }
}

async function mergeNoteActivities(n: any, noteLocalId: number): Promise<number> {
  let count = 0
  for (const a of (n.activities ?? [])) {
    count++
    const existingByServer = typeof a.id === 'number' ? await db.activities.where('serverId').equals(a.id).first() : undefined
    if (existingByServer?.isDirty) continue
    const localDup = await db.activities.where('noteId').equals(noteLocalId)
      .filter(x => !x.serverId && !x.deletedAt && x.typeId === a.type_id).first()
    const rec: ActivityRecord = {
      id: existingByServer?.id ?? localDup?.id,
      serverId: typeof a.id === 'number' ? a.id : null,
      noteId: noteLocalId,
      typeId: a.type_id,
      valueRaw: fromServerActivityValue(a.value),
      createdAt: a.created_at,
      modifiedAt: a.modified_at,
      deletedAt: a.deleted_at ?? null,
      isDirty: 0,
    }
    if (existingByServer && localDup && existingByServer.id !== localDup.id) {
      await db.activities.put({ ...rec, id: existingByServer.id })
      await db.activities.delete(localDup.id!)
    } else if (rec.id != null) {
      await db.activities.put(rec)
    } else {
      await db.activities.add(rec)
    }
    // Only one activity per (note, type): keep the server-backed / newest one.
    const allOfType = await db.activities.where('noteId').equals(noteLocalId).filter(x => !x.deletedAt && x.typeId === a.type_id).toArray()
    if (allOfType.length > 1) {
      let winner = allOfType[0]
      for (const it of allOfType.slice(1)) {
        const prefer = (Number(!!it.serverId) - Number(!!winner.serverId)) || (it.modifiedAt || '').localeCompare(winner.modifiedAt || '')
        if (prefer > 0) winner = it
      }
      for (const it of allOfType) if (it.id !== winner.id) await db.activities.delete(it.id!)
    }
  }
  return count
}

/** Link replies whose parent arrived after them (or in a later page). */
async function linkPendingParents(): Promise<void> {
  const pending = await db.notes.filter(n => n.parentId == null && n.parentServerId != null).toArray()
  for (const n of pending) {
    const pid = await localNoteIdByServer(n.parentServerId!)
    if (pid != null) await db.notes.update(n.id!, { parentId: pid })
  }
}

export const MEMBERS_KV = 'space:members'
export const SHARES_KV = 'space:shares'

interface PageState { pulled: number; sawNotes: boolean; maxSyncAt: string }

async function applyPage(data: any, st: PageState): Promise<void> {
  const updateMax = (iso?: string) => { if (iso && iso > st.maxSyncAt) st.maxSyncAt = iso }
  for (const s of (data.spaces ?? [])) updateMax(s.modified_at)
  for (const t of (data.tags ?? [])) updateMax(t.modified_at ?? t.created_at)
  for (const f of (data.filters ?? [])) updateMax(f.modified_at)
  for (const at of (data.activityTypes ?? [])) updateMax(at.modified_at)
  for (const n of (data.notes ?? [])) {
    updateMax(n.modified_at)
    for (const a of (n.attachments ?? [])) updateMax(a.modified_at ?? a.created_at)
    for (const a of (n.activities ?? [])) updateMax(a.modified_at)
  }
  await db.transaction('rw', [db.spaces, db.notes, db.tags, db.filters, db.attachments, db.activities, db.activityTypes, db.jobs], async () => {
    for (const s of (data.spaces ?? [])) {
      st.pulled++
      const existing = await db.spaces.where('serverId').equals(s.id).first()
      // Keep role / member count (they come with the memberships).
      const rec: SpaceRecord = { ...(existing ?? {}), id: existing?.id, serverId: s.id, name: s.name, createdAt: s.created_at, modifiedAt: s.modified_at, deletedAt: s.deleted_at ?? null, isDirty: 0 }
      if (existing) await db.spaces.put(rec)
      else await db.spaces.add(rec)
    }

    for (const n of (data.notes ?? [])) {
      st.pulled++
      st.sawNotes = true
      await upsertNote(n)
    }

    for (const t of (data.tags ?? [])) {
      st.pulled++
      const existing = await db.tags.where('serverId').equals(t.id).first()
      const spaceId = await localSpaceId(t.space_id)
      if (spaceId == null) continue
      const rec: TagRecord = { id: existing?.id, serverId: t.id, spaceId, name: t.name, createdAt: t.created_at, modifiedAt: t.modified_at, deletedAt: t.deleted_at ?? null, isDirty: 0 }
      if (existing) await db.tags.put(rec)
      else await db.tags.add(rec)
    }

    for (const f of (data.filters ?? [])) {
      st.pulled++
      const existing = await db.filters.where('serverId').equals(f.id).first()
      if (existing?.isDirty) continue
      const spaceId = await localSpaceId(f.space_id)
      if (spaceId == null) continue
      const rec: FilterRecord = {
        id: existing?.id,
        serverId: f.id,
        clientId: existing?.clientId ?? null,
        spaceId,
        parentId: f.parent_id ?? null,
        name: f.name,
        params: (f.params ?? {}) as any,
        createdAt: f.created_at,
        modifiedAt: f.modified_at,
        serverModifiedAt: f.modified_at,
        deletedAt: f.deleted_at ?? null,
        isDirty: 0,
      }
      if (existing) await db.filters.put(rec)
      else await db.filters.add(rec)
    }

    for (const t of (data.activityTypes ?? [])) {
      st.pulled++
      const existing = await db.activityTypes.where('serverId').equals(t.id).first()
      const spaceLocalId = typeof t.space_id === 'number' ? ((await localSpaceId(t.space_id)) ?? 0) : 0
      const rec: ActivityTypeRecord = {
        id: existing?.id,
        serverId: t.id,
        spaceId: spaceLocalId,
        name: t.name,
        valueType: (t.value_type || t.valueType) as any,
        minValue: typeof t.min_value === 'number' ? t.min_value : (typeof t.minValue === 'number' ? t.minValue : null),
        maxValue: typeof t.max_value === 'number' ? t.max_value : (typeof t.maxValue === 'number' ? t.maxValue : null),
        aggregation: t.aggregation ?? null,
        unit: t.unit ?? null,
        categoryId: t.category_id ?? t.categoryId ?? null,
        createdAt: t.created_at,
        modifiedAt: t.modified_at,
        deletedAt: t.deleted_at ?? null,
      }
      if (existing) await db.activityTypes.put(rec)
      else await db.activityTypes.add(rec)
    }

    for (const n of (data.notes ?? [])) {
      const noteLocalId = await localNoteIdByServer(n.id)
      if (!noteLocalId) continue
      st.pulled += (n.attachments ?? []).length
      await mergeNoteAttachments(n, noteLocalId)
      st.pulled += await mergeNoteActivities(n, noteLocalId)
    }
  })

}

/** Everything a pull can bring, page by page. spaceId limits it to one space. */
async function pullPages(since: string, st: PageState, spaceId?: number): Promise<any> {
  let cursor: string | null = null
  let first: any = null
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ since })
    if (spaceId) qs.set('spaceId', String(spaceId))
    if (cursor) qs.set('cursor', cursor)
    const resp = await api(`/sync?${qs.toString()}`)
    const data = resp?.data || {}
    if (!first) first = data
    await applyPage(data, st)
    const hasMore = !!data.hasMore
    const nextCursor = (typeof data.nextCursor === 'string' && data.nextCursor) ? data.nextCursor : null
    if (!hasMore || !nextCursor) break
    cursor = nextCursor
  }
  return first
}

export async function pullSince(): Promise<PullResult> {
  const since = (await getKV<string>(LAST_SYNC_KV, '1970-01-01T00:00:00Z'))!
  const st: PageState = { pulled: 0, sawNotes: false, maxSyncAt: since }
  const first = await pullPages(since, st)
  // Memberships come in full with every pull: spaces joined since then are loaded completely
  // (their notes are older than our checkpoint), spaces we were removed from are dropped.
  if (first && Array.isArray(first.memberships)) {
    const joined = await applyMemberships(first)
    for (const serverSpaceId of joined) {
      const inner: PageState = { pulled: 0, sawNotes: false, maxSyncAt: st.maxSyncAt }
      await pullPages('1970-01-01T00:00:00Z', inner, serverSpaceId)
      st.pulled += inner.pulled
      st.sawNotes = st.sawNotes || inner.sawNotes
    }
  }
  if (st.sawNotes) await db.transaction('rw', db.notes, linkPendingParents)
  await setKV(LAST_SYNC_KV, st.maxSyncAt)
  return { pulled: st.pulled }
}

/** Updates spaces from the membership list. Returns server ids of spaces new on this device. */
async function applyMemberships(data: any): Promise<number[]> {
  const joined: number[] = []
  const serverIds = new Set<number>()
  await db.transaction('rw', db.spaces, async () => {
    for (const m of data.memberships as any[]) {
      serverIds.add(m.space_id)
      const existing = await db.spaces.where('serverId').equals(m.space_id).first()
      const patch = { name: m.name, role: m.role as SpaceRole, isPersonal: !!m.is_personal, memberCount: Number(m.member_count) || 1 }
      if (existing) {
        if (existing.deletedAt) joined.push(m.space_id)
        await db.spaces.update(existing.id!, { ...patch, deletedAt: null })
      } else {
        const now = new Date().toISOString()
        await db.spaces.add({ serverId: m.space_id, ...patch, createdAt: now, modifiedAt: now, deletedAt: null, isDirty: 0 } as SpaceRecord)
        joined.push(m.space_id)
      }
    }
  })
  const lost = (await db.spaces.toArray()).filter(s => s.serverId != null && !serverIds.has(s.serverId) && !s.deletedAt)
  for (const s of lost) await dropSpaceLocally(s.id!)

  const members: SpaceMember[] = (data.members ?? []).map((m: any) => ({ spaceId: m.space_id, userId: m.user_id, username: m.username, role: m.role }))
  const shares: PublicShare[] = (data.shares ?? []).map((x: any) => ({
    token: x.token, spaceId: x.space_id, noteId: x.note_id ?? null, includeReplies: !!x.include_replies, createdBy: x.created_by, createdAt: x.created_at,
  }))
  await setKV(MEMBERS_KV, members)
  await setKV(SHARES_KV, shares)
  return joined
}

/** Removes a space and everything in it from this device (after leaving or being removed). */
export async function dropSpaceLocally(localSpaceId: number): Promise<void> {
  await db.transaction('rw', [db.spaces, db.notes, db.tags, db.filters, db.attachments, db.activities, db.jobs, db.noteConflicts], async () => {
    const notes = await db.notes.where('spaceId').equals(localSpaceId).toArray()
    const noteIds = notes.map(n => n.id!)
    if (noteIds.length) {
      const atts = await db.attachments.where('noteId').anyOf(noteIds).toArray()
      const attIds = atts.map(a => a.id!)
      if (attIds.length) await db.jobs.where('attachmentId').anyOf(attIds).delete()
      await db.attachments.where('noteId').anyOf(noteIds).delete()
      await db.activities.where('noteId').anyOf(noteIds).delete()
      await db.noteConflicts.where('noteLocalId').anyOf(noteIds).delete()
      await db.notes.bulkDelete(noteIds)
    }
    await db.tags.where('spaceId').equals(localSpaceId).delete()
    await db.filters.where('spaceId').equals(localSpaceId).delete()
    await db.spaces.delete(localSpaceId)
  })
}
