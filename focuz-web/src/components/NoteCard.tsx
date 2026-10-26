import { useState, type MouseEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord } from '../lib/types'
import { activities as activitiesRepo, notes as notesRepo } from '../data'
// import HighlightedText from './HighlightedText'
import NoteBody from './NoteBody'
import { noteLabel } from '../lib/note-format/render'
import NoteImages from './NoteImages'
import NoteFiles from './NoteFiles'
import { formatExactDateTime, formatRelativeShort, formatDurationShort, parseDurationToMs } from '../lib/time'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Pill } from './ui/pill'
import { SurfaceNoPad } from './ui/surface'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import SyncMark from './SyncMark'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import { useSpaceView } from '../lib/space-context'
import { canDeleteNote, canEditNotes, canWrite } from '../lib/roles'
import { useNotePublicState } from '../lib/useSpaces'
import NoteShareDialog from './NoteShareDialog'
import NoteDetailsDialog from './NoteDetailsDialog'
import { PersonAvatar } from './ui/avatar'
import NoteDateTip from './NoteDateTip'

export default function NoteCard({
  note,
  onEdit,
  onDelete,
  onOpenThread,
  showParentPreview = false,
  showFullDate = false,
  onTagClick,
  onActivityClick,
  hiddenTags,
  repliesCount = 0,
  onReplyClick,
  onManageFolders,
}: {
  note: NoteRecord
  onEdit?: () => void
  onDelete?: () => void
  onOpenThread?: (nid: number) => void
  showParentPreview?: boolean
  /** The note on its own: show its date in full in place of "3w" (plain text, no tooltip). */
  showFullDate?: boolean
  onTagClick?: (tag: string) => void
  onActivityClick?: (name: string) => void
  hiddenTags?: Set<string>
  repliesCount?: number
  onReplyClick?: () => void
  onManageFolders?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'share' | 'details' | null>(null)
  const view = useSpaceView()
  const pub = useNotePublicState(note)
  const mayWrite = canWrite(view.role)
  const mayEdit = canEditNotes(view.role)
  const mayDelete = canDeleteNote(view.role, note.authorId, view.meId)
  const parentNote = useLiveQuery(
    () => (showParentPreview && note.parentId ? notesRepo.getByLocalId(note.parentId) : Promise.resolve(undefined)),
    [showParentPreview, note.parentId],
  ) as NoteRecord | undefined
  const activities = (useLiveQuery(
    () => (note.id ? activitiesRepo.listDecoratedForNote(note.id) : Promise.resolve([])),
    [note.id],
  ) as Array<{ valueRaw: string; _name: string; _valueType: string; id?: number; serverId?: number | null }>) || []

  // Authors matter only when other people write here too.
  const author = view.shared ? (note.authorName ?? view.meName ?? 'you') : null
  const editedBy = view.shared && note.modifiedByName && note.modifiedById != null && note.modifiedById !== note.authorId ? note.modifiedByName : null
  const hasReplies = Number.isFinite(repliesCount) && repliesCount > 0
  // The note on its own (showFullDate) is already open; in the feed a click anywhere on the card opens it.
  const openable = !!onOpenThread && !showFullDate
  const open = () => onOpenThread?.(note.id!)

  function openFromCard(e: MouseEvent<HTMLElement>) {
    if (!openable) return
    const target = e.target as HTMLElement
    // Clicks bubble here from portals too (menu, dialogs): only the card's own surface counts.
    if (!e.currentTarget.contains(target)) return
    if (target.closest('a, button, input, label, textarea, select, [role="button"], [role="tab"]')) return
    // Selecting text is not a click on the card.
    if (window.getSelection()?.toString()) return
    open()
  }

  return (
    <SurfaceNoPad className={`relative group ${openable ? 'note-card-openable' : ''}`} onClick={openFromCard}>
      {(pub.direct || pub.inherited) && (
        <div className="absolute right-2.5 top-2.5 z-20">
          <button
            type="button"
            className={`note-planet ${pub.direct ? '' : 'is-inherited'}`}
            aria-label={pub.direct ? 'Public note: link and settings' : 'Public as part of a shared thread'}
            title={pub.direct ? 'Public' : 'Public as a reply to a shared note'}
            onClick={(e) => { e.stopPropagation(); setDialog('share') }}
          >
            <PublicRoundedIcon fontSize="inherit" />
          </button>
        </div>
      )}
      <div className={`p-[var(--pad-surface)] min-w-0 space-y-3 ${pub.direct || pub.inherited ? 'pr-11' : ''}`}>
        {/* Reply preview (pill) */}
        {showParentPreview && note.parentId != null && parentNote && !parentNote.deletedAt && (
          <div className="min-w-0 max-w-full">
            <Pill
              className="w-full justify-start overflow-hidden text-left pill-reply-preview"
              onClick={() => onOpenThread && onOpenThread(parentNote.id!)}
              title={noteLabel(parentNote.text)}
            >
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{noteLabel(parentNote.text)}</span>
            </Pill>
          </div>
        )}

        {/* Images */}
        <NoteImages noteId={note.id!} />

        {/* Text */}
        <NoteBody className="text-primary" noteId={note.id} text={note.text} readOnly={!mayEdit} />

        {/* Documents */}
        <NoteFiles noteId={note.id!} mayEdit={mayEdit} />

        {/* Activities (pills) */}
        {activities.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activities.map((a, i) => (
              <Pill
                key={`${a.serverId ?? a.id}-${i}`}
                onClick={() => onActivityClick ? onActivityClick(a._name) : (onTagClick && onTagClick(a._name))}
                title={`${a._name}: ${a.valueRaw}`}
              >
                <span className="mr-2">{a._name}:</span>
                <span className="text-primary">{(() => {
                  if (a?._valueType === 'time') {
                    const numMs = Number(a.valueRaw)
                    if (Number.isFinite(numMs)) return formatDurationShort(numMs)
                    const parsed = parseDurationToMs(String(a.valueRaw))
                    if (Number.isFinite(parsed)) return formatDurationShort(parsed)
                  }
                  return a.valueRaw
                })()}</span>
              </Pill>
            ))}
          </div>
        )}

        {/* Tags (pills) */}
        {note.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {note.tags.filter(t => !(hiddenTags?.has(t))).map((t, i) => (
              <Pill
                key={`${t}-${i}`}
                className="pill-tag"
                onClick={() => onTagClick && onTagClick(t)}
                title={t}
              >
                {t}
              </Pill>
            ))}
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {hasReplies && (
              <button className="note-footer inline-flex items-baseline gap-2 text-primary hover:underline" type="button" onClick={open}>
                <SubdirectoryArrowRightRoundedIcon fontSize="inherit" className="icon-sm icon-shift-down-15 text-secondary" />
                <span>{repliesCount} {repliesCount === 1 ? 'reply' : 'replies'}</span>
              </button>
            )}
          </div>

          <div className="note-footer flex items-center gap-2 text-secondary min-w-0">
            {author && <span className="inline-flex items-center gap-1.5 min-w-0"><PersonAvatar userId={note.authorId ?? view.meId} name={author} size={16} /><span className="truncate">{author}</span></span>}
            {author && <span aria-hidden style={{ fontWeight: 700 }}>·</span>}
            {showFullDate
              ? <span>{formatExactDateTime(note.date ?? note.createdAt)}</span>
              : (
                <NoteDateTip note={note} extra={editedBy ? `Edited by ${editedBy}` : undefined} onClick={openable ? open : undefined}>
                  <span>{formatRelativeShort(note.createdAt)}</span>
                </NoteDateTip>
              )}
            {editedBy && <span className="truncate hidden sm:inline">· edited by {editedBy}</span>}
            <SyncMark pending={note.isDirty === 1} />

            {/* ⋮ sits in the footer row, after the date: it never covers the author or the date. */}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`note-more ${menuOpen ? 'is-open' : ''}`} aria-label="Open actions">
                  <MoreVertRoundedIcon fontSize="inherit" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onReplyClick && mayWrite && <DropdownMenuItem onSelect={() => onReplyClick()}>Reply</DropdownMenuItem>}
                {onEdit && mayEdit && <DropdownMenuItem onSelect={() => onEdit()}>Edit</DropdownMenuItem>}
                {onManageFolders && mayEdit && <DropdownMenuItem onSelect={() => onManageFolders()}>Folders…</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setDialog('share')}>Share…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog('details')}>Details</DropdownMenuItem>
                {onDelete && mayDelete && <DropdownMenuItem onSelect={() => onDelete()}>Delete</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {dialog === 'share' && <NoteShareDialog note={note} onClose={() => setDialog(null)} onOpenNote={onOpenThread} />}
      {dialog === 'details' && <NoteDetailsDialog note={note} onClose={() => setDialog(null)} />}
    </SurfaceNoPad>
  )
}


