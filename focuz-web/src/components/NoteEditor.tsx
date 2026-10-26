import { useEffect, useMemo, useRef, useState } from 'react'
import { useAttachmentUrl, useObjectUrl } from '../lib/useObjectUrl'
import UploadBadge from './UploadBadge'
import { useUploadStates } from '../lib/useUploadStates'
import TagsInput from './TagsInput'
import ActivitiesInput, { type ActivityDraft } from './ActivitiesInput'
import { featureFlags } from '../lib/feature-flags'
import { compressToWebP, getImageDimensions, validateImageGeometry } from '../lib/image'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AttachmentRecord } from '../lib/types'
import { activities as activitiesRepo, attachments as attachmentsRepo } from '../data'
import { deleteLocalAttachment, reorderNoteAttachments } from '../lib/sync'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { notify, notifyUndoable } from '../ui/notify'
import { filesFromDataTransfer, hasFiles, isImageFile } from '../lib/clipboard'
import FullscreenNoteEditor from './FullscreenNoteEditor'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AttachMenu from './AttachMenu'
import { attachmentSource, DocumentPreviewDialog, EditableFileChip, type PreviewSource } from './NoteFiles'
import { checkDocument, DOCUMENT_ACCEPT, isPicture, MAX_DOCUMENTS } from '../lib/attachment-files'
import { pasteFile, type LargePaste } from '../lib/note-format/code-paste'
import { languageLabel } from '../lib/code-languages'
import CalendarTodayRoundedIcon from '@mui/icons-material/CalendarTodayRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ImageEditorDialog from './ImageEditorDialog'
import InlineNoteEditor, { type InlineNoteEditorHandle } from './InlineNoteEditor'
import { dayOf, withDay } from '../lib/note-date'

const MAX_ATTACHMENTS = 10
const NO_ATTACHMENTS: AttachmentRecord[] = []

export type NoteEditorMode = 'create' | 'edit' | 'reply'

export interface NoteEditorValue {
  text: string
  tags: string[]
  /** ISO timestamp of the note's date. Undefined on create means the creation time. */
  date?: string
  activities?: ActivityDraft[]
}

