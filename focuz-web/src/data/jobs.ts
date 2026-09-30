import { db } from '../lib/db'
import type { JobKind } from '../lib/types'

export async function countFailedAttachments(): Promise<number> {
  // We currently only have attachment jobs in this table.
  return db.jobs.where('status').equals('failed').count()
}

export async function countFailedByKind(kind: JobKind): Promise<number> {
  return db.jobs.where('status').equals('failed').and(j => j.kind === kind).count()
}

