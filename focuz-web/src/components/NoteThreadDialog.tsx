import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord, PublicShare } from '../lib/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { notes as notesRepo } from '../data'
import { getKV } from '../lib/db'
import { SHARES_KV } from '../lib/sync-pull'
import { moveToThread } from '../lib/thread-moves'
import { searchNotes } from '../lib/search'
import { noteLabel } from '../lib/note-format/render'
import { formatRelativeShort } from '../lib/time'
import { ownThread, repliesPublicBelow } from '../lib/note-threads'
import { useSpaceView } from '../lib/space-context'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'

/** How many recent notes the list shows before anything is typed. */
const RECENT = 30

/** ⋮ → Move to thread…: pick the note this one replies to, or none. A pick moves it at once (Undo in the toast). */
export default function NoteThreadDialog({ note, onClose }: { note: NoteRecord; onClose: () => void }) {
  const view = useSpaceView()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<number[] | null>(null)
  const all = useLiveQuery(() => notesRepo.listActiveBySpace(note.spaceId), [note.spaceId])
  const shares = useLiveQuery(async () => {
    const list = (await getKV<PublicShare[]>(SHARES_KV, [])) ?? []
    const byServer = new Map<number, boolean>()
    for (const s of list) if (s.noteId != null) byServer.set(s.noteId, !!s.includeReplies)
    return byServer
  }, [])

  useEffect(() => {
    if (!q.trim()) { setFound(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      searchNotes(note.spaceId, q).then(ids => { if (!cancelled) setFound(ids) }).catch(() => { if (!cancelled) setFound([]) })
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, note.spaceId])

  const model = useMemo(() => {
    if (!all) return null
    const byId = new Map(all.map(n => [n.id!, n]))
    const own = ownThread(all, note.id!)
    const sharedLocal = new Map<number, boolean>()
    if (shares) for (const n of all) if (n.serverId != null && shares.has(n.serverId)) sharedLocal.set(n.id!, shares.get(n.serverId)!)
    const replies = new Map<number, number>()
    for (const n of all) if (n.parentId != null) replies.set(n.parentId, (replies.get(n.parentId) ?? 0) + 1)
    return { byId, own, sharedLocal, replies }
  }, [all, shares, note.id])

  if (!model) return null
  const current = note.parentId ?? null
  const publicNow = repliesPublicBelow(model.byId, current, model.sharedLocal)
  const moving = model.own.size - 1
  const searching = found !== null
  const rows: NoteRecord[] = searching
    ? found!.map(id => model.byId.get(id)).filter((n): n is NoteRecord => !!n && n.id !== note.id)
    : (all ?? [])
      .filter(n => n.id !== note.id && n.id !== current)
      .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt))
      .slice(0, RECENT)
  const currentNote = current != null ? model.byId.get(current) : undefined
  if (!searching && currentNote) rows.unshift(currentNote)

  function pick(parent: NoteRecord | null) {
    onClose()
    void moveToThread(note, parent?.id ?? null, parent ? `Moved to “${noteLabel(parent.text)}”` : 'Detached from thread')
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-3">
        <DialogTitle>Move to thread</DialogTitle>
        <DialogDescription className="text-sm">
          Pick the note “{noteLabel(note.text)}” will reply to.
          {moving > 0 && ` Its ${moving} ${moving === 1 ? 'reply moves' : 'replies move'} with it.`}
          {publicNow && ' It is public now as part of a shared thread; in another thread it may not be.'}
        </DialogDescription>
        <input
          className="input w-full"
          placeholder="Find a note"
          aria-label="Find a note"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-0.5" role="listbox" aria-label="Note to reply to">
          {current != null && !searching && (
            <button type="button" role="option" aria-selected={false} className="folder-pick" onClick={() => pick(null)}>
              <span className="flex-1">No thread: a note of its own</span>
            </button>
          )}
          {rows.length === 0 && <div className="text-sm text-secondary py-2 px-2.5">{searching ? 'No notes match.' : 'No other notes in this space.'}</div>}
          {rows.map(n => {
            const isCurrent = n.id === current
            const inOwn = model.own.has(n.id!)
            const count = model.replies.get(n.id!) ?? 0
            const goesPublic = !isCurrent && !inOwn && repliesPublicBelow(model.byId, n.id!, model.sharedLocal)
            return (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                disabled={isCurrent || inOwn}
                className="folder-pick thread-pick"
                onClick={() => pick(n)}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{noteLabel(n.text)}</span>
                  <span className="thread-pick-meta">
                    {formatRelativeShort(n.date ?? n.createdAt)}
                    {view.shared && n.authorName ? ` · ${n.authorName}` : ''}
                    {count > 0 ? ` · ${count} ${count === 1 ? 'reply' : 'replies'}` : ''}
                    {inOwn ? ' · its own reply' : ''}
                  </span>
                </span>
                {goesPublic && <span className="thread-pick-public" title="Replies here are public"><PublicRoundedIcon fontSize="inherit" /><span className="sr-only">Public thread</span></span>}
                {isCurrent && <span className="text-xs text-secondary shrink-0">current</span>}
              </button>
            )
          })}
        </div>
        <div className="flex justify-end"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button></div>
      </DialogContent>
    </Dialog>
  )
}
