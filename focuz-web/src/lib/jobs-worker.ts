// Background queue for attachment uploads/downloads (table `jobs`).
//
// Rules:
//  - a job that cannot run yet (note not on the server, backoff) never blocks the others;
//  - "server unreachable" is not a job failure: the job just waits, attempts are not counted;
//  - other errors are retried with exponential backoff and marked `failed` after MAX_ATTEMPTS,
//    then only a manual retry (status popover) re-queues them.
import { db } from './db'
import { ApiError, api, apiBlob, apiMultipart, fetchBlobUrl, isNetworkError, isTransientError } from './api'
import type { AttachmentRecord, JobRecord } from './types'

export const MAX_ATTEMPTS = 5
const RUNNING_STALE_MS = 3 * 60 * 1000
const WAIT_FOR_NOTE_MS = 3000

export type JobOutcome =
  | { kind: 'done' }
  | { kind: 'deferred' } // could not run yet, try the next job
  | { kind: 'offline'; error: unknown } // server unreachable: stop the queue until sync recovers
  | { kind: 'retry'; error: unknown }
  | { kind: 'failed'; error: unknown }

export function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60 * 1000, 2000 * 2 ** Math.max(0, attempts - 1))
}

function emitJobsChanged() {
  try { window.dispatchEvent(new Event('focuz:jobs-changed')) } catch {}
}

/** Jobs that may run now, best first. */
export async function runnableJobs(now = Date.now()): Promise<JobRecord[]> {
  const all = await db.jobs.toArray()
  return all
    .filter(j => j.status === 'pending' || (j.status === 'running' && now - Date.parse(j.updatedAt) > RUNNING_STALE_MS))
    .filter(j => !j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= now)
    .sort((a, b) => (a.priority - b.priority) || a.createdAt.localeCompare(b.createdAt) || ((a.id ?? 0) - (b.id ?? 0)))
}

async function claim(job: JobRecord): Promise<boolean> {
  const now = Date.now()
  const updated = await db.jobs.where('id').equals(job.id!)
    .and(j => j.status === 'pending' || (j.status === 'running' && now - Date.parse(j.updatedAt) > RUNNING_STALE_MS))
    .modify({ status: 'running', updatedAt: new Date(now).toISOString() })
  return updated > 0
}

async function upload(job: JobRecord): Promise<JobOutcome> {
  const att = await db.attachments.get(job.attachmentId)
  if (!att || att.deletedAt) return { kind: 'done' }
  if (att.serverId) return { kind: 'done' }
  const note = await db.notes.get(att.noteId)
  if (!note || note.deletedAt) return { kind: 'done' }
  if (!note.serverId) return { kind: 'deferred' }
  if (!att.data) return { kind: 'failed', error: new Error('Local file data is missing') }

  const form = new FormData()
  form.append('file', att.data as Blob, att.fileName)
  form.append('note_id', String(note.serverId))
  if (att.clientId) form.append('client_id', att.clientId)
  if (typeof att.position === 'number') form.append('position', String(att.position))
  const resp = await apiMultipart('/upload', form)
  const serverId = (resp?.data?.attachment_id as string | undefined) || (resp?.data?.id as string | undefined)
  await db.transaction('rw', db.attachments, db.jobs, async () => {
    const current = await db.attachments.get(att.id!)
    if (!serverId) { if (current) await db.attachments.update(att.id!, { isDirty: 0 }); return }
    // Reordered while the file was on its way: the new position still has to be pushed.
    const moved = !!current && (current.position ?? null) !== (att.position ?? null)
    // A pull may already have created a record for this server id: keep one record with the data.
    const other = await db.attachments.where('serverId').equals(serverId).first()
    if (other && other.id !== att.id) {
      const patch: Partial<AttachmentRecord> = {}
      if (!other.data && current?.data) patch.data = current.data
      if (moved) { patch.position = current!.position; patch.isDirty = 1 }
      if (Object.keys(patch).length) await db.attachments.update(other.id!, patch)
      if (current) await db.attachments.delete(att.id!)
      await db.jobs.where('attachmentId').equals(att.id!).and(j => j.id !== job.id).delete()
    } else if (current) {
      await db.attachments.update(att.id!, { serverId, isDirty: moved ? 1 : 0 })
    }
  })
  return { kind: 'done' }
}

async function download(job: JobRecord): Promise<JobOutcome> {
  const att = await db.attachments.get(job.attachmentId)
  if (!att?.serverId || att.data || att.deletedAt) return { kind: 'done' }
  let blob: Blob
  try {
    blob = await apiBlob(`/files/${encodeURIComponent(att.serverId)}/content`)
  } catch (e) {
    // Older API without the content endpoint answers with a plain 404 page: fall back to a presigned URL.
    if (!(e instanceof ApiError && e.status === 404 && (e.body as any)?.success === undefined)) throw e
    const meta = await api(`/files/${encodeURIComponent(att.serverId)}`, { method: 'GET' })
    const url = meta?.data?.url || meta?.data?.URL || meta?.data?.signedUrl || meta?.data?.signed_url
    if (!url) throw new Error('No download URL')
    blob = await fetchBlobUrl(url)
  }
  // Do not touch modifiedAt: it defines the order of images in a note.
  await db.attachments.update(att.id!, { data: blob })
  return { kind: 'done' }
}

