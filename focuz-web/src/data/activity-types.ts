import { db } from '../lib/db'
import type { ActivityTypeRecord } from '../lib/types'

export async function listForSpace(spaceId?: number | null): Promise<ActivityTypeRecord[]> {
  const all = await db.activityTypes.toArray()
  const list = (spaceId != null)
    ? all.filter(t => (t.spaceId === spaceId || t.spaceId === 0 || t.spaceId == null) && !t.deletedAt)
    : all.filter(t => !t.deletedAt)
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

export async function listAll(): Promise<ActivityTypeRecord[]> {
  return db.activityTypes.toArray()
}

