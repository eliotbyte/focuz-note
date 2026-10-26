// Local mutations. They only touch IndexedDB and emit 'focuz:local-write'; the sync engine pushes them.
import { db } from './db'
import { validateActivityValue } from './activity-values'
import type { ActivityRecord, AttachmentRecord, FilterRecord } from './types'

function emitLocalWrite() {
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function deleteNote(localId: number): Promise<void> {
  const now = new Date().toISOString()
  await db.notes.update(localId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
  emitLocalWrite()
}

export async function createOrUpdateLocalActivity(noteLocalId: number, typeServerId: number, rawValue: string): Promise<number> {
  const note = await db.notes.get(noteLocalId)
  if (!note) throw new Error('Note not found')
  const type = await db.activityTypes.where('serverId').equals(typeServerId).first()
  if (!type) throw new Error('Activity type not found')
  const checked = validateActivityValue(type, rawValue)
  const now = new Date().toISOString()
  // Uniqueness per (noteId, typeId); update if exists
  const existing = await db.activities.where('noteId').equals(noteLocalId).filter(a => !a.deletedAt && a.typeId === typeServerId).first()
  if (existing?.id) {
    await db.activities.update(existing.id, { valueRaw: checked, modifiedAt: now, isDirty: 1 })
    await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
    emitLocalWrite()
    return existing.id
  }
  const id = await db.activities.add({
    noteId: noteLocalId,
    serverId: null,
    typeId: typeServerId,
    valueRaw: checked,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: 1,
  } as ActivityRecord)
  await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
  emitLocalWrite()
  return id
}

export async function deleteLocalActivity(noteLocalId: number, typeServerId: number): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.activities
    .where('noteId').equals(noteLocalId)
    .filter(a => !a.deletedAt && a.typeId === typeServerId)
    .first()
  if (existing?.id) {
    await db.activities.update(existing.id, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    await db.notes.update(noteLocalId, { modifiedAt: now, isDirty: 1 })
    emitLocalWrite()
  }
}

export async function createFilterLocal(spaceId: number, name: string, params: any, parentServerId?: number | null): Promise<number> {
  const now = new Date().toISOString()
  const id = await db.filters.add({
    spaceId,
    name,
    params,
    parentId: parentServerId ?? null,
    createdAt: now,
    modifiedAt: now,
    deletedAt: null,
    isDirty: 1,
    serverId: null,
    clientId: crypto.randomUUID(),
  } as unknown as FilterRecord)
  emitLocalWrite()
  return id
}

export async function updateFilterLocal(localId: number, changes: { name?: string; params?: any; parentServerId?: number | null }): Promise<void> {
  const now = new Date().toISOString()
  const partial: any = { modifiedAt: now, isDirty: 1 }
  if (typeof changes.name === 'string') partial.name = changes.name
  if (typeof changes.parentServerId !== 'undefined') partial.parentId = (changes.parentServerId ?? null)
  if (typeof changes.params !== 'undefined') partial.params = changes.params
  await db.filters.update(localId, partial)
  emitLocalWrite()
}

export async function deleteFilterLocal(localId: number): Promise<void> {
  const now = new Date().toISOString()
  await db.filters.update(localId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
  emitLocalWrite()
}

export async function updateNoteLocal(localId: number, changes: { text?: string; tags?: string[]; date?: string }): Promise<void> {
  const now = new Date().toISOString()
  await db.notes.update(localId, { ...changes, modifiedAt: now, isDirty: 1 })
  emitLocalWrite()
}

/** Makes a note a reply to `parentLocalId` (a note of the same space), or a note of its own with null.
 *  Its replies move with it. Returns false, changing nothing, when that would close a loop. */
export async function setNoteParentLocal(localId: number, parentLocalId: number | null): Promise<boolean> {
  let parentServerId: number | null = null
  if (parentLocalId != null) {
    const seen = new Set<number>()
    let cur: number | null | undefined = parentLocalId
    while (cur != null && !seen.has(cur)) {
      if (cur === localId) return false
      seen.add(cur)
      cur = (await db.notes.get(cur))?.parentId
    }
    parentServerId = (await db.notes.get(parentLocalId))?.serverId ?? null
  }
  const now = new Date().toISOString()
  await db.notes.update(localId, { parentId: parentLocalId, parentServerId, modifiedAt: now, isDirty: 1 })
  emitLocalWrite()
  return true
}

export async function addLocalAttachment(noteId: number, file: File): Promise<number> {
  const [id] = await addLocalAttachments(noteId, [file])
  return id
}

/** Adds images after the note's current ones, in the given order, and queues their uploads. */
export async function addLocalAttachments(noteId: number, files: File[]): Promise<number[]> {
  if (files.length === 0) return []
  const now = new Date().toISOString()
  const ids = await db.transaction('rw', db.attachments, db.jobs, async () => {
    const existing = await db.attachments.where('noteId').equals(noteId).filter(a => !a.deletedAt).toArray()
    let next = existing.reduce((m, a) => Math.max(m, a.position ?? -1), existing.length - 1) + 1
    const out: number[] = []
    for (const file of files) {
      const attId = await db.attachments.add({
        noteId,
        serverId: null,
        clientId: crypto.randomUUID(),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        data: file,
        position: next++,
        createdAt: now,
        modifiedAt: now,
        deletedAt: null,
        isDirty: 1,
      } as AttachmentRecord)
      await db.jobs.add({ kind: 'attachment-upload', attachmentId: attId, priority: 5, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: null })
      out.push(attId)
    }
    return out
  })
  emitLocalWrite()
  return ids
}

export async function deleteLocalAttachment(attachmentLocalId: number): Promise<void> {
  const now = new Date().toISOString()
  const att = await db.attachments.get(attachmentLocalId)
  if (!att) return
  await db.transaction('rw', db.attachments, db.notes, async () => {
    await db.attachments.update(attachmentLocalId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    // Touch parent note so /sync will accept attachment edits
    const note = await db.notes.get(att.noteId)
    if (note?.id) {
      await db.notes.update(note.id, { modifiedAt: now, isDirty: 1 })
    }
  })
  emitLocalWrite()
}

/**
 * Saves a new version of a file: the new bytes go up as a new attachment in the same place, under the
 * same name, and the old one is deleted (its server file goes with it). Works offline like any edit.
 */
export async function replaceLocalAttachment(attachmentLocalId: number, file: Blob): Promise<number | undefined> {
  const now = new Date().toISOString()
  const id = await db.transaction('rw', db.attachments, db.notes, db.jobs, async () => {
    const old = await db.attachments.get(attachmentLocalId)
    if (!old || old.deletedAt) return undefined
    const newId = await db.attachments.add({
      noteId: old.noteId,
      serverId: null,
      clientId: crypto.randomUUID(),
      fileName: old.fileName,
      fileType: old.fileType,
      fileSize: file.size,
      data: file,
      position: old.position ?? null,
      createdAt: now,
      modifiedAt: now,
      deletedAt: null,
      isDirty: 1,
    } as AttachmentRecord)
    await db.jobs.add({ kind: 'attachment-upload', attachmentId: newId, priority: 5, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: null })
    await db.attachments.update(attachmentLocalId, { deletedAt: now, modifiedAt: now, isDirty: 1 })
    // Touch the note so /sync accepts the deletion.
    const note = await db.notes.get(old.noteId)
    if (note?.id) await db.notes.update(note.id, { modifiedAt: now, isDirty: 1 })
    return newId
  })
  emitLocalWrite()
  return id
}

export async function reorderNoteAttachments(noteId: number, orderedAttachmentLocalIds: number[]): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', db.attachments, db.notes, async () => {
    let changed = false
    for (let i = 0; i < orderedAttachmentLocalIds.length; i++) {
      const att = await db.attachments.get(orderedAttachmentLocalIds[i])
      if (!att || att.deletedAt || att.noteId !== noteId || att.position === i) continue
      // Images still waiting for upload send their position with the file.
      await db.attachments.update(att.id!, { position: i, modifiedAt: now, isDirty: (att.serverId ? 1 : att.isDirty) as 0 | 1 })
      changed = true
    }
    const note = await db.notes.get(noteId)
    if (changed && note?.id) await db.notes.update(note.id, { modifiedAt: now, isDirty: 1 })
  })
  emitLocalWrite()
}
