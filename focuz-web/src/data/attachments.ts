import { db } from '../lib/db'
import type { AttachmentRecord } from '../lib/types'

export async function listForNote(noteLocalId: number): Promise<AttachmentRecord[]> {
  return db.attachments.where('noteId').equals(noteLocalId).toArray()
}

/** Order of images in a note: by position, then (records without one) by creation. */
export function compareAttachments(a: AttachmentRecord, b: AttachmentRecord): number {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER
  const pb = b.position ?? Number.MAX_SAFE_INTEGER
  return (pa - pb) || (a.createdAt || '').localeCompare(b.createdAt || '') || ((a.id ?? 0) - (b.id ?? 0))
}

export async function listActiveSortedForNote(noteLocalId: number): Promise<AttachmentRecord[]> {
  const list = await db.attachments.where('noteId').equals(noteLocalId).toArray()
  return list.filter(a => !a.deletedAt).sort(compareAttachments)
}

export async function listDisplayForNote(noteLocalId: number): Promise<AttachmentRecord[]> {
  const list = await db.attachments.where('noteId').equals(noteLocalId).toArray()
  // Deduplicate: prefer server-side id when present; otherwise use (fileName,fileSize) heuristic.
  const byServer = new Map<string, AttachmentRecord>()
  const localSeen = new Set<string>()
  for (const a of list) {
    if (a.deletedAt) continue
    if (a.serverId) {
      const existing = byServer.get(a.serverId)
      if (!existing) byServer.set(a.serverId, a)
      else if (!!a.data && !existing.data) byServer.set(a.serverId, a)
    } else {
      const k = `${a.fileName}:${a.fileSize}`
      if (!localSeen.has(k)) localSeen.add(k)
    }
  }
  // Merge server-identified with local-only that don't conflict
  const result: AttachmentRecord[] = []
  byServer.forEach(v => result.push(v))
  for (const a of list) {
    if (a.deletedAt || a.serverId) continue
    const conflict = result.some(x => x.fileName === a.fileName && x.fileSize === a.fileSize)
    if (!conflict) result.push(a)
  }
  return result.sort(compareAttachments)
}

