import { db } from '../lib/db'
import type { NoteRecord } from '../lib/types'

export async function getByLocalId(id: number): Promise<NoteRecord | undefined> {
  return db.notes.get(id)
}

export async function listActiveBySpace(spaceId: number): Promise<NoteRecord[]> {
  return db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
}

export async function addDraft(note: NoteRecord): Promise<number> {
  const id = await db.notes.add(note)
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
  return id
}

export async function restoreDeleted(localId: number): Promise<void> {
  const rec = await db.notes.get(localId)
  if (!rec?.deletedAt) return
  const now = new Date().toISOString()
  await db.notes.update(localId, { deletedAt: null, modifiedAt: now, isDirty: 1 })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function getRepliesTallyBySpace(spaceId: number): Promise<Map<number, number>> {
  const all = await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
  const tally = new Map<number, number>()
  for (const note of all) {
    const pid = note.parentId ?? null
    if (pid !== null) tally.set(pid, (tally.get(pid) || 0) + 1)
  }
  return tally
}

