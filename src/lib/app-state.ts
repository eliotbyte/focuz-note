import { useSyncExternalStore } from 'react'
import { jobs, kv } from '../data'
import type { JobKind } from './types'

const AUTH_REQUIRED_LS = 'authRequired'
// Wall-clock time of the last successful sync on this device (not the server checkpoint).
export const LAST_SYNC_OK_KV = 'lastSyncOkAt'

export interface AppStateSnapshot {
  online: boolean
  syncing: boolean
  authRequired: boolean
  lastSyncAt: string | null
  syncError: string | null
  // false after a sync attempt could not reach the API (down, timeout, DNS...)
  serverReachable: boolean
  // when the next automatic retry is scheduled after a failure
  nextRetryAt: string | null
  // One-shot-ish events as state stamps (UI decides how/when to render).
  lastConflictAt: string | null
  lastConflictCount: number
  // Attachments jobs UX
  jobsFailedCount: number
  lastJobFailureAt: string | null
  lastJobFailureKind: JobKind | null
  lastJobFailureMessage: string | null
}

let state: AppStateSnapshot = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  authRequired: false,
  lastSyncAt: null,
  syncError: null,
  serverReachable: true,
  nextRetryAt: null,
  lastConflictAt: null,
  lastConflictCount: 0,
  jobsFailedCount: 0,
  lastJobFailureAt: null,
  lastJobFailureKind: null,
  lastJobFailureMessage: null,
}

const listeners = new Set<() => void>()
let initialized = false

function emit() {
  for (const l of listeners) l()
}

function setState(partial: Partial<AppStateSnapshot>) {
  const next = { ...state, ...partial }
  // shallow compare to avoid redundant renders
  const same =
    next.online === state.online &&
    next.syncing === state.syncing &&
    next.authRequired === state.authRequired &&
    next.lastSyncAt === state.lastSyncAt &&
    next.syncError === state.syncError &&
    next.serverReachable === state.serverReachable &&
    next.nextRetryAt === state.nextRetryAt &&
    next.lastConflictAt === state.lastConflictAt &&
    next.lastConflictCount === state.lastConflictCount &&
    next.jobsFailedCount === state.jobsFailedCount &&
    next.lastJobFailureAt === state.lastJobFailureAt &&
    next.lastJobFailureKind === state.lastJobFailureKind &&
    next.lastJobFailureMessage === state.lastJobFailureMessage
  if (same) return
  state = next
  emit()
}

export function getAppState(): AppStateSnapshot {
  return state
}

export function subscribeAppState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAppState<T>(selector: (s: AppStateSnapshot) => T): T {
  return useSyncExternalStore(
    subscribeAppState,
    () => selector(getAppState()),
    () => selector(getAppState()),
  )
}

async function refreshLastSyncAt(): Promise<void> {
  const v = await kv.get<string>(LAST_SYNC_OK_KV)
  setState({ lastSyncAt: v ?? null })
}

async function refreshJobsFailedCount(): Promise<void> {
  const c = await jobs.countFailedAttachments()
  setState({ jobsFailedCount: c })
}

function readAuthRequiredLS(): boolean {
  try { return localStorage.getItem(AUTH_REQUIRED_LS) === '1' } catch { return false }
}

export function initAppState(): void {
  if (initialized) return
  initialized = true

  // initial snapshot
  setState({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    authRequired: readAuthRequiredLS(),
  })
  refreshLastSyncAt().catch(() => {})
  refreshJobsFailedCount().catch(() => {})

  const onOnline = () => setState({ online: true })
  const onOffline = () => setState({ online: false })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  const onAuthRequired = (e: Event) => {
    const required = (e as CustomEvent<boolean>).detail
    setState({ authRequired: !!required })
  }
  window.addEventListener('focuz:auth-required', onAuthRequired as EventListener)

  const onStorage = (e: StorageEvent) => {
    if (e.key === AUTH_REQUIRED_LS) setState({ authRequired: e.newValue === '1' })
  }
  window.addEventListener('storage', onStorage)

  const onSyncApplied = () => {
    refreshLastSyncAt().catch(() => {})
  }
  window.addEventListener('focuz:sync-applied', onSyncApplied)

  const onJobsChanged = () => {
    refreshJobsFailedCount().catch(() => {})
  }
  window.addEventListener('focuz:jobs-changed', onJobsChanged as EventListener)
}

// --- Mutations owned by non-UI modules (sync engine, auth flow, etc.) ---

export function setSyncing(syncing: boolean): void {
  setState({ syncing })
}

export function setSyncError(message: string | null): void {
  setState({ syncError: message })
}

/** Sync-engine status fields; the leader tab broadcasts them to other tabs. */
export type SyncStatePatch = Partial<Pick<AppStateSnapshot, 'syncing' | 'syncError' | 'serverReachable' | 'nextRetryAt' | 'lastSyncAt'>>

export function patchSyncState(patch: SyncStatePatch): void {
  setState(patch)
}

export function markConflictsDetected(count: number): void {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  setState({ lastConflictAt: new Date().toISOString(), lastConflictCount: n })
}

export function markJobFailed(kind: JobKind, message?: string | null): void {
  setState({
    lastJobFailureAt: new Date().toISOString(),
    lastJobFailureKind: kind,
    lastJobFailureMessage: message ? String(message) : null,
  })
}
