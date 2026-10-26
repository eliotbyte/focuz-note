import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { AttachmentRecord } from '../lib/types'
import { attachments as attachmentsRepo } from '../data'
import { useUploadStates } from '../lib/useUploadStates'
import UploadBadge from './UploadBadge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { renderNoteHtml } from '../lib/note-format/render'
import { canPreview, documentBlob, documentKind, formatBytes, isPicture, parseCsv, saveBlob, type DocumentKind } from '../lib/attachment-files'
import { notify } from '../ui/notify'

const NONE: AttachmentRecord[] = []

export function DocumentIcon({ kind }: { kind: DocumentKind }) {
  const Icon = kind === 'pdf' ? PictureAsPdfRoundedIcon
    : kind === 'sheet' || kind === 'csv' ? TableChartRoundedIcon
      : kind === 'slides' ? SlideshowRoundedIcon
        : kind === 'markdown' ? ArticleRoundedIcon
          : kind === 'word' || kind === 'text' ? DescriptionRoundedIcon
            : InsertDriveFileRoundedIcon
  return <Icon fontSize="inherit" aria-hidden />
}

/** The documents of a note under its text: one droplet per file. Pictures are NoteImages' job. */
export default function NoteFiles({ noteId }: { noteId: number }) {
  const all = (useLiveQuery(() => attachmentsRepo.listDisplayForNote(noteId), [noteId]) ?? NONE) as AttachmentRecord[]
  const files = useMemo(() => all.filter(a => !isPicture(a)), [all])
  const uploads = useUploadStates(files)
  const [preview, setPreview] = useState<AttachmentRecord | null>(null)
  if (files.length === 0) return null
  return (
    <>
      <ul className="file-list" aria-label="Files">
        {files.map(a => (
          <li key={a.id}>
            <FileChip att={a} onPreview={() => setPreview(a)}>
              <UploadBadge state={uploads.get(a.id!)} />
            </FileChip>
          </li>
        ))}
      </ul>
      {preview && <DocumentPreviewDialog att={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

/** Downloads (or, for text, shows) one document. Fetching it from the server keeps it on this device. */
function FileChip({ att, onPreview, children }: { att: AttachmentRecord; onPreview: () => void; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false)
  const kind = documentKind(att)
  const previewable = canPreview(att)

  async function download() {
    setBusy(true)
    try {
      saveBlob(await documentBlob(att), att.fileName)
    } catch (e) {
      notify('Could not download the file', 'error', { description: downloadError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="file-chip">
      <button
        type="button"
        className="file-chip-main"
        onClick={() => { if (previewable) onPreview(); else void download() }}
        title={previewable ? `Open ${att.fileName}` : `Download ${att.fileName}`}
      >
        <span className={`file-chip-icon file-kind-${kind}`}><DocumentIcon kind={kind} /></span>
        <span className="file-chip-name">{att.fileName}</span>
        <span className="file-chip-size">{formatBytes(att.fileSize)}</span>
      </button>
      {previewable && (
        <button type="button" className="file-chip-action" onClick={() => void download()} aria-label={`Download ${att.fileName}`} title="Download" disabled={busy}>
          {busy ? <span className="upload-spinner" /> : <FileDownloadRoundedIcon fontSize="inherit" />}
        </button>
      )}
      {!previewable && busy && <span className="file-chip-action" role="status" aria-label="Downloading"><span className="upload-spinner" /></span>}
      {children}
    </div>
  )
}

/** A document in the editor: name and size, and a button that takes it off the note. */
export function EditableFileChip({ fileName, fileSize, fileType, onRemove, children }: {
  fileName: string; fileSize: number; fileType: string; onRemove: () => void; children?: React.ReactNode
}) {
  const kind = documentKind({ fileName, fileType })
  return (
    <div className="file-chip">
      <span className="file-chip-main">
        <span className={`file-chip-icon file-kind-${kind}`}><DocumentIcon kind={kind} /></span>
        <span className="file-chip-name">{fileName}</span>
        <span className="file-chip-size">{formatBytes(fileSize)}</span>
      </span>
      <button type="button" className="file-chip-action" onClick={onRemove} aria-label={`Remove ${fileName}`} title="Remove">
        <CloseRoundedIcon fontSize="inherit" />
      </button>
      {children}
    </div>
  )
}

function downloadError(e: unknown): string {
  if (!navigator.onLine) return 'You are offline, and the file is not on this device yet.'
  if ((e as { status?: number })?.status === 404) return 'The file is no longer on the server.'
  return 'The server could not be reached. Try again in a moment.'
}

/** Reads a text, Markdown or CSV file inside the app. Markdown goes through the note renderer (no HTML). */
function DocumentPreviewDialog({ att, onClose }: { att: AttachmentRecord; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kind = documentKind(att)
  useEffect(() => {
    let cancelled = false
    documentBlob(att)
      .then(b => b.text())
      .then(t => { if (!cancelled) setText(t) })
      .catch(e => { if (!cancelled) setError(downloadError(e)) })
    return () => { cancelled = true }
  }, [att])
  const html = useMemo(() => (kind === 'markdown' && text != null ? renderNoteHtml(text) : ''), [kind, text])
  const rows = useMemo(() => (kind === 'csv' && text != null ? parseCsv(text) : null), [kind, text])

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4 w-[min(92vw,45rem)]">
        <DialogTitle className="truncate pr-8">{att.fileName}</DialogTitle>
        <DialogDescription className="sr-only">Contents of the file</DialogDescription>
        <div className="doc-preview-body">
          {error ? <p className="settings-error" role="alert">{error}</p>
            : text == null ? <p className="text-secondary">Loading…</p>
              : kind === 'markdown' ? <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
                : rows ? <CsvTable rows={rows} />
                  : <pre className="doc-preview-text">{text}</pre>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="button button-secondary" onClick={onClose}>Close</button>
          <button
            type="button"
            className="button"
            disabled={text == null}
            onClick={() => { void documentBlob(att).then(b => saveBlob(b, att.fileName)).catch(e => notify('Could not download the file', 'error', { description: downloadError(e) })) }}
          >
            <FileDownloadRoundedIcon fontSize="inherit" aria-hidden /> Download
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CsvTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return <p className="text-secondary">The file is empty.</p>
  const [head, ...body] = rows
  return (
    <table className="doc-preview-table">
      <thead><tr>{head.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
      <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  )
}
