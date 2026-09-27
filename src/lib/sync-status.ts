// What the sync indicator in the top bar says, derived from app state.

export type Tone = 'ok' | 'busy' | 'warn' | 'error'

export interface StatusView {
  tone: Tone
  label: string
  headline: string
  icon: 'done' | 'sync' | 'upload' | 'off' | 'error'
}

/** Exported for tests: one place that decides what the indicator says. */
export function describeStatus(s: {
  online: boolean
  syncing: boolean
  serverReachable: boolean
  syncError: string | null
  authRequired: boolean
  lastSyncAt: string | null
  pendingChanges: number
  uploads: number
  failed: number
}): StatusView {
  if (s.authRequired) return { tone: 'error', label: 'Sign in', icon: 'error', headline: 'Session expired. Sign in again to continue syncing.' }
  if (!s.online) return { tone: 'warn', label: 'Offline', icon: 'off', headline: 'No internet connection. Changes are saved on this device and will sync when you are back online.' }
  if (!s.serverReachable) return { tone: 'warn', label: 'Server unreachable', icon: 'off', headline: 'Cannot reach the server. Changes are saved on this device and will sync automatically.' }
  if (s.syncing) return { tone: 'busy', label: 'Syncing', icon: 'sync', headline: 'Syncing with the server…' }
  if (!s.lastSyncAt && !s.syncError) return { tone: 'busy', label: 'Connecting', icon: 'sync', headline: 'Not synced with the server yet.' }
  if (s.syncError) return { tone: 'error', label: 'Sync error', icon: 'error', headline: 'The last sync failed. It will be retried automatically.' }
  if (s.failed > 0) return { tone: 'error', label: `${s.failed} failed`, icon: 'error', headline: 'Some images could not be transferred.' }
  const pending = s.pendingChanges + s.uploads
  if (pending > 0) return { tone: 'busy', label: `${pending} pending`, icon: 'upload', headline: 'Some changes are waiting to be sent.' }
  return { tone: 'ok', label: 'Synced', icon: 'done', headline: 'Everything is saved on the server.' }
}
