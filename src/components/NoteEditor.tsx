import { useEffect, useMemo, useRef, useState } from 'react'
import { useObjectUrl } from '../lib/useObjectUrl'
import TagsInput from './TagsInput'
import ActivitiesInput, { type ActivityDraft } from './ActivitiesInput'
import { featureFlags } from '../lib/feature-flags'
import { compressToWebP, getImageDimensions, validateImageGeometry } from '../lib/image'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AttachmentRecord } from '../lib/types'
import { activities as activitiesRepo, attachments as attachmentsRepo } from '../data'
import { deleteLocalAttachment, reorderNoteAttachments } from '../lib/sync'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { notify } from '../ui/notify'
import { filesFromDataTransfer, hasFiles, isImageFile } from '../lib/clipboard'

const MAX_ATTACHMENTS = 10

export type NoteEditorMode = 'create' | 'edit' | 'reply'

export interface NoteEditorValue {
  text: string
  tags: string[]
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
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [attachments, setAttachments] = useState<File[]>([])
  const allowActivitiesInline = mode === 'edit' ? true : featureFlags.noteCreateAddActivity
  const allowActivitiesInAddMenu = mode === 'edit' ? featureFlags.noteCreateAddActivity : allowActivitiesInline
  const [activities, setActivities] = useState<ActivityDraft[]>(allowActivitiesInline ? (value.activities || []) : [])
  const [editRequestTypeId, setEditRequestTypeId] = useState<number | null>(null)

  // Existing attachments for edit mode
  const existingAttachments = (useLiveQuery(async () => {
    if (!noteId || mode !== 'edit') return [] as AttachmentRecord[]
    return attachmentsRepo.listActiveSortedForNote(noteId)
  }, [noteId, mode]) ?? []) as AttachmentRecord[]

  const canSubmit = useMemo(() => value.text.trim().length > 0, [value.text])
  const maxReached = attachments.length >= MAX_ATTACHMENTS
  const attachmentsCountRef = useRef(0)
  attachmentsCountRef.current = attachments.length

  useEffect(() => {
    if (expanded) textRef.current?.focus()
  }, [expanded])

  function autoResize(target: HTMLTextAreaElement | null) {
    if (!target) return
    target.style.height = 'auto'
    target.style.height = `${target.scrollHeight}px`
  }

  useEffect(() => {
    autoResize(textRef.current)
  }, [value.text, expanded])

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

  function onPaste(e: React.ClipboardEvent) {
    const files = filesFromDataTransfer(e.clipboardData)
    if (files.length === 0) return
    // Keep text paste working when the clipboard has both text and an image.
    const text = e.clipboardData.getData('text/plain')
    if (!text) e.preventDefault()
    void addImageFiles(files)
  }

  function onDrop(e: React.DragEvent) {
    const files = filesFromDataTransfer(e.dataTransfer)
    if (files.length === 0) return
    e.preventDefault()
    void addImageFiles(files)
  }

  function collapseIfNeeded() {
    if (autoCollapse && (mode === 'create' || mode === 'reply')) setExpanded(false)
  }

  if (!expanded) {
    return (
      <div className="card p-2">
        <button
          type="button"
          className="w-full text-left text-sm text-neutral-400 rounded px-1 py-1 hover:text-neutral-200"
          onClick={() => setExpanded(true)}
        >
          {mode === 'reply' ? 'Reply…' : 'Add note…'}
        </button>
      </div>
    )
  }

  const containerClass = variant === 'card' ? 'card space-y-3' : 'space-y-3'

