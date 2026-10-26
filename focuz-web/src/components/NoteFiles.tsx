import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded'
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { replaceLocalAttachment } from '../lib/sync'
import type { AttachmentRecord } from '../lib/types'
import { attachments as attachmentsRepo } from '../data'
import { useUploadStates } from '../lib/useUploadStates'
import UploadBadge from './UploadBadge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { renderNoteHtml } from '../lib/note-format/render'
import { canPreview, documentBlob, documentKind, formatBytes, isPicture, parseCsv, previewKind, saveBlob, type DocumentKind } from '../lib/attachment-files'
import { notify } from '../ui/notify'

const NONE: AttachmentRecord[] = []
// pdf.js and mammoth load only when a PDF or Word file is opened.
const PdfView = lazy(() => import('./DocumentViewers').then(m => ({ default: m.PdfView })))
const DocxView = lazy(() => import('./DocumentViewers').then(m => ({ default: m.DocxView })))

export function DocumentIcon({ kind }: { kind: DocumentKind }) {
  const Icon = kind === 'pdf' ? PictureAsPdfRoundedIcon
    : kind === 'sheet' || kind === 'csv' ? TableChartRoundedIcon
      : kind === 'slides' ? SlideshowRoundedIcon
        : kind === 'markdown' ? ArticleRoundedIcon
          : kind === 'word' || kind === 'text' ? DescriptionRoundedIcon
            : InsertDriveFileRoundedIcon
  return <Icon fontSize="inherit" aria-hidden />
}

/**
 * The documents of a note under its text: one droplet per file. Pictures are NoteImages' job.
 * mayEdit: text files (Markdown, text, CSV) can be edited in their preview.
 */
