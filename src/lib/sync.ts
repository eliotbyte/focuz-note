// Sync engine: decides *when* to sync (local writes, focus, websocket nudges, retries) and
// reports status through app-state. The actual work lives in sync-push / sync-pull / jobs-worker.
//
// Only one tab (the leader, elected with the Web Locks API) talks to the server. Other tabs
// forward their sync requests over a BroadcastChannel and mirror the leader's status.
import { db, getKV, setKV, wipeLocalData, deleteDatabase, deleteDatabaseWithRetry, ensureDbOpen } from './db'
import type { SpaceRecord } from './types'
import { LAST_SYNC_OK_KV, markConflictsDetected, markJobFailed, patchSyncState, type SyncStatePatch } from './app-state'
import { api, getApiBase, isNetworkError, isTransientError } from './api'
import { authBC, clearAuthToken, emitAuthRequired, getAuthToken, isAuthRequired, setAuthTokenLS, setLastUsername } from './auth'
import { pushDirty, recoverLegacyConflicts } from './sync-push'
import { pullSince } from './sync-pull'
import { ensureDownloadJob, processNextJob, releaseStaleRunningJobs, retryFailedJobs } from './jobs-worker'

export { isAuthRequired, onAuthRequired, getLastUsername } from './auth'
export { validateActivityValue } from './activity-values'
export {
  deleteNote, createOrUpdateLocalActivity, deleteLocalActivity, createFilterLocal, updateFilterLocal, deleteFilterLocal,
  updateNoteLocal, addLocalAttachment, deleteLocalAttachment, reorderNoteAttachments,
} from './local-writes'

const env = import.meta.env
const BASE_SYNC_INTERVAL_MS = Number(env.VITE_SYNC_INTERVAL_MS ?? '60000') || 60000
const DEBOUNCE_LOCAL_MS = Number(env.VITE_SYNC_DEBOUNCE_MS ?? '2000') || 2000
const WS_COOLDOWN_MS = Number(env.VITE_SYNC_WS_COOLDOWN_MS ?? '3000') || 3000
const NO_CHANGE_BACKOFF_MS = Number(env.VITE_SYNC_BACKOFF_MS ?? '15000') || 15000
const CURRENT_SPACE_KV = 'currentSpaceId'
const MAX_PUSH_ROUNDS = 5
const JOB_IDLE_TICK_MS = 2000

let syncBC: BroadcastChannel | null = null
try { syncBC = new BroadcastChannel('focuz-sync') } catch {}

// ---------------------------------------------------------------------------
// Auth

export type AccountField = 'username' | 'email'

/** Creates an account. On e-mail servers the account must be confirmed before signing in. */
export async function register(login: string, password: string, field: AccountField = 'username'): Promise<{ verificationRequired: boolean; email?: string }> {
  const resp = await api('/register', { method: 'POST', body: JSON.stringify({ [field]: login, password }) })
  return { verificationRequired: !!resp?.data?.verificationRequired, email: resp?.data?.email }
}

export async function login(loginName: string, password: string, field: AccountField = 'username'): Promise<void> {
  await ensureDbOpen().catch(() => {})
  const resp = await api('/login', { method: 'POST', body: JSON.stringify({ [field]: loginName, password }) })
  const token = resp?.data?.token as string
  if (!token) throw new Error('No token')
  await finishSignIn(token, loginName)
}

/** Confirms an e-mail address with the code from the e-mail; signs the user in. */
export async function verifyEmail(email: string, code: string): Promise<void> {
  await ensureDbOpen().catch(() => {})
  const resp = await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) })
  const token = resp?.data?.token as string
  if (!token) throw new Error('No token')
  await finishSignIn(token, email)
}

export async function resendVerification(email: string): Promise<{ retryAfterSeconds: number }> {
  const resp = await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) })
  return { retryAfterSeconds: Number(resp?.data?.retryAfterSeconds) || 60 }
}

const SERVER_KV = 'serverUrl'

async function finishSignIn(token: string, displayName: string) {
  // Local data belongs to one server: never mix notes from two servers in one database.
  try {
    const current = getApiBase()
    const previous = await getKV<string>(SERVER_KV)
    if (previous && current && previous !== current) await wipeLocalData()
    if (current) await setKV(SERVER_KV, current)
  } catch {}
  setLastUsername(displayName)
  setAuthTokenLS(token)
  emitAuthRequired(false)
  resetFailureState()
}

export function isAuthenticated(): boolean {
  return !!getAuthToken()
}

export function logout(): void {
  clearAuthToken()
  try { authBC?.postMessage({ type: 'logout' }) } catch {}
  deleteDatabase().catch(() => { wipeLocalData().catch(() => {}) })
}

