import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import ViewAgendaRoundedIcon from '@mui/icons-material/ViewAgendaRounded'
import type { AttachmentRecord, NoteRecord } from '../lib/types'
import { activities as activitiesRepo, attachments as attachmentsRepo, notes as notesRepo } from '../data'
import { notePreviewText, renderNoteHtml } from '../lib/note-format/render'
import { formatExactDateTime, formatRelativeShort } from '../lib/time'
import { colsOptions, fitCols, TILE_GAP, type FeedLayout } from '../lib/feed-layout'
import { useSpaceView } from '../lib/space-context'
import { canDeleteNote, canEditNotes } from '../lib/roles'
import { useNotePublicState } from '../lib/useSpaces'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { NoteTileImages } from './NoteImages'
import NoteShareDialog from './NoteShareDialog'
import NoteDetailsDialog from './NoteDetailsDialog'

const NO_ATTACHMENTS: AttachmentRecord[] = []

/** List / tiles switch for the feed's toolbar. */
export function FeedLayoutToggle({ layout, onChange }: { layout: FeedLayout; onChange: (next: FeedLayout) => void }) {
  return (
    <div className="seg seg-icons" role="group" aria-label="Layout">
      <button type="button" aria-pressed={layout.mode === 'list'} onClick={() => onChange({ ...layout, mode: 'list' })} aria-label="List" title="List">
        <ViewAgendaRoundedIcon fontSize="inherit" />
      </button>
      <button type="button" aria-pressed={layout.mode === 'grid'} onClick={() => onChange({ ...layout, mode: 'grid' })} aria-label="Tiles" title="Tiles">
        <GridViewRoundedIcon fontSize="inherit" />
      </button>
    </div>
  )
}