  return (
    <div
      className={containerClass}
      onPaste={onPaste}
      onDragOver={e => { if (hasFiles(e.dataTransfer)) e.preventDefault() }}
      onDrop={onDrop}
    >
      <textarea
        ref={textRef}
        className="input min-h-20 text-primary resize-none overflow-hidden"
        placeholder={mode === 'reply' ? 'Reply…' : 'Add note… (paste or drop images here)'}
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
        onInput={e => autoResize(e.currentTarget)}
      />
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
      <TagsInput value={value.tags} onChange={tags => onChange({ ...value, tags })} placeholder="Add tags" spaceId={spaceId} />
      {mode === 'edit' && existingAttachments.length > 0 && attachments.length === 0 && (
        <div className="text-xs text-neutral-400">Adding new photos will be uploaded when you click Update.</div>
      )}
      {(mode === 'edit' && existingAttachments.length > 0) && (
        <div className="flex flex-wrap gap-2"
          onDragOver={e => { e.preventDefault() }}
        >
          {existingAttachments.map((att, idx) => (
            <div
              key={att.id ?? idx}
              className="relative w-16 h-16 rounded-[var(--radius-control)] overflow-hidden bg-neutral-800"
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/plain', String(att.id)) }}
              onDrop={async e => {
                e.preventDefault()
                const srcId = Number(e.dataTransfer.getData('text/plain'))
                const dstId = att.id!
                if (!noteId || !srcId || !dstId || srcId === dstId) return
                const ids = existingAttachments.map(a => a.id!)
                const from = ids.indexOf(srcId)
                const to = ids.indexOf(dstId)
                if (from < 0 || to < 0) return
                const next = ids.slice()
                const [m] = next.splice(from, 1)
                next.splice(to, 0, m)
                try { await reorderNoteAttachments(noteId, next) } catch {}
              }}
            >
              {att.data ? (
                <BlobImg blob={att.data} className="w-full h-full object-cover" alt={att.fileName} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs">img</div>
              )}
              <button
                type="button"
                className="absolute -top-1 -right-1 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-100 rounded-full w-5 h-5 text-xs"
                onClick={async () => { if (att.id != null) { try { await deleteLocalAttachment(att.id) } catch {} } }}
                aria-label="Remove attachment"
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2"
          onDragOver={e => { e.preventDefault() }}
        >
          {attachments.map((file, idx) => (
            <div
              key={`new-${idx}`}
              className="relative w-16 h-16 rounded-[var(--radius-control)] overflow-hidden bg-neutral-800"
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/plain', `new:${idx}`) }}
              onDrop={e => {
                e.preventDefault()
                const data = e.dataTransfer.getData('text/plain')
                if (!data.startsWith('new:')) return
                const from = Number(data.split(':')[1])
                const to = idx
                if (isNaN(from) || from === to) return
                setAttachments(prev => {
                  const next = prev.slice()
                  const [m] = next.splice(from, 1)
                  next.splice(to, 0, m)
                  return next
                })
              }}
            >
              <BlobImg blob={file} className="w-full h-full object-cover" alt="attachment" />
              <button
                type="button"
                className="absolute -top-1 -right-1 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-100 rounded-full w-5 h-5 text-xs"
                onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                aria-label="Remove attachment"
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={async e => {
        const files = Array.from(e.target.files ?? [])
        try { if (fileInputRef.current) fileInputRef.current.value = '' } catch {}
        await addImageFiles(files)
      }} />
      <div className="flex justify-end gap-2">
        <div className="flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="button">Add</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem
                disabled={maxReached}
                className="disabled:opacity-50"
                onSelect={() => { fileInputRef.current?.click() }}
              >
                Photo
              </DropdownMenuItem>
              {allowActivitiesInAddMenu ? (
                <>
                  <DropdownMenuSeparator />
                <ActivitiesInput
                  value={activities}
                  onChange={(acts) => { setActivities(acts); onChange({ ...value, activities: acts }); }}
                  spaceId={spaceId}
                  menuOnly
                  onAddedType={(tid) => { setEditRequestTypeId(tid) }}
                />
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {onCancel && (
          <button className="button" onClick={() => { onCancel(); setAttachments([]); collapseIfNeeded() }}>Cancel</button>
        )}
        <button
          className="button"
          onClick={() => {
            if (onSubmitWithExtra) onSubmitWithExtra({ attachments })
            else onSubmit()
            setAttachments([])
            collapseIfNeeded()
          }}
          disabled={!canSubmit}
        >{mode === 'edit' ? 'Update' : mode === 'reply' ? 'Reply' : 'Create'}</button>
      </div>
    </div>
  )
} 

function BlobImg({ blob, alt, className }: { blob: Blob; alt?: string; className?: string }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return <img src={url} className={className} alt={alt || ''} />
}