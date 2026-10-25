import { useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import {
  closeExportDialog,
  dismissExport,
  exportWithoutFailedPictures,
  isExportActive,
  openExportDetails,
  retryFailedPictures,
  skipCurrentPicture,
  startExport,
  stopExport,
  useExportState,
  type ExportState,
} from '../lib/export-job'

/** The app-wide export: a progress panel while it runs, and the dialogs for options and details. */
export default function ExportPanel() {
  const s = useExportState()
  return (
    <>
      {s.status !== 'idle' && s.dialog !== 'details' ? <ExportBanner s={s} /> : null}
      {s.dialog === 'options' && s.target && <ExportOptionsDialog spaceId={s.target.spaceId} spaceName={s.target.spaceName} />}
      {s.dialog === 'details' && s.status !== 'idle' && <ExportDetailsDialog s={s} />}
    </>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function percent(s: ExportState): number {
  if (s.status === 'done') return 100
  if (s.total === 0) return 0
  return Math.round((s.done / s.total) * 100)
}

function bannerText(s: ExportState): string {
  if (s.status === 'decide') return 'Some pictures could not be downloaded'
  if (s.status === 'done') return 'Export ready'
  if (s.status === 'stopped') return 'Export stopped'
  if (s.status === 'failed') return 'Export failed'
  if (s.step === 'packing') return 'Packing the export…'
  return `Exporting · ${s.done} of ${s.total} ${s.total === 1 ? 'picture' : 'pictures'}`
}

function ExportBanner({ s }: { s: ExportState }) {
  const finished = !isExportActive(s)
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex w-72 max-w-[calc(100vw-2rem)] items-start gap-2 surface glass-float rounded-[var(--radius-control)] p-3 text-sm">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={openExportDetails}>
        <div className="truncate text-primary">{bannerText(s)}</div>
        {s.status !== 'stopped' && s.status !== 'failed' && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgba(var(--c-text)/0.12)]" aria-hidden>
            <div
              className={`h-full rounded-full bg-[rgb(var(--c-accent))] transition-[width] duration-300 ${s.step === 'packing' ? 'animate-pulse' : ''}`}
              style={{ width: `${s.step === 'packing' ? 100 : percent(s)}%` }}
            />
          </div>
        )}
      </button>
      {finished && (
        <button type="button" className="icon-btn !p-1" aria-label="Dismiss" onClick={dismissExport}>
          <CloseRoundedIcon fontSize="inherit" />
        </button>
      )}
    </div>
  )
}

function ExportOptionsDialog({ spaceId, spaceName }: { spaceId: number; spaceName: string }) {
  const [withPictures, setWithPictures] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const rangeOk = !from || !to || from <= to

  return (
    <Dialog open onOpenChange={open => { if (!open) closeExportDialog() }}>
      <DialogContent stacked aria-describedby={undefined} className="p-5">
        <DialogTitle className="!text-primary !text-[17px] font-semibold">Export notes</DialogTitle>
        <DialogDescription className="mt-1">
          {spaceName ? <>Notes of <b>{spaceName}</b>, saved as a file on this device.</> : 'Notes of this space, saved as a file on this device.'}
        </DialogDescription>

        <div className="mt-5 space-y-5">
          <section className="space-y-2">
            <div className="settings-label">Date range</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2 text-secondary">
                <span>From</span>
                <input type="date" aria-label="From" className="input !w-auto !py-1" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-secondary">
                <span>To</span>
                <input type="date" aria-label="To" className="input !w-auto !py-1" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
              </label>
            </div>
            <p className="settings-note">By the date of each note. Leave both empty to export all notes.</p>
            {!rangeOk && <p className="settings-error" role="alert">The start date is after the end date.</p>}
          </section>

          <section className="space-y-2">
            <div className="settings-label">What to export</div>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked disabled />
              Notes: text, tags, dates and activities
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withPictures} onChange={e => setWithPictures(e.target.checked)} />
              Pictures
            </label>
          </section>

          <section className="space-y-2">
            <div className="settings-label">Format</div>
            <p className="settings-note">
              JSON. {withPictures ? 'With pictures, the file is a zip with the JSON and the pictures in it.' : 'Without pictures, it is a plain JSON file.'}
            </p>
          </section>

          <div className="flex justify-end gap-2">
            <button type="button" className="button button-secondary" onClick={closeExportDialog}>Cancel</button>
            <button
              type="button"
              className="button"
              disabled={!rangeOk}
              onClick={() => {
                void startExport({ spaceId, spaceName, withPictures, from, to })
                openExportDetails()
              }}
            >
              Export
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ExportDetailsDialog({ s }: { s: ExportState }) {
  const running = s.status === 'running'
  const name = s.request?.spaceName || 'space'
  const title = {
    running: 'Exporting your data',
    decide: 'Some pictures could not be downloaded',
    done: 'Export ready',
    stopped: 'Export stopped',
    failed: 'Export failed',
    idle: 'Export',
  }[s.status]
  const canSkip = running && s.step === 'pictures' && s.current !== null

  return (
    <Dialog open onOpenChange={open => { if (!open) closeExportDialog() }}>
      <DialogContent stacked aria-describedby={undefined} className="p-5">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="!text-primary !text-[17px] font-semibold">{title}</DialogTitle>
          <button type="button" className="icon-btn !p-1" aria-label="Close" onClick={closeExportDialog}>
            <CloseRoundedIcon fontSize="inherit" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm">
          {running && s.step === 'pictures' && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-primary">{name}</span>
                <span className="shrink-0 text-secondary">{s.done} / {s.total}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[rgba(var(--c-text)/0.12)]" aria-hidden>
                <div className="h-full rounded-full bg-[rgb(var(--c-accent))] transition-[width] duration-300" style={{ width: `${percent(s)}%` }} />
              </div>
            </div>
          )}
          {running && s.step === 'pictures' && s.current && (
            <div className="flex items-baseline justify-between gap-3 border-t border-[rgba(var(--c-text)/0.08)] pt-3">
              <span className="truncate text-primary">{s.current.fileName}</span>
              <span className="shrink-0 text-secondary">{formatBytes(s.current.fileSize)}</span>
            </div>
          )}
          {running && s.step === 'packing' && <p className="text-secondary">Packing the file…</p>}

          {running && (
            <p className="settings-note">You can close this window now. Keep this tab open until the export is complete.</p>
          )}
          {s.status === 'decide' && (
            <p className="settings-error" role="alert">
              {s.failedPictures} {s.failedPictures === 1 ? 'picture' : 'pictures'} could not be downloaded. The server may be unreachable, or the {s.failedPictures === 1 ? 'file is' : 'files are'} damaged there.
            </p>
          )}
          {s.status === 'done' && s.report && <p className="settings-ok" role="status">{s.report}</p>}
          {s.status === 'stopped' && <p className="settings-note">Nothing was saved.</p>}
          {s.status === 'failed' && s.error && <p className="settings-error" role="alert">{s.error}</p>}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {running && canSkip && <button type="button" className="button button-secondary" onClick={skipCurrentPicture}>Skip</button>}
          {running && <button type="button" className="button button-secondary status-error" onClick={stopExport}>Stop</button>}
          {s.status === 'decide' && (
            <>
              <button type="button" className="button button-secondary" onClick={dismissExport}>Cancel</button>
              <button type="button" className="button button-secondary" onClick={retryFailedPictures}>Try again</button>
              <button type="button" className="button" onClick={exportWithoutFailedPictures}>Export without them</button>
            </>
          )}
          {!running && s.status !== 'decide' && <button type="button" className="button" onClick={closeExportDialog}>Close</button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
