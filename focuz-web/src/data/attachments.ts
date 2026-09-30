import { db } from '../lib/db'
import type { AttachmentRecord } from '../lib/types'

export async function listForNote(noteLocalId: number): Promise<AttachmentRecord[]> {
  return db.attachments.where('noteId').equals(noteLocalId).toArray()
}

export async function listActiveSortedForNote(noteLocalId: number): Promise<AttachmentRecord[]> {
  const list = await db.attachments.where('noteId').equals(noteLocalId).toArray()
  return list.filter(a => !a.deletedAt).sort((a, b) => (a.modifiedAt || '').localeCompare(b.modifiedAt || ''))
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
  // Sort by modifiedAt ASC to match server ordering semantics
  return result.sort((a, b) => (a.modifiedAt || '').localeCompare(b.modifiedAt || ''))
}

