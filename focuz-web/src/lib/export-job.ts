// The export of a space as one app-wide job. It keeps running when the Settings dialog closes, and
// the progress panel and the details dialog read its state from here.
import { useSyncExternalStore } from 'react'
import {
  downloadBlob,
  exportSpace,
  ExportCancelledError,
  ExportControl,
  MissingPicturesError,
} from './data-transfer'
import { notify } from '../ui/notify'

export interface ExportRequest {
  spaceId: number
  spaceName: string
  withPictures: boolean
  /** YYYY-MM-DD, empty for no bound. */
  from: string
  to: string
}

export type ExportStatus = 'idle' | 'running' | 'decide' | 'done' | 'stopped' | 'failed'

export interface ExportState {
  status: ExportStatus
  /** While running: downloading pictures, or packing the file. */
  step: 'pictures' | 'packing'
  request: ExportRequest | null
  done: number
  total: number
  current: { fileName: string; fileSize: number } | null
  /** Pictures that could not be downloaded, waiting for the user's choice. */
  failedPictures: number
  report: string | null
  error: string | null
  /** Which dialog is open: the export options, or the progress details. */
  dialog: 'closed' | 'options' | 'details'
  /** The space the options dialog exports, chosen in Settings → Data. */
  target: { spaceId: number; spaceName: string } | null
}

const initial: ExportState = {
  status: 'idle',
  step: 'pictures',
  request: null,
  done: 0,
  total: 0,
  current: null,
  failedPictures: 0,
  report: null,
  error: null,
  dialog: 'closed',
  target: null,
}

let state: ExportState = initial
let control: ExportControl | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<ExportState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export function getExportState(): ExportState {
  return state
}

export function subscribeExport(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useExportState(): ExportState {
  return useSyncExternalStore(subscribeExport, getExportState, getExportState)
}

/** An export is in progress, or waits for the user's decision: the panel must stay visible. */
export function isExportActive(s: ExportState): boolean {
  return s.status === 'running' || s.status === 'decide'
}

/** Opens the options for a space. While an export runs, opens its progress instead. */
export function openExportOptions(target: { spaceId: number; spaceName: string }): void {
  if (isExportActive(state)) set({ dialog: 'details' })
  else set({ dialog: 'options', target })
}

export function openExportDetails(): void {
  set({ dialog: 'details' })
}

export function closeExportDialog(): void {
  set({ dialog: 'closed' })
}

/** Hides the export from the panel. Ends the wait for the user's decision, and forgets a finished one. */
export function dismissExport(): void {
  if (state.status === 'running') return
  set({ ...initial })
}

/** Starts the export. Does nothing while one is already running. */
export async function startExport(request: ExportRequest, opts: { skipUnavailable?: boolean } = {}): Promise<void> {
  if (state.status === 'running') return
  control = new ExportControl()
  set({
    status: 'running',
    step: request.withPictures ? 'pictures' : 'packing',
    request,
    done: 0,
    total: 0,
    current: null,
    failedPictures: 0,
    report: null,
    error: null,
    dialog: state.dialog === 'closed' ? 'details' : state.dialog,
  })
  try {
    const res = await exportSpace(request.spaceId, request.spaceName, request.withPictures, {
      from: request.from || undefined,
      to: request.to || undefined,
      skipUnavailable: opts.skipUnavailable,
      control,
      onProgress: (done, total, current) => {
        set({
          done,
          total,
          current: current ?? null,
          step: request.withPictures && done < total ? 'pictures' : 'packing',
        })
      },
    })
    downloadBlob(res.blob, res.fileName)
    const parts = [`${res.noteCount} ${res.noteCount === 1 ? 'note' : 'notes'}`]
    if (request.withPictures) parts.push(`${res.pictureCount} ${res.pictureCount === 1 ? 'file' : 'files'}`)
    let report = `Exported ${parts.join(' and ')}.`
    if (res.missingPictures > 0) report += ` ${res.missingPictures} ${res.missingPictures === 1 ? 'file is' : 'files are'} not in the export.`
    set({ status: 'done', report, current: null })
    notify('Export ready', 'success')
  } catch (e) {
    if (e instanceof MissingPicturesError) {
      set({ status: 'decide', failedPictures: e.count, current: null })
    } else if (e instanceof ExportCancelledError) {
      set({ status: 'stopped', current: null })
    } else {
      set({ status: 'failed', error: e instanceof Error ? e.message : 'Export failed', current: null })
    }
  } finally {
    control = null
  }
}

/** Skips the picture being downloaded: it is left out of the file. */
export function skipCurrentPicture(): void {
  control?.skipCurrent()
}

/** Stops the export. Nothing is written. */
export function stopExport(): void {
  control?.stop()
}

/** Tries the pictures that failed once more. */
export function retryFailedPictures(): void {
  if (state.request) void startExport(state.request)
}

/** Exports the file without the pictures that could not be downloaded. */
export function exportWithoutFailedPictures(): void {
  if (state.request) void startExport(state.request, { skipUnavailable: true })
}