export async function purgeAndLogout(): Promise<void> {
  try { teardownSync() } catch {}
  clearAuthToken()
  try { authBC?.postMessage({ type: 'logout' }) } catch {}
  try { await deleteDatabaseWithRetry(4000) } catch { try { await wipeLocalData() } catch {} }
}

/** Local changes that would be lost by logging out (logout drops the local database). */
export async function countUnsyncedChanges(): Promise<number> {
  const [n, f, a, j] = await Promise.all([
    db.notes.where('isDirty').equals(1).count(),
    db.filters.where('isDirty').equals(1).count(),
    db.activities.where('isDirty').equals(1).count(),
    db.jobs.where('kind').equals('attachment-upload').count(),
  ])
  return n + f + a + j
}

export async function setAuthToken(token: string) {
  await ensureDbOpen().catch(() => {})
  setAuthTokenLS(token)
  emitAuthRequired(false)
  await runSync(true)
}

// ---------------------------------------------------------------------------
// Spaces

export async function listSpaces(): Promise<Array<{ id: number; name: string }>> {
  const resp = await api('/spaces', { method: 'GET' })
  return resp?.data?.data ?? []
}

export async function ensureDefaultSpace(): Promise<number> {
  const existing = await db.spaces.filter(s => !s.deletedAt).toArray()
  if (existing.length > 0) {
    const stored = await getKV<number>(CURRENT_SPACE_KV)
    const current = stored && existing.some(s => s.id === stored) ? stored : existing[0].id!
    await setKV(CURRENT_SPACE_KV, current)
    return current
  }
  const now = new Date().toISOString()
  let serverId: number | null = null
  let name = 'My Space'
  try {
    if (getApiBase() && getAuthToken()) {
      const spaces = await listSpaces()
      if (spaces.length > 0) { serverId = spaces[0].id; name = spaces[0].name }
      else serverId = (await api('/spaces', { method: 'POST', body: JSON.stringify({ name }) }))?.data?.id ?? null
    }
  } catch {
    // offline: a local space is created and pushed later
  }
  const id = await db.spaces.add({ serverId, name, createdAt: now, modifiedAt: now, deletedAt: null, isDirty: serverId ? 0 : 1 } as SpaceRecord)
  await setKV(CURRENT_SPACE_KV, id)
  return id
}

export async function getCurrentSpaceId(): Promise<number> {
  const id = await getKV<number>(CURRENT_SPACE_KV)
  if (id) return id
  return ensureDefaultSpace()
}

// ---------------------------------------------------------------------------
// Engine state

type Role = 'standalone' | 'leader' | 'follower'
let role: Role = 'standalone' // before scheduleAutoSync (e.g. right after login) syncs run in-tab
let stopRequested = false
let running: Promise<void> | null = null
let queued = false
let failures = 0
let backoffUntilMs = 0
let noChangeUntilMs = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let jobTimer: ReturnType<typeof setTimeout> | null = null
let jobsPausedOffline = false
let lastCleanup: (() => void) | null = null
let releaseLeaderLock: (() => void) | null = null
const TAB_ID = (() => { try { return crypto.randomUUID() } catch { return String(Math.random()) } })()

function setSyncState(patch: SyncStatePatch) {
  patchSyncState(patch)
  if (role === 'leader') {
    try { syncBC?.postMessage({ type: 'state', tabId: TAB_ID, patch }) } catch {}
  }
}

function resetFailureState() {
  failures = 0
  backoffUntilMs = 0
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  setSyncState({ nextRetryAt: null })
}

/** Delay before the n-th consecutive retry: 2s, 4s, 8s ... capped at 60s, with jitter. */
export function failureBackoffMs(n: number): number {
  const base = Math.min(60000, 2000 * 2 ** Math.max(0, n - 1))
  return Math.round(base * (0.85 + Math.random() * 0.3))
}

function canTalkToServer(): boolean {
  return !!getApiBase() && !!getAuthToken() && !isAuthRequired()
}

function describeError(e: unknown): string {
  if (isNetworkError(e)) return 'Server unreachable'
  const status = (e as any)?.status
  if (status === 401) return 'Session expired'
  if (typeof status === 'number' && status >= 500) return `Server error (${status})`
  return String((e as any)?.message || e || 'Sync failed')
}

function scheduleRetry(delayMs: number) {
  if (retryTimer) clearTimeout(retryTimer)
  backoffUntilMs = Date.now() + delayMs
  setSyncState({ nextRetryAt: new Date(backoffUntilMs).toISOString() })
  retryTimer = setTimeout(() => { retryTimer = null; void runSync(true) }, delayMs)
}

export interface RunSyncOptions {
  /** Bypass the "nothing changed recently" throttle (local writes, user action). */
  force?: boolean
}

/**
 * Runs push+pull once (or joins the run in progress). Never throws: failures are reported via
 * app-state and retried automatically with exponential backoff.
 */