export async function runJob(job: JobRecord): Promise<JobOutcome> {
  try {
    if (job.kind === 'attachment-upload') return await upload(job)
    if (job.kind === 'attachment-download') return await download(job)
    return { kind: 'done' }
  } catch (e) {
    if (isNetworkError(e)) return { kind: 'offline', error: e }
    if ((e as any)?.status === 401) return { kind: 'offline', error: e }
    if (isTransientError(e)) return { kind: 'retry', error: e }
    // 404 on download: the file is gone on the server; retrying will not help.
    if (job.kind === 'attachment-download' && (e as any)?.status === 404) return { kind: 'failed', error: e }
    return { kind: 'retry', error: e }
  }
}

async function settle(job: JobRecord, outcome: JobOutcome): Promise<void> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  switch (outcome.kind) {
    case 'done':
      await db.jobs.delete(job.id!)
      break
    case 'deferred':
      await db.jobs.update(job.id!, { status: 'pending', updatedAt: nowIso, nextAttemptAt: new Date(now + WAIT_FOR_NOTE_MS).toISOString() })
      break
    case 'offline':
      await db.jobs.update(job.id!, { status: 'pending', updatedAt: nowIso, lastError: errorText(outcome.error) })
      break
    case 'retry': {
      const attempts = (job.attempts ?? 0) + 1
      const failed = attempts >= MAX_ATTEMPTS
      await db.jobs.update(job.id!, {
        status: failed ? 'failed' : 'pending',
        attempts,
        updatedAt: nowIso,
        nextAttemptAt: failed ? null : new Date(now + retryDelayMs(attempts)).toISOString(),
        lastError: errorText(outcome.error),
      })
      if (failed) outcome = { kind: 'failed', error: outcome.error }
      break
    }
    case 'failed':
      await db.jobs.update(job.id!, { status: 'failed', attempts: (job.attempts ?? 0) + 1, updatedAt: nowIso, nextAttemptAt: null, lastError: errorText(outcome.error) })
      break
  }
  emitJobsChanged()
}

function errorText(e: unknown): string {
  return String((e as any)?.message || e || 'Unknown error')
}

/**
 * Runs at most one job. Returns what happened so the caller can schedule the next tick.
 * `onFailed` is called when a job is given up on (for user notification).
 */
export async function processNextJob(onFailed?: (job: JobRecord, error: unknown) => void): Promise<'did' | 'idle' | 'offline'> {
  const candidates = await runnableJobs()
  for (const job of candidates) {
    if (!(await claim(job))) continue
    const outcome = await runJob(job)
    const finalKind = outcome.kind === 'retry' && (job.attempts ?? 0) + 1 >= MAX_ATTEMPTS ? 'failed' : outcome.kind
    await settle(job, outcome)
    if (finalKind === 'failed' && onFailed) onFailed(job, (outcome as any).error)
    if (outcome.kind === 'deferred') continue
    if (outcome.kind === 'offline') return 'offline'
    return 'did'
  }
  return 'idle'
}

/** Queue a download (or make an existing one run sooner). */
export async function ensureDownloadJob(attachmentLocalId: number, priority: number): Promise<void> {
  await db.transaction('rw', db.jobs, db.attachments, db.notes, async () => {
    const att = await db.attachments.get(attachmentLocalId)
    if (!att?.serverId || att.data || att.deletedAt) return
    const note = await db.notes.get(att.noteId)
    if (!note || note.deletedAt) return
    const existing = await db.jobs.where('attachmentId').equals(attachmentLocalId).filter(j => j.kind === 'attachment-download').first()
    const nowIso = new Date().toISOString()
    if (existing) {
      if (existing.priority > priority) await db.jobs.update(existing.id!, { priority })
      return
    }
    await db.jobs.add({ kind: 'attachment-download', attachmentId: attachmentLocalId, priority, status: 'pending', attempts: 0, createdAt: nowIso, updatedAt: nowIso, nextAttemptAt: null })
  })
}

/** Re-queue every failed job (manual "Retry" in the status popover). */
export async function retryFailedJobs(): Promise<number> {
  const n = await db.jobs.where('status').equals('failed').modify({ status: 'pending', attempts: 0, nextAttemptAt: null, updatedAt: new Date().toISOString() })
  emitJobsChanged()
  return n
}

/** Called once per leader start: jobs left "running" by a closed tab become runnable again. */
export async function releaseStaleRunningJobs(): Promise<void> {
  await db.jobs.where('status').equals('running').modify({ status: 'pending' })
}
