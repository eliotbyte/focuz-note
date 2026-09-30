import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAppState } from '../lib/app-state'
import { appEnv, isTest } from '../lib/app-env'
import { notify } from '../ui/notify'
import { formatRelativeShort } from '../lib/time'
import { db } from '../lib/db'
import { syncNow, retryFailedAttachments } from '../lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { describeStatus, type StatusView } from '../lib/sync-status'
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded'
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'

interface Pending {
  notes: number
  filters: number
  uploads: number
  downloads: number
  failed: number
}

async function loadPending(): Promise<Pending> {
  const [notes, filters, activities, jobs] = await Promise.all([
    db.notes.where('isDirty').equals(1).count(),
    db.filters.where('isDirty').equals(1).count(),
    db.activities.where('isDirty').equals(1).count(),
    db.jobs.toArray(),
  ])
  return {
    notes: notes + activities,
    filters,
    uploads: jobs.filter(j => j.kind === 'attachment-upload' && j.status !== 'failed').length,
    downloads: jobs.filter(j => j.kind === 'attachment-download' && j.status !== 'failed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }
}

function StatusIcon({ icon, spin }: { icon: StatusView['icon']; spin?: boolean }) {
  const cls = `icon-sm ${spin ? 'animate-spin [animation-duration:1.4s]' : ''}`
  if (icon === 'sync') return <SyncRoundedIcon fontSize="inherit" className={cls} />
  if (icon === 'upload') return <CloudUploadRoundedIcon fontSize="inherit" className={cls} />
  if (icon === 'off') return <CloudOffRoundedIcon fontSize="inherit" className={cls} />
  if (icon === 'error') return <ErrorOutlineRoundedIcon fontSize="inherit" className={cls} />
  return <CloudDoneRoundedIcon fontSize="inherit" className={cls} />
}

function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
  return now
}

export function SystemStatusInline() {
  const online = useAppState(s => s.online)
  const syncing = useAppState(s => s.syncing)
  const lastSyncAt = useAppState(s => s.lastSyncAt)
  const syncError = useAppState(s => s.syncError)
  const authRequired = useAppState(s => s.authRequired)
  const serverReachable = useAppState(s => s.serverReachable)
  const nextRetryAt = useAppState(s => s.nextRetryAt)
  const pending = useLiveQuery(loadPending, []) ?? { notes: 0, filters: 0, uploads: 0, downloads: 0, failed: 0 }
  const [open, setOpen] = useState(false)
  const now = useNow(1000, open)

  const view = describeStatus({
    online, syncing, serverReachable, syncError, authRequired, lastSyncAt,
    pendingChanges: pending.notes + pending.filters, uploads: pending.uploads, failed: pending.failed,
  })
  const retryIn = nextRetryAt ? Math.max(0, Math.round((Date.parse(nextRetryAt) - now) / 1000)) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`status-chip status-${view.tone}`} aria-label={`Sync status: ${view.label}`} title={view.headline}>
          <StatusIcon icon={view.icon} spin={view.icon === 'sync'} />
          <span className="hidden sm:inline">{view.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-4 w-80 text-sm">
        <div className={`flex items-start gap-2 status-${view.tone}`}>
          <span className="mt-0.5"><StatusIcon icon={view.icon} spin={view.icon === 'sync'} /></span>
          <div className="text-primary leading-snug">{view.headline}</div>
        </div>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-secondary">
          <dt>Last successful sync</dt>
          <dd className="text-primary text-right" title={lastSyncAt || ''}>{lastSyncAt ? formatRelativeShort(lastSyncAt) : 'never'}</dd>
          <dt>Unsent changes</dt>
          <dd className="text-primary text-right">{pending.notes + pending.filters === 0 ? 'none' : `${pending.notes + pending.filters}`}</dd>
          <dt>Images to upload</dt>
          <dd className="text-primary text-right">{pending.uploads || 'none'}</dd>
          <dt>Images to download</dt>
          <dd className="text-primary text-right">{pending.downloads || 'none'}</dd>
          {pending.failed > 0 && (<>
            <dt>Failed transfers</dt>
            <dd className="status-error text-right">{pending.failed}</dd>
          </>)}
          {retryIn != null && !syncing && (<>
            <dt>Next attempt</dt>
            <dd className="text-primary text-right">{retryIn > 0 ? `in ${retryIn}s` : 'now'}</dd>
          </>)}
          {isTest && (<>
            <dt>Env</dt>
            <dd className="text-primary text-right">{appEnv}</dd>
          </>)}
        </dl>
        {syncError && serverReachable && (
          <div className="mt-3 rounded-[var(--radius-control)] px-3 py-2 bg-[rgba(var(--c-text)/0.04)] text-secondary break-words">
            <span className="text-primary">Details: </span>{syncError}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {pending.failed > 0 && (
            <button type="button" className="button button-secondary" onClick={() => { void retryFailedAttachments() }}>
              Retry images
            </button>
          )}
          <button type="button" className="button" disabled={syncing || authRequired} onClick={() => { void syncNow() }}>
            Sync now
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Toasts for sync events. Connection state (offline, server unreachable, sync errors, failed
// image transfers, session expired) is deliberately NOT toasted: the status chip in the top bar
// shows it continuously, and the session-expired dialog handles sign-in. Toasting it as well
// produced a stream of popups on every network hiccup.
// The one event worth interrupting for: a conflict, because a new note appeared in the feed.
export function SystemStatusLayer() {
  const lastConflictAt = useAppState(s => s.lastConflictAt)
  const lastConflictCount = useAppState(s => s.lastConflictCount)
  const shownRef = useRef<string | null>(null)

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