export async function runSync(force: boolean | RunSyncOptions = false): Promise<void> {
  const opts: RunSyncOptions = typeof force === 'boolean' ? { force } : force
  if (role === 'follower') { requestLeaderSync(); return }
  if (stopRequested && role === 'leader') return
  if (!canTalkToServer()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const now = Date.now()
  if (!opts.force && (now < backoffUntilMs || now < noChangeUntilMs)) return
  if (running) { queued = true; return running }

  running = (async () => {
    setSyncState({ syncing: true })
    try {
      await ensureDbOpen()
      let applied = 0
      for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
        const r = await pushDirty()
        applied += r.applied
        if (r.conflicts > 0) markConflictsDetected(r.conflicts)
        // Another round when replies waited for their parent's server id (now mapped)
        // or when a conflict produced a conflict copy that should be uploaded too.
        const parentsMapped = r.deferred > 0 && r.mapped > 0
        if (!parentsMapped && r.conflicts === 0 && r.requeued === 0) break
      }
      const pulled = await pullSince()
      const okAt = new Date().toISOString()
      await setKV(LAST_SYNC_OK_KV, okAt)
      resetFailureState()
      noChangeUntilMs = applied === 0 && pulled.pulled === 0 ? Date.now() + NO_CHANGE_BACKOFF_MS : 0
      setSyncState({ syncError: null, serverReachable: true, lastSyncAt: okAt })
      try { window.dispatchEvent(new Event('focuz:sync-applied')) } catch {}
      if (jobsPausedOffline) { jobsPausedOffline = false; kickJobs() }
    } catch (e) {
      failures++
      const unreachable = isNetworkError(e)
      setSyncState({ syncError: describeError(e), serverReachable: !unreachable })
      if ((e as any)?.status !== 401) scheduleRetry(isTransientError(e) ? failureBackoffMs(failures) : Math.max(30000, failureBackoffMs(failures)))
      if (!isTransientError(e) && (e as any)?.status !== 401) console.error('Sync failed', e)
    } finally {
      setSyncState({ syncing: false })
      running = null
      if (queued) {
        queued = false
        setTimeout(() => { void runSync(true) }, 0)
      }
    }
  })()
  return running
}

// ---------------------------------------------------------------------------
// Attachment jobs

function kickJobs(delay = 0) {
  if (role === 'follower') { try { syncBC?.postMessage({ type: 'jobs-kick', tabId: TAB_ID }) } catch {} ; return }
  if (stopRequested || role === 'standalone') return
  if (jobTimer) clearTimeout(jobTimer)
  jobTimer = setTimeout(jobTick, delay)
}

async function jobTick() {
  jobTimer = null
  if (stopRequested || role !== 'leader') return
  let next = JOB_IDLE_TICK_MS
  if (canTalkToServer() && navigator.onLine !== false && !jobsPausedOffline) {
    try {
      const r = await processNextJob((job, error) => markJobFailed(job.kind, String((error as any)?.message || error || '')))
      if (r === 'did') next = 0
      else if (r === 'offline') {
        // Server unreachable: let the sync backoff probe the server, resume jobs after it succeeds.
        jobsPausedOffline = true
        setSyncState({ serverReachable: false })
        if (!retryTimer) { failures++; scheduleRetry(failureBackoffMs(failures)) }
      }
    } catch (e) {
      console.error('Job worker error', e)
    }
  }
  if (!stopRequested) jobTimer = setTimeout(jobTick, next)
}

export async function requestAttachmentPrefetch(attachmentLocalId: number, priority = 1): Promise<void> {
  await ensureDownloadJob(attachmentLocalId, priority)
  kickJobs()
}

export async function retryFailedAttachments(): Promise<void> {
  await retryFailedJobs()
  jobsPausedOffline = false
  kickJobs()
}

// ---------------------------------------------------------------------------
// Scheduling

let lastWSTriggerMs = 0
let localKickTimer: ReturnType<typeof setTimeout> | null = null

function requestLeaderSync() {
  try { syncBC?.postMessage({ type: 'sync-request', tabId: TAB_ID }) } catch {}
}

/** User-initiated "Sync now": also retries failed attachment transfers. */
export async function syncNow(): Promise<void> {
  resetFailureState()
  if (role === 'follower') { requestLeaderSync(); try { syncBC?.postMessage({ type: 'jobs-retry', tabId: TAB_ID }) } catch {}; return }
  await retryFailedAttachments()
  await runSync(true)
}

function acquireLeadership(onLeader: () => void) {
  const locks = (navigator as any)?.locks
  if (!locks?.request || !syncBC) { role = 'leader'; onLeader(); return }
  role = 'follower'
  locks.request('focuz-sync-leader', () => new Promise<void>(resolve => {
    if (stopRequested) { resolve(); return }
    releaseLeaderLock = resolve
    role = 'leader'
    onLeader()
  })).catch(() => {})
}

