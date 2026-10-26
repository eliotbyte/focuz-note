import { useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import DatePicker from './DatePicker'
import { parseDay } from '../lib/calendar'
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
  if (s.status === 'decide') return 'Some files could not be downloaded'
  if (s.status === 'done') return 'Export ready'
  if (s.status === 'stopped') return 'Export stopped'
  if (s.status === 'failed') return 'Export failed'
  if (s.step === 'packing') return 'Packing the export…'
  return `Exporting · ${s.done} of ${s.total} ${s.total === 1 ? 'file' : 'files'}`
}

/** Progress as a Sims-style needs bar; value null = working, amount unknown (barber stripes). */
function Meter({ value, label, className }: { value: number | null; /** Omit when the text next to it already says it. */ label?: string; className?: string }) {
  const a11y = label
    ? { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value ?? undefined }
    : { 'aria-hidden': true }
  return (
    <div className={`meter ${value == null ? 'is-indeterminate' : ''} ${className ?? ''}`} {...a11y}>
      <div className="meter-fill" style={{ width: `${value ?? 100}%` }} />
    </div>
  )
}

function ExportBanner({ s }: { s: ExportState }) {
  const finished = !isExportActive(s)
  return (
    <div className="fixed bottom-4 left-4 layer-banner flex w-72 max-w-[calc(100vw-2rem)] items-start gap-2 surface glass-float rounded-[var(--radius-control)] p-3 text-sm">
      {/* The meter sits outside the button: inside one, screen readers flatten it into the button's name. */}
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full truncate text-left text-primary" onClick={openExportDetails}>
          {bannerText(s)}
        </button>
        {s.status !== 'stopped' && s.status !== 'failed' && (
          <Meter value={s.step === 'packing' ? null : percent(s)} label="Export progress" className="mt-2" />
        )}
      </div>
      {finished && (
        <button type="button" className="icon-btn !p-1" aria-label="Dismiss" onClick={dismissExport}>
          <CloseRoundedIcon fontSize="inherit" />
        </button>
      )}
    </div>
  )
}

/** A picked day as it is written in the export settings ("26 Oct 2026"). */
function shownDay(day: string): string {
  const p = parseDay(day)
  return p ? new Date(p.year, p.month, p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : day
}

function ExportOptionsDialog({ spaceId, spaceName }: { spaceId: number; spaceName: string }) {
  const [pictures, setPictures] = useState(true)
  const [files, setFiles] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const rangeOk = !from || !to || from <= to

  return (
    <Dialog open onOpenChange={open => { if (!open) closeExportDialog() }}>
      <DialogContent stacked className="p-5">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle>Export notes</DialogTitle>
          <button type="button" className="icon-btn icon-btn-close !p-1" aria-label="Close" onClick={closeExportDialog}>
            <CloseRoundedIcon fontSize="inherit" />
          </button>
        </div>
        <DialogDescription className="mt-1 text-sm">
          {spaceName ? <>Notes of <b>{spaceName}</b></> : 'Notes of this space'} with their text, tags, dates and activities, saved as a file on this device.
        </DialogDescription>

        <div className="mt-4">
          <label className="export-check">
            <input type="checkbox" checked={pictures} onChange={e => setPictures(e.target.checked)} />
            Pictures
          </label>
          <label className="export-check">
            <input type="checkbox" checked={files} onChange={e => setFiles(e.target.checked)} />
            Files
            <span className="export-check-hint">PDF, Word, text, Markdown, CSV</span>
          </label>
        </div>

        <div className="mt-4 space-y-1">
          <p className="export-setting">
            Format: <span className="text-primary">{pictures || files ? 'zip with JSON and the files' : 'JSON'}</span>
          </p>
          <p className="export-setting" title="By the date of each note">
            From:{' '}
            <DatePicker label="Start date" value={from} max={to || undefined} resetLabel="Reset" onChange={setFrom} onReset={() => setFrom('')}>
              <button type="button" className="link-btn">{from ? shownDay(from) : 'the oldest note'}</button>
            </DatePicker>
            , to:{' '}
            <DatePicker label="End date" value={to} min={from || undefined} resetLabel="Reset" onChange={setTo} onReset={() => setTo('')}>
              <button type="button" className="link-btn">{to ? shownDay(to) : 'the newest note'}</button>
            </DatePicker>
          </p>
          {!rangeOk && <p className="settings-error" role="alert">The start date is after the end date.</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="button button-secondary" onClick={closeExportDialog}>Cancel</button>
          <button
            type="button"
            className="button"
            disabled={!rangeOk}
            onClick={() => {
              void startExport({ spaceId, spaceName, include: { pictures, files }, from, to })
              openExportDetails()
            }}
          >
            Export
          </button>
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
    decide: 'Some files could not be downloaded',
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
          <DialogTitle>{title}</DialogTitle>
          <button type="button" className="icon-btn icon-btn-close !p-1" aria-label="Close" onClick={closeExportDialog}>
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
              <Meter value={percent(s)} label={`Files: ${s.done} of ${s.total}`} />
            </div>
          )}
          {running && s.step === 'pictures' && s.current && (
            <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line)] pt-3">
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
              {s.failedPictures} {s.failedPictures === 1 ? 'file' : 'files'} could not be downloaded. The server may be unreachable, or the {s.failedPictures === 1 ? 'file is' : 'files are'} damaged there.
            </p>
          )}
          {s.status === 'done' && s.report && <p className="settings-ok" role="status">{s.report}</p>}
          {s.status === 'stopped' && <p className="settings-note">Nothing was saved.</p>}
          {s.status === 'failed' && s.error && <p className="settings-error" role="alert">{s.error}</p>}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {running && canSkip && <button type="button" className="button button-secondary" onClick={skipCurrentPicture}>Skip</button>}
          {running && <button type="button" className="button button-secondary button-danger-quiet" onClick={stopExport}>Stop</button>}
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