export default function NoteFiles({ noteId, mayEdit = false }: { noteId: number; mayEdit?: boolean }) {
  const all = (useLiveQuery(() => attachmentsRepo.listDisplayForNote(noteId), [noteId]) ?? NONE) as AttachmentRecord[]
  const files = useMemo(() => all.filter(a => !isPicture(a)), [all])
  const uploads = useUploadStates(files)
  const [preview, setPreview] = useState<PreviewSource | null>(null)
  if (files.length === 0) return null
  return (
    <>
      <ul className="file-list" aria-label="Files">
        {files.map(a => (
          <li key={a.id}>
            <FileChip att={a} onPreview={() => setPreview(attachmentSource(a, mayEdit))}>
              <UploadBadge state={uploads.get(a.id!)} />
            </FileChip>
          </li>
        ))}
      </ul>
      {preview && <DocumentPreviewDialog doc={preview} onClose={() => setPreview(null)} />}
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

/**
 * A document in the editor: name and size, and a button that takes it off the note. onOpen: the name
 * opens the file (to read or edit it) when it can be shown in the app.
 */
export function EditableFileChip({ fileName, fileSize, fileType, onRemove, onOpen, children }: {
  fileName: string; fileSize: number; fileType: string; onRemove: () => void; onOpen?: () => void; children?: React.ReactNode
}) {
  const kind = documentKind({ fileName, fileType })
  const opens = !!onOpen && canPreview({ fileName, fileType, fileSize })
  const inner = (
    <>
      <span className={`file-chip-icon file-kind-${kind}`}><DocumentIcon kind={kind} /></span>
      <span className="file-chip-name">{fileName}</span>
      <span className="file-chip-size">{formatBytes(fileSize)}</span>
    </>
  )
  return (
    <div className="file-chip">
      {opens
        ? <button type="button" className="file-chip-main" onClick={onOpen} title={`Open ${fileName}`}>{inner}</button>
        : <span className="file-chip-main">{inner}</span>}
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

/** A file the preview can show: an attachment of a note, or a file still waiting in the editor. */
export interface PreviewSource {
  fileName: string
  fileType: string
  fileSize: number
  load: () => Promise<Blob>
  /** Saves edited text; without it, the file is read-only. */
  save?: (blob: Blob) => Promise<void>
}

export function attachmentSource(att: AttachmentRecord, mayEdit: boolean): PreviewSource {
  return {
    fileName: att.fileName,
    fileType: att.fileType,
    fileSize: att.fileSize,
    load: () => documentBlob(att),
    save: mayEdit && att.id != null ? async blob => { await replaceLocalAttachment(att.id!, blob) } : undefined,
  }
}

/**
 * Reads a document inside the app: text, Markdown (through the note renderer, no HTML) and CSV here;
 * PDF (pdf.js, pages drawn on canvas) and Word (mammoth, cleaned HTML) in DocumentViewers.
 * stacked: opened from the full-screen editor, so it goes above it.
 */
export function DocumentPreviewDialog({ doc, onClose, stacked }: { doc: PreviewSource; onClose: () => void; stacked?: boolean }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The text being edited; null while reading.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const kind = previewKind(doc)
  const textual = kind === 'text' || kind === 'markdown' || kind === 'csv'
  useEffect(() => {
    let cancelled = false
    doc.load()
      .then(async b => {
        const t = textual ? await b.text() : null
        if (!cancelled) { setBlob(b); setText(t) }
      })
      .catch(e => { if (!cancelled) setError(downloadError(e)) })
    return () => { cancelled = true }
  }, [doc, textual])
  const onViewError = useCallback((message: string) => setError(message), [])
  const html = useMemo(() => (kind === 'markdown' && text != null ? renderNoteHtml(text) : ''), [kind, text])
  const rows = useMemo(() => (kind === 'csv' && text != null ? parseCsv(text) : null), [kind, text])
  const loading = <p className="text-secondary">Loading…</p>
  const editable = !!doc.save && textual && text != null
  const changed = draft != null && draft !== text

  async function save() {
    if (draft == null || !doc.save) return
    setSaving(true)
    try {
      await doc.save(new Blob([draft], { type: doc.fileType || 'text/plain' }))
      notify(`${doc.fileName} saved`, 'success')
      onClose()
    } catch {
      notify('Could not save the file', 'error')
      setSaving(false)
    }
  }

  return (
    // Unsaved edits are not dropped by Esc or a click outside: Cancel or Save.
    <Dialog open onOpenChange={o => { if (!o && !changed) onClose() }}>
      <DialogContent stacked={stacked} className="p-5 space-y-4 w-[min(92vw,45rem)]">
        <DialogTitle className="truncate pr-8">{doc.fileName}</DialogTitle>
        <DialogDescription className="sr-only">Contents of the file</DialogDescription>
        {draft != null ? (
          <textarea
            className="input doc-edit"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={kind !== 'csv'}
            aria-label={`Text of ${doc.fileName}`}
            autoFocus
          />
        ) : (
        <div className={`doc-preview-body ${kind === 'pdf' ? 'is-pdf' : ''}`}>
          {error ? <p className="settings-error" role="alert">{error}</p>
            : !blob ? loading
              : kind === 'pdf' ? <Suspense fallback={loading}><PdfView blob={blob} onError={onViewError} /></Suspense>
                : kind === 'docx' ? <Suspense fallback={loading}><DocxView blob={blob} onError={onViewError} /></Suspense>
                  : kind === 'markdown' ? <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
                    : rows ? <CsvTable rows={rows} />
                      : <pre className="doc-preview-text">{text}</pre>}
        </div>
        )}
        {draft != null ? (
          <div className="flex justify-end gap-2">
            <button type="button" className="button button-secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
            <button type="button" className="button" onClick={() => void save()} disabled={!changed || saving}>Save</button>
          </div>
        ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className="button button-secondary" onClick={onClose}>Close</button>
          {editable && (
            <button type="button" className="button button-secondary" onClick={() => setDraft(text)}>
              <EditRoundedIcon fontSize="inherit" aria-hidden /> Edit
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={!blob}
            onClick={() => { void doc.load().then(b => saveBlob(b, doc.fileName)).catch(e => notify('Could not download the file', 'error', { description: downloadError(e) })) }}
          >
            <FileDownloadRoundedIcon fontSize="inherit" aria-hidden /> Download
          </button>
        </div>
        )}
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
