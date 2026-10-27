import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAppState } from '../lib/app-state'
import { notify } from '../ui/notify'
import { db } from '../lib/db'
import { syncNow } from '../lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { describeStatus, type StatusView } from '../lib/sync-status'
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'

/** Notes, folders, metric values and files that are not on the server yet. */
async function countUnsent(): Promise<number> {
  const [notes, filters, activities, uploads] = await Promise.all([
    db.notes.where('isDirty').equals(1).count(),
    db.filters.where('isDirty').equals(1).count(),
    db.activities.where('isDirty').equals(1).count(),
    db.jobs.where('kind').equals('attachment-upload').and(j => j.status !== 'failed').count(),
  ])
  return notes + filters + activities + uploads
}

export function useUnsentCount(): number {
  return useLiveQuery(countUnsent, []) ?? 0
}

function StatusIcon({ icon }: { icon: StatusView['icon'] }) {
  if (icon === 'off') return <CloudOffRoundedIcon fontSize="inherit" className="icon-sm" />
  return <ErrorOutlineRoundedIcon fontSize="inherit" className="icon-sm" />
}

/** Top bar: shown only while notes cannot reach the server (see describeStatus). */
export function SystemStatusInline() {
  const online = useAppState(s => s.online)
  const syncing = useAppState(s => s.syncing)
  const syncError = useAppState(s => s.syncError)
  const authRequired = useAppState(s => s.authRequired)
  const serverReachable = useAppState(s => s.serverReachable)
  const unsent = useUnsentCount()
  const [open, setOpen] = useState(false)

  const view = describeStatus({ online, serverReachable, syncError, authRequired, unsent })
  const shown = !!view
  useEffect(() => { if (!shown) setOpen(false) }, [shown])
  if (!view) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`status-chip status-${view.tone}`} aria-label={`Sync: ${view.label}`} title={view.headline}>
          <StatusIcon icon={view.icon} />
          <span className="hidden sm:inline">{view.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-4 w-80 text-sm">
        <div className={`flex items-start gap-2 status-${view.tone}`}>
          <span className="mt-0.5"><StatusIcon icon={view.icon} /></span>
          <div className="leading-snug">
            <div className="text-primary">{view.headline}</div>
            <div className="mt-1 text-secondary">{view.detail}</div>
          </div>
        </div>
        {syncError && serverReachable && !authRequired && (
          <details className="mt-3 text-secondary">
            <summary className="cursor-pointer">Details</summary>
            <div className="mt-1 break-words">{syncError}</div>
          </details>
        )}
        {view.canRetry && (
          <div className="mt-4 flex justify-end">
            <button type="button" className="button" disabled={syncing} onClick={() => { void syncNow() }}>
              {syncing ? 'Trying…' : 'Try now'}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// Toasts for sync events. Connection state (offline, server unreachable, sync errors, session
// expired) is deliberately NOT toasted: the status chip in the top bar shows it while it lasts, and
// the session-expired dialog handles sign-in. Toasting it as well produced a stream of popups on
// every network hiccup.
// Worth interrupting for: a conflict, because a new note appeared in the feed, and a file the server
// refused, because it will not get there by waiting (the picture offers to try again or remove it).
export function SystemStatusLayer() {
  const lastConflictAt = useAppState(s => s.lastConflictAt)
  const lastConflictCount = useAppState(s => s.lastConflictCount)
  const failureAt = useAppState(s => s.lastJobFailureAt)
  const failureKind = useAppState(s => s.lastJobFailureKind)
  const failureMessage = useAppState(s => s.lastJobFailureMessage)
  const failureFile = useAppState(s => s.lastJobFailureFile)
  const shownRef = useRef<string | null>(null)
  const failureShownRef = useRef<string | null>(null)

  useEffect(() => {
    if (!failureAt || failureKind !== 'attachment-upload' || failureShownRef.current === failureAt) return
    failureShownRef.current = failureAt
    notify(failureFile ? `“${failureFile}” was not uploaded` : 'A file was not uploaded', 'error', {
      id: 'sys-upload-refused',
      durationMs: 10000,
      description: `${failureMessage ? `${failureMessage.replace(/[.\s]+$/, '')}. ` : ''}It is marked in its note, where you can try again or remove it.`,
    })
  }, [failureAt, failureKind, failureMessage, failureFile])

  useEffect(() => {
    if (!lastConflictAt || shownRef.current === lastConflictAt) return
    shownRef.current = lastConflictAt
    notify(
      lastConflictCount > 1
        ? `${lastConflictCount} notes were also changed on another device`
        : 'This note was also changed on another device',
      'warning',
      { id: 'sys-conflict', durationMs: 10000, description: 'Your version was kept as a separate note tagged “conflict”.' },
    )
  }, [lastConflictAt, lastConflictCount])

  return null
}
