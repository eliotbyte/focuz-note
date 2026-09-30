import Dexie, { type Table } from 'dexie'
import type {
  MetaKV,
  NoteRecord,
  NoteConflictRecord,
  SpaceRecord,
  TagRecord,
  FilterRecord,
  ActivityRecord,
  ActivityTypeRecord,
  ChartRecord,
  AttachmentRecord,
  JobRecord,
} from './types'

const REQUIRED_STORES = [
  'spaces',
  'notes',
  'noteConflicts',
  'tags',
  'filters',
  'activities',
  'activityTypes',
  'charts',
  'meta',
  'attachments',
  'jobs',
] as const

class AppDatabase extends Dexie {
  spaces!: Table<SpaceRecord, number>
  notes!: Table<NoteRecord, number>
  noteConflicts!: Table<NoteConflictRecord, number>
  tags!: Table<TagRecord, number>
  filters!: Table<FilterRecord, number>
  activities!: Table<ActivityRecord, number>
  activityTypes!: Table<ActivityTypeRecord, number>
  charts!: Table<ChartRecord, number>
  meta!: Table<MetaKV, string>
  attachments!: Table<AttachmentRecord, number>
  jobs!: Table<JobRecord, number>

  constructor() {
    super('focuz-db')
    this.version(2).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
    })
    this.version(3).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      // add indexes for parentId and date for efficient filter/sort
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
    })
    this.version(4).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    })
    // Bump version to add clientId to filters index without data loss
    this.version(5).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    })
    // Add activityTypes and refine activities to include typeId/valueRaw
    this.version(6).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, typeId, createdAt, modifiedAt, deletedAt, isDirty',
      activityTypes: '++id, serverId, spaceId, name, valueType, createdAt, modifiedAt, deletedAt',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    }).upgrade(tx => {
      // Backfill typeId/valueRaw if upgrading from older schema; best-effort defaults
      try {
        return (tx.table('activities') as any).toCollection().modify((a: any) => {
          if (typeof a.typeId !== 'number') a.typeId = 0
          if (typeof a.valueRaw !== 'string') a.valueRaw = ''
        })
      } catch {}
    })
    // Add noteConflicts to persist local snapshots on sync conflicts.
    this.version(7).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      noteConflicts: '++id, noteLocalId, noteServerId, isResolved, createdAt',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, typeId, createdAt, modifiedAt, deletedAt, isDirty',
      activityTypes: '++id, serverId, spaceId, name, valueType, createdAt, modifiedAt, deletedAt',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    })
    // Add clientId to attachments for idempotent upload keys.
    this.version(8).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      noteConflicts: '++id, noteLocalId, noteServerId, isResolved, createdAt',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, typeId, createdAt, modifiedAt, deletedAt, isDirty',
      activityTypes: '++id, serverId, spaceId, name, valueType, createdAt, modifiedAt, deletedAt',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, clientId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    }).upgrade(tx => {
      try {
        return (tx.table('attachments') as any).toCollection().modify((a: any) => {
          if (typeof a.clientId !== 'string') a.clientId = null
        })
      } catch {}
    })
    // Notes: parentId becomes strictly a *local* id (it used to hold a server id for pulled notes
    // and a local id for notes created on this device), plus sync bookkeeping fields.
    // Only non-indexed fields change, the store layout stays the same.
    this.version(9).stores({
      spaces: '++id, serverId, name, createdAt, modifiedAt, deletedAt, isDirty',
      notes: '++id, serverId, clientId, spaceId, parentId, date, createdAt, modifiedAt, deletedAt, isDirty',
      noteConflicts: '++id, noteLocalId, noteServerId, isResolved, createdAt',
      tags: '++id, serverId, spaceId, name, createdAt, modifiedAt, deletedAt, isDirty',
      filters: '++id, serverId, clientId, spaceId, parentId, name, createdAt, modifiedAt, deletedAt, isDirty',
      activities: '++id, serverId, noteId, typeId, createdAt, modifiedAt, deletedAt, isDirty',
      activityTypes: '++id, serverId, spaceId, name, valueType, createdAt, modifiedAt, deletedAt',
      charts: '++id, serverId, noteId, createdAt, modifiedAt, deletedAt, isDirty',
      meta: 'key',
      attachments: '++id, serverId, clientId, noteId, fileName, createdAt, modifiedAt, deletedAt, isDirty',
      jobs: '++id, kind, attachmentId, priority, status, attempts, createdAt, updatedAt',
    }).upgrade(async tx => {
      const notes = await tx.table('notes').toArray() as NoteRecord[]
      for (const u of planNoteParentMigration(notes)) {
        await tx.table('notes').update(u.id, u.changes)
      }
      await tx.table('filters').toCollection().modify((f: FilterRecord) => {
        if (f.serverId && f.isDirty === 0 && !f.serverModifiedAt) f.serverModifiedAt = f.modifiedAt
      })
      // Give stuck/failed jobs a fresh start with the new retry policy.
      await tx.table('jobs').toCollection().modify((j: JobRecord) => {
        if (j.status !== 'pending') { j.status = 'pending'; j.attempts = 0 }
        j.nextAttemptAt = null
      })
    })
    // Ensure the connection closes on external version changes (e.g., deleteDatabase in another tab)
    try { this.on('versionchange', () => { try { this.close() } catch {} }) } catch {}
  }
}

