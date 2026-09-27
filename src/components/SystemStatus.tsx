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
            <button type="button" className="button !bg-transparent !text-[var(--text-primary)] ring-1 ring-[rgba(var(--c-text)/0.15)]" onClick={() => { void retryFailedAttachments() }}>
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

// Centralized UI layer for system statuses.
// Important: this module does NOT run sync logic. It reacts to app-state only.
export function SystemStatusLayer() {
  const online = useAppState(s => s.online)
  const authRequired = useAppState(s => s.authRequired)
  const syncError = useAppState(s => s.syncError)
  const serverReachable = useAppState(s => s.serverReachable)
  const lastConflictAt = useAppState(s => s.lastConflictAt)
  const lastConflictCount = useAppState(s => s.lastConflictCount)
  const lastJobFailureAt = useAppState(s => s.lastJobFailureAt)
  const lastJobFailureKind = useAppState(s => s.lastJobFailureKind)
  const lastJobFailureMessage = useAppState(s => s.lastJobFailureMessage)

  const prevOnlineRef = useRef<boolean | null>(null)
  const prevReachableRef = useRef<boolean>(true)
  const lastErrorShownRef = useRef<string | null>(null)
  const lastConflictShownAtRef = useRef<string | null>(null)
  const lastAuthToastAtMsRef = useRef<number>(0)
  const lastJobToastAtRef = useRef<string | null>(null)

  useEffect(() => {
    const prev = prevOnlineRef.current
    prevOnlineRef.current = online
    if (prev == null) return
    if (!online) notify('You are offline. Changes are saved on this device.', 'warning', { durationMs: 4000, id: 'sys-offline' })
    if (online && prev === false) notify('Back online', 'success', { durationMs: 2500, id: 'sys-online' })
  }, [online])

  // One toast when the server goes away and one when it comes back — not one per retry.
  useEffect(() => {
    const prev = prevReachableRef.current
    prevReachableRef.current = serverReachable
    if (!online) return
    if (prev && !serverReachable) notify('Cannot reach the server. Changes are kept on this device and will sync automatically.', 'warning', { durationMs: 6000, id: 'sys-server' })
    if (!prev && serverReachable) notify('Connection to the server restored', 'success', { durationMs: 2500, id: 'sys-server' })
  }, [serverReachable, online])

  useEffect(() => {
    if (!syncError || !serverReachable) { if (!syncError) lastErrorShownRef.current = null; return }
    if (syncError === 'Session expired') return
    if (lastErrorShownRef.current === syncError) return
    lastErrorShownRef.current = syncError
    notify(`Sync failed: ${syncError}`, 'error', { durationMs: 6000, id: 'sys-sync-error' })
  }, [syncError, serverReachable])

  useEffect(() => {
    if (!lastConflictAt) return
    if (lastConflictShownAtRef.current === lastConflictAt) return
    lastConflictShownAtRef.current = lastConflictAt
    notify(
      lastConflictCount > 1
        ? `${lastConflictCount} notes were changed on another device. Your versions were kept as notes tagged “conflict”.`
        : 'This note was changed on another device. Your version was kept as a note tagged “conflict”.',
      'warning',
      { durationMs: 8000 },
    )
  }, [lastConflictAt, lastConflictCount])

  useEffect(() => {
    if (!authRequired) return
    const now = Date.now()
    if (now - lastAuthToastAtMsRef.current < 30000) return
    lastAuthToastAtMsRef.current = now
    notify('Session expired — please sign in again', 'warning', { durationMs: 8000, id: 'sys-auth-required' })
  }, [authRequired])

  useEffect(() => {
    if (!lastJobFailureAt) return
    if (lastJobToastAtRef.current === lastJobFailureAt) return
    lastJobToastAtRef.current = lastJobFailureAt
    const label = lastJobFailureKind === 'attachment-download' ? 'Image download failed' : 'Image upload failed'
    const extra = lastJobFailureMessage ? `: ${lastJobFailureMessage}` : ''
    notify(`${label}${extra}. You can retry from the sync status menu.`, 'error', { durationMs: 8000, id: 'sys-job-failed' })
  }, [lastJobFailureAt, lastJobFailureKind, lastJobFailureMessage])

  return null
}