/** The feed as same-size tiles, with a slider for how many fit in a row. */
export default function NoteGrid({
  notes,
  layout,
  onLayoutChange,
  onOpenThread,
  onDelete,
  onManageFolders,
  repliesById,
  hiddenTags,
  showParentPreview,
  emptyText,
}: {
  notes: NoteRecord[]
  layout: FeedLayout
  onLayoutChange: (next: FeedLayout) => void
  onOpenThread?: (noteId: number) => void
  onDelete: (noteId: number) => void
  onManageFolders?: (note: NoteRecord) => void
  repliesById: Map<number, number>
  hiddenTags: Set<string>
  showParentPreview: boolean
  emptyText?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = width > 0 ? fitCols(layout.cols, width) : layout.cols
  const style = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: TILE_GAP } as CSSProperties

  return (
    <div ref={ref} className="space-y-3">
      {width > 0 && <TileSizeSlider width={width} cols={cols} onChange={c => onLayoutChange({ ...layout, cols: c })} />}
      {notes.length === 0
        ? <div className="feed-empty">{emptyText ?? 'No notes'}</div>
        : (
          <ul className="note-grid" style={style}>
            {notes.map(n => (
              <li key={n.id} id={`feed-note-${n.id}`} data-feed-note-id={n.id} className="min-w-0">
                <NoteTile
                  note={n}
                  onOpen={() => onOpenThread?.(n.id!)}
                  onDelete={() => onDelete(n.id!)}
                  onManageFolders={onManageFolders ? () => onManageFolders(n) : undefined}
                  repliesCount={repliesById.get(n.id!) || 0}
                  hiddenTags={hiddenTags}
                  showParentPreview={showParentPreview && n.parentId != null}
                />
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/**
 * Tile size as a slider that snaps to whole tiles per row. Left is many small tiles, right is a few
 * big ones; how many steps there are depends on how wide the feed is.
 */
function TileSizeSlider({ width, cols, onChange }: { width: number; cols: number; onChange: (cols: number) => void }) {
  // Bigger tiles to the right: the slider runs over the options from most to fewest per row.
  const options = useMemo(() => colsOptions(width).slice().reverse(), [width])
  if (options.length < 2) return null
  const pos = Math.max(0, options.indexOf(cols))
  return (
    <div className="tile-size">
      <GridViewRoundedIcon fontSize="inherit" className="tile-size-icon is-small" aria-hidden />
      <div className="tile-size-track">
        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={pos}
          onChange={e => onChange(options[Number(e.target.value)])}
          aria-label="Tile size"
          aria-valuetext={`${cols} per row`}
        />
        <div className="tile-size-ticks" aria-hidden>
          {options.map((c, i) => <span key={c} className={i === pos ? 'is-on' : undefined} />)}
        </div>
      </div>
      <GridViewRoundedIcon fontSize="inherit" className="tile-size-icon" aria-hidden />
      <span className="tile-size-label">{cols} per row</span>
    </div>
  )
}

/** The start of the note's text; fades out at the bottom only when there is more than fits. */
function TileText({ html, short }: { html: string; short: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [html])
  return <div ref={ref} className={['tile-text note-prose', short ? 'is-short' : '', clipped ? 'is-clipped' : ''].join(' ')} dangerouslySetInnerHTML={{ __html: html }} />
}

/** One note as a tile: pictures on top, the start of the text, and replies and date at the bottom. */
function NoteTile({
  note,
  onOpen,
  onDelete,
  onManageFolders,
  repliesCount,
  hiddenTags,
  showParentPreview,
}: {
  note: NoteRecord
  onOpen: () => void
  onDelete: () => void
  onManageFolders?: () => void
  repliesCount: number
  hiddenTags: Set<string>
  showParentPreview: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'share' | 'details' | null>(null)
  const view = useSpaceView()
  const pub = useNotePublicState(note)
  const mayEdit = canEditNotes(view.role)
  const mayDelete = canDeleteNote(view.role, note.authorId, view.meId)
  const attachments = (useLiveQuery(() => attachmentsRepo.listDisplayForNote(note.id!), [note.id]) ?? NO_ATTACHMENTS) as AttachmentRecord[]
  const parentNote = useLiveQuery(
    () => (showParentPreview && note.parentId ? notesRepo.getByLocalId(note.parentId) : Promise.resolve(undefined)),
    [showParentPreview, note.parentId],
  ) as NoteRecord | undefined
  const activities = (useLiveQuery(
    () => (note.id ? activitiesRepo.listDecoratedForNote(note.id) : Promise.resolve([])),
    [note.id],
  ) as Array<{ valueRaw: string; _name: string }>) || []

  const text = (note.text || '').trim()
  const html = useMemo(() => renderNoteHtml(text), [text])
  const tags = (note.tags || []).filter(t => !hiddenTags.has(t))
  const meta = [...activities.map(a => `${a._name}: ${a.valueRaw}`), ...tags.map(t => `#${t}`)]
  const hasMedia = attachments.length > 0
  // A picture with nothing to read fills the whole tile.
  const mediaOnly = hasMedia && !text
  // A line or two gets bigger type, so a short tile doesn't look empty.
  const short = !hasMedia && text.length > 0 && text.length <= 90 && !text.includes('\n')
  const parentShown = !!(parentNote && !parentNote.deletedAt)

  return (
    <div
      className={['note-tile', hasMedia ? 'has-media' : '', mediaOnly ? 'is-media-only' : ''].join(' ')}
      role="button"
      tabIndex={0}
      aria-label={notePreviewText(note.text) || 'Open note'}
      onClick={onOpen}
      // Right click, or a long press on a phone, opens the same menu as ⋮.
      onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen() } }}
    >
      {hasMedia && <NoteTileImages attachments={attachments} className="tile-media-area" />}

      {!mediaOnly && (
        <div className="tile-body">
          {parentShown && (
            <div className="tile-parent" title={notePreviewText(parentNote!.text)}>
              <SubdirectoryArrowRightRoundedIcon fontSize="inherit" aria-hidden />
              <span className="truncate">{notePreviewText(parentNote!.text)}</span>
            </div>
          )}
          {text
            ? <TileText html={html} short={short} />
            : <div className="tile-text" />}
          {meta.length > 0 && <div className="tile-meta" title={meta.join('  ')}>{meta.join('  ')}</div>}
        </div>
      )}

      <div className="tile-foot" title={formatExactDateTime(note.createdAt)}>
        {repliesCount > 0 && (
          <span className="tile-replies" aria-label={`${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}`}>
            <SubdirectoryArrowRightRoundedIcon fontSize="inherit" aria-hidden />
            {repliesCount}
          </span>
        )}
        {(pub.direct || pub.inherited) && <PublicRoundedIcon fontSize="inherit" aria-label="Public" />}
        <span className="tile-date">{formatRelativeShort(note.createdAt)}</span>
      </div>

      <div className={`tile-menu ${menuOpen ? 'is-open' : ''}`} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="tile-menu-btn" aria-label="Open actions">
              <MoreVertRoundedIcon fontSize="inherit" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            {onManageFolders && mayEdit && <DropdownMenuItem onSelect={onManageFolders}>Folders…</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => setDialog('share')}>Share…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('details')}>Details</DropdownMenuItem>
            {mayDelete && <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {dialog && (
        <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          {dialog === 'share' && <NoteShareDialog note={note} onClose={() => setDialog(null)} />}
          {dialog === 'details' && <NoteDetailsDialog note={note} onClose={() => setDialog(null)} />}
        </div>
      )}
    </div>
  )
}