export function scheduleAutoSync(): { kick: () => void; cleanup: () => void } {
  stopRequested = false
  const disposers: Array<() => void> = []
  const on = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn)
    disposers.push(() => target.removeEventListener(type, fn))
  }

  const trigger = (force: boolean) => {
    if (role === 'follower') requestLeaderSync()
    else void runSync(force)
  }

  const onMessage = (msg: MessageEvent) => {
    const data = msg.data
    if (!data || data.tabId === TAB_ID) return
    if (data.type === 'state' && role === 'follower') patchSyncState(data.patch)
    else if (data.type === 'sync-request' && role === 'leader') void runSync(true)
    else if (data.type === 'jobs-kick' && role === 'leader') kickJobs()
    else if (data.type === 'jobs-retry' && role === 'leader') void retryFailedAttachments()
  }
  if (syncBC) { syncBC.addEventListener('message', onMessage); disposers.push(() => syncBC?.removeEventListener('message', onMessage)) }

  let ws: WebSocket | null = null
  let wsRetryMs = 1000
  let wsRetryId: ReturnType<typeof setTimeout> | null = null
  const connectWS = () => {
    if (stopRequested || role !== 'leader') return
    const base = getApiBase()
    const token = getAuthToken()
    if (!base || !token) return
    try {
      const url = new URL(base)
      const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${wsProto}//${url.host}/ws?token=${encodeURIComponent(token)}`)
      ws.onopen = () => {
        wsRetryMs = 1000
        // The server is back: do not wait for the backoff timer.
        if (failures > 0) void runSync(true)
      }
      ws.onmessage = () => {
        const now = Date.now()
        if (now - lastWSTriggerMs < WS_COOLDOWN_MS) return
        lastWSTriggerMs = now
        void runSync(true)
      }
      ws.onclose = () => {
        ws = null
        if (stopRequested) return
        wsRetryId = setTimeout(connectWS, wsRetryMs)
        wsRetryMs = Math.min(wsRetryMs * 2, 30000)
      }
      ws.onerror = () => { try { ws?.close() } catch {} }
    } catch {
      wsRetryId = setTimeout(connectWS, wsRetryMs)
      wsRetryMs = Math.min(wsRetryMs * 2, 30000)
    }
  }

  const onBecameLeader = () => {
    void (async () => {
      try { await ensureDbOpen(); await releaseStaleRunningJobs(); await recoverLegacyConflicts() } catch (e) { console.error(e) }
      if (stopRequested) return
      connectWS()
      kickJobs()
      void runSync(true)
    })()
  }
  acquireLeadership(onBecameLeader)

  on(window, 'online', () => { resetFailureState(); trigger(true) })
  on(window, 'focus', () => trigger(false))
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') trigger(false) })
  const intervalId = setInterval(() => { if (role === 'leader') void runSync(false) }, BASE_SYNC_INTERVAL_MS)
  disposers.push(() => clearInterval(intervalId))

  const kick = () => {
    if (localKickTimer) clearTimeout(localKickTimer)
    localKickTimer = setTimeout(() => { localKickTimer = null; trigger(true) }, DEBOUNCE_LOCAL_MS)
    // New uploads can start right away (they wait for the note mapping themselves).
    kickJobs(DEBOUNCE_LOCAL_MS)
  }

  const cleanup = () => {
    stopRequested = true
    for (const d of disposers.splice(0)) { try { d() } catch {} }
    if (localKickTimer) { clearTimeout(localKickTimer); localKickTimer = null }
    if (jobTimer) { clearTimeout(jobTimer); jobTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (wsRetryId) { clearTimeout(wsRetryId); wsRetryId = null }
    if (ws) { try { ws.close(1000, 'logout') } catch {}; ws = null }
    if (releaseLeaderLock) { releaseLeaderLock(); releaseLeaderLock = null }
    role = 'standalone'
  }
  lastCleanup = cleanup
  return { kick, cleanup }
}

export function teardownSync(): void {
  stopRequested = true
  if (lastCleanup) {
    try { lastCleanup() } catch {}
    lastCleanup = null
  }
}

/** Test hook: reset module state between tests. */
export function __resetSyncEngineForTests() {
  teardownSync()
  stopRequested = false
  role = 'standalone'
  running = null
  queued = false
  failures = 0
  backoffUntilMs = 0
  noChangeUntilMs = 0
  jobsPausedOffline = false
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
}

// Cross-tab: stop background work and drop the DB on logout elsewhere
try {
  authBC?.addEventListener('message', (msg: MessageEvent) => {
    if (msg?.data?.type === 'logout') {
      try { teardownSync() } catch {}
      deleteDatabaseWithRetry(4000).catch(() => { wipeLocalData().catch(() => {}) })
      try { emitAuthRequired(true) } catch {}
    }
  })
} catch {}
