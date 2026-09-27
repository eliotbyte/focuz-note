import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord } from '../lib/types'
import { activities as activitiesRepo, notes as notesRepo } from '../data'
import { getLastUsername } from '../lib/sync'
import { useAppState } from '../lib/app-state'
// import HighlightedText from './HighlightedText'
import NoteBody from './NoteBody'
import { notePreviewText } from '../lib/note-format/render'
import NoteImages from './NoteImages'
import { formatExactDateTime, formatRelativeShort, formatDurationShort, parseDurationToMs } from '../lib/time'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Pill } from './ui/pill'
import { SurfaceNoPad } from './ui/surface'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'

export default function NoteCard({
  note,
  onEdit,
  onDelete,
  onOpenThread,
  showParentPreview = false,
  onTagClick,
  onActivityClick,
  hiddenTags,
  repliesCount = 0,
  onReplyClick,
}: {
  note: NoteRecord
  onEdit?: () => void
  onDelete?: () => void
  onOpenThread?: (nid: number) => void
  showParentPreview?: boolean
  onTagClick?: (tag: string) => void
  onActivityClick?: (name: string) => void
  hiddenTags?: Set<string>
  repliesCount?: number
  onReplyClick?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const syncing = useAppState(s => s.syncing)
  const parentNote = useLiveQuery(
    () => (showParentPreview && note.parentId ? notesRepo.getByLocalId(note.parentId) : Promise.resolve(undefined)),
    [showParentPreview, note.parentId],
  ) as NoteRecord | undefined
  const activities = (useLiveQuery(
    () => (note.id ? activitiesRepo.listDecoratedForNote(note.id) : Promise.resolve([])),
    [note.id],
  ) as Array<{ valueRaw: string; _name: string; _valueType: string; id?: number; serverId?: number | null }>) || []

  const author = getLastUsername() || 'me'
  const hasReplies = Number.isFinite(repliesCount) && repliesCount > 0
  // Sync status rules:
  // - Done: created/edited locally but not yet synced (no serverId or isDirty=1)
  // - DoneAll: synced at least once successfully (serverId exists and isDirty=0), regardless of current network/server availability
  const isSynced = note.serverId != null && note.isDirty === 0
  const syncStage: 'pending' | 'syncing' | 'synced' = isSynced ? (syncing ? 'syncing' : 'synced') : 'pending'

  return (
    <SurfaceNoPad className="relative group">
      <div className="p-[var(--pad-surface)] min-w-0 space-y-3">
        {/* Reply preview (pill) */}
        {showParentPreview && note.parentId != null && parentNote && !parentNote.deletedAt && (
          <div className="min-w-0 max-w-full">
            <Pill
              className="w-full justify-start overflow-hidden text-left pill-reply-preview"
              onClick={() => onOpenThread && onOpenThread(parentNote.id!)}
              title={notePreviewText(parentNote.text)}
            >
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{notePreviewText(parentNote.text)}</span>
            </Pill>
          </div>
        )}

        {/* Images */}
        <NoteImages noteId={note.id!} />

        {/* Text */}
        <NoteBody className="text-primary" noteId={note.id} text={note.text} />

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
          <div className="relative z-20 flex flex-wrap gap-1.5">
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
        <div className="relative z-0 flex items-baseline justify-between">
          <div className="min-w-0">
            {hasReplies && (
              <button className="note-footer inline-flex items-baseline gap-2 text-primary hover:underline" type="button" onClick={() => onOpenThread && onOpenThread(note.id!)}>
                <SubdirectoryArrowRightRoundedIcon fontSize="inherit" className="icon-sm icon-shift-down-15 text-secondary" />
                <span>{repliesCount} {repliesCount === 1 ? 'reply' : 'replies'}</span>
              </button>
            )}
          </div>

          <div className="note-footer flex items-baseline gap-2 text-secondary" title={formatExactDateTime(note.createdAt)}>
            <span className="truncate">{author}</span>
            <span aria-hidden style={{ fontWeight: 700 }}>·</span>
            <span>{formatRelativeShort(note.createdAt)}</span>
            <span aria-label={syncStage === 'pending' ? 'Not synced yet' : syncStage === 'syncing' ? 'Syncing' : 'Synced'}>
              {syncStage === 'pending'
                ? <DoneRoundedIcon fontSize="inherit" className="icon-sm text-secondary" />
                : syncStage === 'syncing'
                  ? <DoneRoundedIcon fontSize="inherit" className="icon-sm text-secondary" />
                  : <DoneAllRoundedIcon fontSize="inherit" className="icon-sm text-secondary" />}
            </span>
          </div>
        </div>
      </div>

      {/* Hover overlay: blocks footer actions, tags remain clickable (higher z-index) */}
      {onOpenThread && (
        <div
          className={[
            'absolute inset-x-0 bottom-0 z-10 h-[64px] transition-opacity',
            (menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'),
          ].join(' ')}
          style={{
            background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)',
            backdropFilter: 'blur(2px)',
            borderBottomLeftRadius: 'var(--radius)',
            borderBottomRightRadius: 'var(--radius)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 55%, black 100%)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 55%, black 100%)',
          }}
        >
          {/* click-anywhere area to open note */}
          <button
            type="button"
            className="absolute inset-0 w-full h-full"
            onClick={() => onOpenThread(note.id!)}
            aria-label="Open note"
          />

          {/* menu trigger (the circle) */}
          <div className="absolute right-3 bottom-2.5 z-20">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center justify-center w-8 h-8 rounded-full"
                  style={{
                    background: 'rgb(var(--c-surface))',
                    boxShadow: '0 0 8px 8px rgb(var(--c-surface) / 0.85)',
                  }}
                  aria-label="Open actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⋮
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {onReplyClick && <DropdownMenuItem onSelect={() => onReplyClick()}>Reply</DropdownMenuItem>}
                {onEdit && <DropdownMenuItem onSelect={() => onEdit()}>Edit</DropdownMenuItem>}
                {onDelete && <DropdownMenuItem onSelect={() => onDelete()}>Delete</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

    </SurfaceNoPad>
  )
}


