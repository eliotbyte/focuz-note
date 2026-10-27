// What the sync indicator in the top bar says, derived from app state.
//
// The indicator is there only while something keeps notes from reaching the server. When everything
// syncs, and while a sync runs, it is gone: there is nothing for the user to do. A picture that could
// not be transferred is shown on the picture itself (UploadBadge, MissingPicture), not counted here.

export type Tone = 'warn' | 'error'

export interface StatusView {
  tone: Tone
  label: string
  headline: string
  detail: string
  icon: 'off' | 'error'
  /** Whether "Try now" makes sense (it does not offline or signed out). */
  canRetry: boolean
}

function waiting(n: number): string {
  if (n <= 0) return 'Everything you write is kept on this device and sent as soon as it can be.'
  return `${n === 1 ? '1 change is' : `${n} changes are`} kept on this device and will be sent as soon as it can be.`
}

/** Exported for tests: one place that decides what the indicator says. Null: show nothing. */
export function describeStatus(s: {
  online: boolean
  serverReachable: boolean
  syncError: string | null
  authRequired: boolean
  /** Notes, folders, metric values and files not on the server yet. */
  unsent: number
}): StatusView | null {
  if (s.authRequired) return { tone: 'error', label: 'Signed out', icon: 'error', canRetry: false, headline: 'Sign in again to keep syncing.', detail: waiting(s.unsent) }
  if (!s.online) return { tone: 'warn', label: 'Offline', icon: 'off', canRetry: false, headline: 'You are offline.', detail: waiting(s.unsent) }
  if (!s.serverReachable) return { tone: 'warn', label: 'No connection', icon: 'off', canRetry: true, headline: 'The server cannot be reached.', detail: waiting(s.unsent) }
  if (s.syncError) return { tone: 'warn', label: 'Not syncing', icon: 'error', canRetry: true, headline: 'The server could not take the last sync. It is tried again automatically.', detail: waiting(s.unsent) }
  return null
}