export default function NoteEditor({
  value,
  onChange,
  onSubmit,
  onSubmitWithExtra,
  onCancel,
  mode = 'create',
  autoCollapse = true,
  variant = 'card',
  defaultExpanded,
  spaceId,
  noteId,
}: {
  value: NoteEditorValue
  onChange: (v: NoteEditorValue) => void
  onSubmit: () => void
  onSubmitWithExtra?: (extra: { attachments?: File[] }) => void
  onCancel?: () => void
  mode?: NoteEditorMode
  autoCollapse?: boolean
  variant?: 'card' | 'embedded'
  defaultExpanded?: boolean
  spaceId?: number
  noteId?: number
}) {
  const [expanded, setExpanded] = useState<boolean>(
    typeof defaultExpanded === 'boolean' ? defaultExpanded : (mode !== 'create' ? true : false)
  )
  const textRef = useRef<InlineNoteEditorHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const docInputRef = useRef<HTMLInputElement | null>(null)
  // New pictures (already WebP) and new documents (as they are), uploaded on submit.
  const [attachments, setAttachments] = useState<File[]>([])
  const [docs, setDocs] = useState<File[]>([])
  // A file opened from the editor's list, to read or edit it.
  const [openDoc, setOpenDoc] = useState<PreviewSource | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const allowActivitiesInline = mode === 'edit' ? true : featureFlags.noteCreateAddActivity
  const allowActivitiesInAddMenu = mode === 'edit' ? featureFlags.noteCreateAddActivity : allowActivitiesInline
  const [activities, setActivities] = useState<ActivityDraft[]>(allowActivitiesInline ? (value.activities || []) : [])
  const [editRequestTypeId, setEditRequestTypeId] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // The full-screen editor reports text changes asynchronously; merge them into the latest value.
  const valueRef = useRef(value)
  valueRef.current = value

  // Existing attachments for edit mode
  const existingAttachments = (useLiveQuery(async () => {
    if (!noteId || mode !== 'edit') return [] as AttachmentRecord[]
    return attachmentsRepo.listActiveSortedForNote(noteId)
  }, [noteId, mode]) ?? NO_ATTACHMENTS) as AttachmentRecord[]
  const existingUploads = useUploadStates(existingAttachments)
  const existingPictures = useMemo(() => existingAttachments.filter(isPicture), [existingAttachments])
  const existingDocs = useMemo(() => existingAttachments.filter(a => !isPicture(a)), [existingAttachments])

  // A note needs text or at least one file (one being added, or one it already has).
  const canSubmit = useMemo(
    () => value.text.trim().length > 0 || attachments.length > 0 || docs.length > 0 || (mode === 'edit' && existingAttachments.length > 0),
    [value.text, attachments.length, docs.length, mode, existingAttachments.length],
  )
  // The day the note is about: a calendar button that shows the day only when it is not today.
  const dateInput = mode === 'reply' ? null : (
    <NoteDateButton date={value.date} onChange={date => onChange({ ...valueRef.current, date })} />
  )
  const maxReached = attachments.length >= MAX_ATTACHMENTS
  const attachmentsCountRef = useRef(0)
  attachmentsCountRef.current = attachments.length
  const docsMaxReached = docs.length >= MAX_DOCUMENTS

  // Hard gate: never keep activities drafts in production for create/reply.
  useEffect(() => {
    if (allowActivitiesInline) return
    if (Array.isArray(value.activities) && value.activities.length > 0) onChange({ ...value, activities: [] })
    if (activities.length > 0) setActivities([])
  }, [allowActivitiesInline])

  // Prefill activities for edit mode from DB if not provided (deduplicated per typeId)
  const existingActivities = (useLiveQuery(async () => {
    if (!noteId || mode !== 'edit') return [] as Array<{ typeId: number; valueRaw: string }>
    const drafts = await activitiesRepo.listDraftsForNote(noteId)
    return drafts.map(a => ({ typeId: a.typeId, valueRaw: a.valueRaw }))
  }, [noteId, mode]) || []) as Array<ActivityDraft>

  useEffect(() => {
    if (mode === 'edit' && activities.length === 0 && existingActivities.length > 0) {
      setActivities(existingActivities)
      onChange({ ...value, activities: existingActivities })
    }
  }, [mode, noteId, existingActivities])

  // Stage images locally (compressed to WebP); the parent uploads them on submit.
  async function addImageFiles(files: File[]) {
    const images = files.filter(isImageFile)
    if (images.length === 0) return
    let added = 0
    for (const f of images) {
      if (attachmentsCountRef.current + added >= MAX_ATTACHMENTS) {
        notify('Image not added', 'warning', { id: 'editor-max-images', description: `A note can have up to ${MAX_ATTACHMENTS} images.` })
        break
      }
      try {
        const dim = await getImageDimensions(f)
        const check = validateImageGeometry(dim)
        if (!check.ok) {
          notify('Image not added', 'warning', { description: `${f.name || 'Image'} (${dim.width}×${dim.height}): ${check.reason || 'unsupported size'}.` })
          continue
        }
        const res = await compressToWebP(f)
        const out = new File([res.blob], res.fileName, { type: res.fileType })
        added++
        setAttachments(prev => prev.length >= MAX_ATTACHMENTS ? prev : [...prev, out])
      } catch {
        notify('Image not added', 'error', { description: `${f.name || 'The file'} could not be read as an image.` })
      }
    }
  }

  // Stage documents as they are; the parent uploads them on submit with the pictures.
  function addDocumentFiles(files: File[]) {
    const accepted: File[] = []
    for (const f of files) {
      if (docs.length + accepted.length >= MAX_DOCUMENTS) {
        notify('File not added', 'warning', { id: 'editor-max-files', description: `A note can have up to ${MAX_DOCUMENTS} files.` })
        break
      }
      const check = checkDocument(f)
      if (!check.ok) {
        notify('File not added', 'warning', { description: `${f.name || 'The file'}: ${check.reason}.` })
        continue
      }
      accepted.push(f)
    }
    if (accepted.length > 0) setDocs(prev => [...prev, ...accepted].slice(0, MAX_DOCUMENTS))
  }

  // Long pasted code or text becomes a Markdown file on the note; the toast can put it back into the text.
  const docsRef = useRef(docs)
  docsRef.current = docs
  function onLargePaste(p: LargePaste) {
    const current = docsRef.current
    const taken = [...current.map(f => f.name), ...existingDocs.map(a => a.fileName)]
    if (current.length >= MAX_DOCUMENTS) { p.keepInText(); return }
    const file = pasteFile(p, taken)
    setDocs(prev => [...prev, file])
    const lines = p.content.split('\n').length
    const what = p.kind === 'code' ? `${p.language ? languageLabel(p.language) + ' ' : ''}code` : 'text'
    notifyUndoable(
      `${lines} ${lines === 1 ? 'line' : 'lines'} of ${what} saved as ${file.name}`,
      { label: 'Keep in text', onClick: () => { setDocs(prev => prev.filter(f => f !== file)); p.keepInText() } },
      { durationMs: 10000 },
    )
  }

  function addFiles(files: File[]) {
    void addImageFiles(files.filter(isImageFile))
    addDocumentFiles(files.filter(f => !isImageFile(f)))
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = filesFromDataTransfer(e.clipboardData)
    if (files.length === 0) return
    // Keep text paste working when the clipboard has both text and a file.
    const text = e.clipboardData.getData('text/plain')
    if (!text) e.preventDefault()
    addFiles(files)
  }

  function onDrop(e: React.DragEvent) {
    const files = filesFromDataTransfer(e.dataTransfer)
    if (files.length === 0) return
    e.preventDefault()
    addFiles(files)
  }

  function collapseIfNeeded() {
    if (autoCollapse && (mode === 'create' || mode === 'reply')) setExpanded(false)
  }

  if (!expanded) {
    return (
      <div className="card p-2">
        <button
          type="button"
          className="composer-collapsed"
          onClick={() => setExpanded(true)}
        >
          {mode === 'reply' ? 'Reply…' : 'Add note…'}
        </button>
      </div>
    )
  }

  const containerClass = variant === 'card' ? 'card space-y-3' : 'space-y-3'
  const submitLabel = mode === 'edit' ? 'Update' : mode === 'reply' ? 'Reply' : 'Create'

  function submit() {
    if (!canSubmit) return
    if (onSubmitWithExtra) onSubmitWithExtra({ attachments: [...attachments, ...docs] })
    else onSubmit()
    setAttachments([])
    setDocs([])
    setFullscreen(false)
    collapseIfNeeded()
  }

  function moveExisting(from: number, to: number) {
    if (!noteId) return
    const ids = existingPictures.map(a => a.id!)
    const [m] = ids.splice(from, 1)
    ids.splice(to, 0, m)
    void reorderNoteAttachments(noteId, ids).catch(() => {})
  }

  function moveNew(from: number, to: number) {
    setAttachments(prev => {
      const next = prev.slice()
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  }

  const thumbnails = (
    <>
        {mode === 'edit' && existingAttachments.length > 0 && attachments.length === 0 && docs.length === 0 && (
          <div className="text-xs text-secondary">New photos and files are uploaded when you click Update.</div>
        )}
        {(mode === 'edit' && existingPictures.length > 0) && (
          <SortableThumbs
            group="existing"
            items={existingPictures}
            keyOf={att => `att-${att.id}`}
            onMove={moveExisting}
            render={(att) => (
              <>
                {att.data ? (
                  <AttachmentThumb att={att} />
                ) : (
                  <div className="thumb-empty">img</div>
                )}
                <UploadBadge state={existingUploads.get(att.id!)} />
                <button
                  type="button"
                  className="thumb-remove"
                  onClick={async () => { if (att.id != null) { try { await deleteLocalAttachment(att.id) } catch {} } }}
                  aria-label="Remove attachment"
                  title="Remove"
                ><CloseRoundedIcon fontSize="inherit" /></button>
              </>
            )}
          />
        )}
        {attachments.length > 0 && (
          <SortableThumbs
            group="new"
            items={attachments}
            keyOf={file => `new-${fileKey(file)}`}
            onMove={moveNew}
            render={(file, idx) => (
              <>
                <BlobImg blob={file} className="w-full h-full object-cover" alt="attachment" />
                <button
                  type="button"
                  className="thumb-edit"
                  onClick={() => setEditingIdx(idx)}
                  aria-label={`Edit image ${idx + 1}`}
                  title="Crop, rotate, flip"
                ><EditRoundedIcon fontSize="inherit" /></button>
                <button
                  type="button"
                  className="thumb-remove"
                  onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                  aria-label="Remove attachment"
                  title="Remove"
                ><CloseRoundedIcon fontSize="inherit" /></button>
              </>
            )}
          />
        )}
        {((mode === 'edit' && existingDocs.length > 0) || docs.length > 0) && (
          <ul className="file-list" aria-label="Files">
            {mode === 'edit' && existingDocs.map(att => (
              <li key={`att-${att.id}`}>
                <EditableFileChip
                  fileName={att.fileName}
                  fileSize={att.fileSize}
                  fileType={att.fileType}
                  onRemove={() => { if (att.id != null) void deleteLocalAttachment(att.id).catch(() => {}) }}
                  onOpen={() => setOpenDoc(attachmentSource(att, true))}
                >
                  <UploadBadge state={existingUploads.get(att.id!)} />
                </EditableFileChip>
              </li>
            ))}
            {docs.map((f, idx) => (
              <li key={`doc-${fileKey(f)}`}>
                <EditableFileChip fileName={f.name} fileSize={f.size} fileType={f.type} onRemove={() => setDocs(prev => prev.filter((_, i) => i !== idx))} onOpen={() => setOpenDoc(stagedSource(f))} />
              </li>
            ))}
          </ul>
        )}
    </>
  )

  // A file not uploaded yet: edits replace it in the list, keeping its name and place.
  function stagedSource(file: File): PreviewSource {
    return {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      load: async () => file,
      save: async blob => {
        const next = new File([blob], file.name, { type: file.type || 'text/markdown' })
        setDocs(prev => prev.map(f => (f === file ? next : f)))
      },
    }
  }

  // The note's own tools sit with its submit button, in the composer and in the full-screen editor.
  const attachMenu = (
    <AttachMenu
      triggerClassName="composer-tool"
      onPickPicture={() => fileInputRef.current?.click()}
      onPickFile={() => docInputRef.current?.click()}
      picturesDisabled={maxReached}
      filesDisabled={docsMaxReached}
    />
  )
  const tagsInput = <TagsInput value={value.tags} onChange={tags => onChange({ ...value, tags })} placeholder="Add tags" spaceId={spaceId} />

  return (
    <div
      className={containerClass}
      onPaste={onPaste}
      onDragOver={e => { if (hasFiles(e.dataTransfer)) e.preventDefault() }}
      onDrop={onDrop}
    >
      <div className="relative input text-primary pr-10">
        <InlineNoteEditor
          handle={textRef}
          text={value.text}
          onChange={text => onChange({ ...valueRef.current, text })}
          onSubmit={submit}
          placeholder={mode === 'reply' ? 'Reply…' : 'Add note… (paste or drop pictures and files here)'}
          label={mode === 'reply' ? 'Reply' : mode === 'edit' ? 'Edit note' : 'Add note'}
          onLargePaste={onLargePaste}
        />
        <button
          type="button"
          className="note-expand-btn"
          onClick={() => setFullscreen(true)}
          aria-label="Open full-screen editor"
          title="Full-screen editor with formatting and checklists"
        >
          <OpenInFullRoundedIcon fontSize="inherit" />
        </button>
      </div>
      {allowActivitiesInline ? (
        <ActivitiesInput
          value={activities}
          onChange={(acts) => { setActivities(acts); onChange({ ...value, activities: acts }) }}
          spaceId={spaceId}
          hideAddButton
          requestEditTypeId={editRequestTypeId}
          onEditRequestHandled={() => setEditRequestTypeId(null)}
        />
      ) : null}
      {tagsInput}
      {thumbnails}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={async e => {
        const files = Array.from(e.target.files ?? [])
        try { if (fileInputRef.current) fileInputRef.current.value = '' } catch {}
        await addImageFiles(files)
      }} />
      <input ref={docInputRef} type="file" accept={DOCUMENT_ACCEPT} multiple className="hidden" onChange={e => {
        const files = Array.from(e.target.files ?? [])
        try { if (docInputRef.current) docInputRef.current.value = '' } catch {}
        addFiles(files)
      }} />
      <div className="flex items-center justify-end gap-2">
        <div className="flex-1 flex items-center gap-1 min-w-0">
          {attachMenu}
          {dateInput}
          {allowActivitiesInAddMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="composer-tool" aria-label="Add activity" title="Add activity"><AddRoundedIcon fontSize="inherit" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <ActivitiesInput
                  value={activities}
                  onChange={(acts) => { setActivities(acts); onChange({ ...value, activities: acts }); }}
                  spaceId={spaceId}
                  menuOnly
                  onAddedType={(tid) => { setEditRequestTypeId(tid) }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {onCancel && (
          <button className="button button-secondary" onClick={() => { onCancel(); setAttachments([]); setDocs([]); collapseIfNeeded() }}>Cancel</button>
        )}
        <button className="button button-default" onClick={submit} disabled={!canSubmit}>{submitLabel}</button>
      </div>
      <FullscreenNoteEditor
        open={fullscreen}
        onOpenChange={(o) => { setFullscreen(o); if (!o) requestAnimationFrame(() => textRef.current?.focus()) }}
        title={mode === 'edit' ? 'Edit note' : mode === 'reply' ? 'Reply' : 'New note'}
        initialText={value.text}
        onTextChange={text => onChange({ ...valueRef.current, text })}
        onSubmit={submit}
        submitLabel={submitLabel}
        canSubmit={canSubmit}
        onLargePaste={onLargePaste}
        placeholder={mode === 'reply' ? 'Reply…' : 'Write a note… Type "[ ] " for a checklist, "# " for a heading'}
        // Paste/drop of images inside the dialog bubbles (through the React portal) to this editor's handlers.
        footer={<div className="fse-meta">{tagsInput}{thumbnails}</div>}
        actionsStart={<>{attachMenu}{dateInput}</>}
      />
      {openDoc && <DocumentPreviewDialog doc={openDoc} stacked={fullscreen} onClose={() => setOpenDoc(null)} />}
      {editingIdx != null && attachments[editingIdx] && (
        <ImageEditorDialog
          image={attachments[editingIdx]}
          title="Edit image"
          saveLabel="Apply"
          onCancel={() => setEditingIdx(null)}
          onSave={blob => {
            const i = editingIdx
            setAttachments(prev => prev.map((f, k) => k === i ? new File([blob], f.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type || 'image/webp' }) : f))
            setEditingIdx(null)
          }}
        />
      )}
    </div>
  )
} 

/** The note's day as a calendar button; the day is written next to it only when it is not today. */
function NoteDateButton({ date, onChange }: { date?: string; onChange: (date: string) => void }) {
  const input = useRef<HTMLInputElement | null>(null)
  const day = dayOf(date ?? new Date())
  const isToday = day === dayOf(new Date())
  const [y, m, d] = day.split('-').map(Number)
  const shown = new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className={`composer-tool ${isToday ? '' : 'has-label'}`}
        aria-label={`Note date: ${shown}`}
        title="Note date"
        onClick={() => { try { input.current?.showPicker() } catch { input.current?.focus() } }}
      >
        <CalendarTodayRoundedIcon fontSize="inherit" />
        {!isToday && <span className="composer-tool-label">{shown}</span>}
      </button>
      {/* The browser's own date picker, opened from the button. Clearing it is ignored: a note always has a day. */}
      <input
        ref={input}
        type="date"
        className="composer-date-input"
        tabIndex={-1}
        aria-hidden
        value={day}
        onChange={e => { if (e.target.value) onChange(withDay(date ?? new Date(), e.target.value)) }}
      />
    </span>
  )
}

function BlobImg({ blob, alt, className }: { blob: Blob; alt?: string; className?: string }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return <img src={url} className={className} alt={alt || ''} draggable={false} />
}

function AttachmentThumb({ att }: { att: AttachmentRecord }) {
  const url = useAttachmentUrl(att)
  if (!url) return null
  return <img src={url} className="w-full h-full object-cover" alt={att.fileName} draggable={false} />
}

// Staged files have no id; the File object itself is stable while it sits in state.
const fileKeys = new WeakMap<File, number>()
let nextFileKey = 1
function fileKey(f: File): number {
  let k = fileKeys.get(f)
  if (k == null) { k = nextFileKey++; fileKeys.set(f, k) }
  return k
}

// A row of thumbnails you put in order by dragging one onto another's place.
// Pointer events rather than HTML drag-and-drop: they work with a finger too, and dragging a
// picture can't turn into dropping a new file on the editor.
function SortableThumbs<T>({ group, items, keyOf, render, onMove }: {
  group: string
  items: T[]
  keyOf: (item: T) => string
  render: (item: T, index: number) => React.ReactNode
  onMove: (from: number, to: number) => void
}) {
  const [drag, setDrag] = useState<{ from: number; over: number; dx: number; dy: number } | null>(null)
  const start = useRef<{ from: number; x: number; y: number; pointerId: number; active: boolean } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag

  function indexAt(x: number, y: number, from: number): number {
    for (const el of document.elementsFromPoint(x, y)) {
      const cell = (el as HTMLElement).closest?.('[data-thumb]') as HTMLElement | null
      if (!cell || cell.dataset.thumbGroup !== group) continue
      const i = Number(cell.dataset.thumb)
      if (i !== from) return i
    }
    return from
  }

  function finish(commit: boolean) {
    const s = start.current
    const d = dragRef.current
    start.current = null
    setDrag(null)
    if (commit && s?.active && d && d.over !== d.from) onMove(d.from, d.over)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, idx) => {
        const dragging = drag?.from === idx
        const target = !!drag && drag.over === idx && drag.from !== idx
        return (
          <div
            key={keyOf(item)}
            data-thumb={idx}
            data-thumb-group={group}
            className={[
              'relative w-16 h-16 thumb-cell overflow-hidden select-none',
              items.length > 1 ? 'cursor-grab touch-none' : '',
              dragging ? 'cursor-grabbing opacity-80 shadow-lg' : '',
              target ? 'is-target' : '',
            ].join(' ')}
            style={dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)`, zIndex: 10 } : undefined}
            onPointerDown={e => {
              if (items.length < 2 || e.button !== 0) return
              if ((e.target as HTMLElement).closest('button')) return
              start.current = { from: idx, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false }
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
            }}
            onPointerMove={e => {
              const s = start.current
              if (!s || s.pointerId !== e.pointerId) return
              const dx = e.clientX - s.x
              const dy = e.clientY - s.y
              if (!s.active && Math.hypot(dx, dy) < 6) return
              s.active = true
              setDrag({ from: s.from, over: indexAt(e.clientX, e.clientY, s.from), dx, dy })
            }}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
            aria-label={`Image ${idx + 1} of ${items.length}${items.length > 1 ? ', drag to reorder' : ''}`}
          >
            {render(item, idx)}
          </div>
        )
      })}
    </div>
  )
}