/**
 * Computes the v9 note migration. Before v9, `parentId` held the server id for notes that came
 * from the server (pull overwrote it) and a local id for notes created on this device and not
 * synced yet. After v9 it is always a local id; the server id is kept in `parentServerId`.
 * Exported for tests.
 */
export function planNoteParentMigration(notes: NoteRecord[]): Array<{ id: number; changes: Partial<NoteRecord> }> {
  const byLocal = new Map<number, NoteRecord>()
  const localByServer = new Map<number, number>()
  for (const n of notes) {
    if (n.id != null) byLocal.set(n.id, n)
    if (n.serverId != null && n.id != null) localByServer.set(n.serverId, n.id)
  }
  const out: Array<{ id: number; changes: Partial<NoteRecord> }> = []
  for (const n of notes) {
    if (n.id == null) continue
    const changes: Partial<NoteRecord> = {}
    const pid = n.parentId ?? null
    if (pid != null) {
      if (n.serverId != null) {
        // Came from the server: parentId is a server id.
        const local = localByServer.get(pid)
        changes.parentId = local ?? null
        changes.parentServerId = pid
      } else {
        // Local draft: parentId already is a local id.
        const parent = byLocal.get(pid)
        changes.parentServerId = parent?.serverId ?? null
      }
    } else {
      changes.parentServerId = null
    }
    if (n.serverId != null && n.isDirty === 0 && !n.serverModifiedAt) changes.serverModifiedAt = n.modifiedAt
    out.push({ id: n.id, changes })
  }
  return out
}

export let db = new AppDatabase()

function missingStores(): string[] {
  try {
    const idb = (db as any).backendDB?.() as IDBDatabase | undefined
    if (!idb) return []
    const existing = new Set(Array.from(idb.objectStoreNames))
    return REQUIRED_STORES.filter(s => !existing.has(s))
  } catch {
    return []
  }
}

export async function getKV<T = string>(key: string, fallback?: T): Promise<T | undefined> {
  const row = await db.meta.get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return (row.value as unknown as T) ?? fallback
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(value) })
}

export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.spaces, db.notes, db.noteConflicts, db.tags, db.filters, db.activities, db.charts, db.meta, db.attachments, db.jobs], async () => {
    await Promise.all([
      db.spaces.clear(),
      db.notes.clear(),
      db.noteConflicts.clear(),
      db.tags.clear(),
      db.filters.clear(),
      db.activities.clear(),
      db.charts.clear(),
      db.meta.clear(),
      db.attachments.clear(),
      db.jobs.clear(),
    ])
  })
} 

export async function deleteDatabase(): Promise<void> {
  try { db.close() } catch {}
  try {
    await Dexie.delete('focuz-db')
    return
  } catch {}
  // Native fallback in case Dexie.delete hangs due to stray connections
  await new Promise<void>((resolve, reject) => {
    try {
      const req = indexedDB.deleteDatabase('focuz-db')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.onblocked = () => {
        // Leave unresolved; caller should retry after closing blockers
      }
    } catch (e) {
      reject(e as any)
    }
  })
}

export async function deleteDatabaseWithRetry(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (true) {
    try { await deleteDatabase(); return } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('Timed out deleting focuz-db')
    try { db.close() } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
}

export async function ensureDbOpen(): Promise<void> {
  // Dexie opens lazily; we force open here and also validate the *actual* IndexedDB object stores.
  // This protects users after deployments when an old DB schema is still present (or an upgrade was blocked),
  // which would otherwise throw: "Failed to execute 'objectStore' on 'IDBTransaction'".
  const openAndValidate = async () => {
    await db.open()
    const missing = missingStores()
    if (missing.length > 0) throw new Error(`DB_SCHEMA_MISSING_STORES:${missing.join(',')}`)
  }

  try {
    await openAndValidate()
  } catch {
    // Close and recreate the Dexie instance (triggers the upgrade without data loss).
    // Never delete the database here: it may hold notes that were not synced yet.
    try { db.close() } catch {}
    db = new AppDatabase()
    await openAndValidate()
  }
}
