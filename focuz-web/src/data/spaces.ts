import { db } from '../lib/db'
import type { SpaceRecord } from '../lib/types'

export async function listAll(): Promise<SpaceRecord[]> {
  return db.spaces.orderBy('createdAt').toArray()
}

