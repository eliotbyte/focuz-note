import { db } from '../lib/db'
import type { FilterRecord } from '../lib/types'

export async function listActiveBySpace(spaceId: number): Promise<FilterRecord[]> {
  return db.filters.where('spaceId').equals(spaceId).filter(f => !f.deletedAt).toArray()
}

export async function getByLocalId(id: number): Promise<FilterRecord | undefined> {
  return db.filters.get(id)
}

export async function getByServerId(serverId: number): Promise<FilterRecord | undefined> {
  return db.filters.where('serverId').equals(serverId).first()
}

export async function softDeleteMany(localIds: number[]): Promise<void> {
  const ids = Array.from(new Set(localIds)).filter(Boolean)
  if (ids.length === 0) return
  const now = new Date().toISOString()
  await db.transaction('rw', db.filters, async () => {
    for (const id of ids) await db.filters.update(id, { deletedAt: now, modifiedAt: now, isDirty: 1 })
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function restoreDeletedMany(localIds: number[]): Promise<void> {
  const ids = Array.from(new Set(localIds)).filter(Boolean)
  if (ids.length === 0) return
  const now = new Date().toISOString()
  await db.transaction('rw', db.filters, async () => {
    for (const id of ids) {
      const rec = await db.filters.get(id)
      if (rec?.deletedAt) await db.filters.update(id, { deletedAt: null, modifiedAt: now, isDirty: 1 })
    }
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

export async function bulkUpdate(
  updates: Array<{ id: number; changes: Partial<Pick<FilterRecord, 'parentId' | 'params' | 'modifiedAt' | 'isDirty'>> }>
): Promise<void> {
  if (!updates.length) return
  await db.transaction('rw', db.filters, async () => {
    for (const u of updates) await db.filters.update(u.id, u.changes as any)
  })
  try { window.dispatchEvent(new Event('focuz:local-write')) } catch {}
}

