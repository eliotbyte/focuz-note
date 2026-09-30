import { db } from '../lib/db'
import type { ActivityRecord } from '../lib/types'
import { listAll as listAllTypes } from './activity-types'

export async function listForNote(noteLocalId: number): Promise<ActivityRecord[]> {
  return db.activities.where('noteId').equals(noteLocalId).toArray()
}

export async function listActiveForNotes(noteLocalIds: number[]): Promise<ActivityRecord[]> {
  const ids = Array.from(new Set(noteLocalIds)).filter(Boolean)
  if (ids.length === 0) return []
  const list = await db.activities.where('noteId').anyOf(ids).toArray()
  return list.filter(a => !a.deletedAt)
}

export async function listDecoratedForNote(noteLocalId: number): Promise<Array<ActivityRecord & { _name: string; _valueType: string }>> {
  const list = await db.activities.where('noteId').equals(noteLocalId).toArray()
  const filtered = list.filter(a => !a.deletedAt)
  // Deduplicate per typeId: prefer server-backed; fallback to most recent modifiedAt
  const bestByType = new Map<number, typeof filtered[number]>()
  for (const a of filtered) {
    const prev = bestByType.get(a.typeId)
    if (!prev) { bestByType.set(a.typeId, a); continue }
    const score = (Number(!!a.serverId) - Number(!!prev.serverId)) || ((a.modifiedAt || '').localeCompare(prev.modifiedAt || ''))
    if (score > 0) bestByType.set(a.typeId, a)
  }
  const deduped = Array.from(bestByType.values())
  const types = await listAllTypes()
  const byId = new Map(types.map(t => [t.serverId!, t]))
  return deduped.map(a => ({
    ...a,
    _name: byId.get(a.typeId)?.name || `#${a.typeId}`,
    _valueType: byId.get(a.typeId)?.valueType || 'text',
  }))
}

export async function listDraftsForNote(noteLocalId: number): Promise<Array<{ typeId: number; valueRaw: string; serverId?: number | null; modifiedAt?: string }>> {
  const acts = await db.activities.where('noteId').equals(noteLocalId).toArray()
  const filtered = acts.filter(a => !a.deletedAt)
  const bestByType = new Map<number, typeof filtered[number]>()
  for (const a of filtered) {
    const prev = bestByType.get(a.typeId)
    if (!prev) { bestByType.set(a.typeId, a); continue }
    const score = (Number(!!a.serverId) - Number(!!prev.serverId)) || ((a.modifiedAt || '').localeCompare(prev.modifiedAt || ''))
    if (score > 0) bestByType.set(a.typeId, a)
  }
  return Array.from(bestByType.values()).map(a => ({ typeId: a.typeId, valueRaw: a.valueRaw, serverId: a.serverId, modifiedAt: a.modifiedAt }))
}

