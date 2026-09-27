import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { PersonAvatar } from './ui/avatar'
import type { NoteRecord } from '../lib/types'
import { errorText, fetchNoteHistory, type NoteHistory } from '../lib/spaces-api'
import { useSpaceView } from '../lib/space-context'
import { formatAgo, formatExactDateTime } from '../lib/time'

const ACTION: Record<string, string> = { created: 'created it', edited: 'edited', deleted: 'deleted', restored: 'restored' }

/** Who wrote a note, who changed it and when. */
export default function NoteDetailsDialog({ note, onClose }: { note: NoteRecord; onClose: () => void }) {
  const view = useSpaceView()
  const [history, setHistory] = useState<NoteHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!note.serverId) return
    fetchNoteHistory(note.serverId).then(setHistory).catch(e => setError(errorText(e, 'Could not load the history')))
  }, [note.serverId])
  const author = history?.createdBy ?? note.authorName ?? view.meName ?? 'You'
  const editor = history?.modifiedBy ?? note.modifiedByName ?? author
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4">
        <DialogTitle className="!text-primary !text-[17px] font-semibold">Details</DialogTitle>
        <DialogDescription className="sr-only">Author and edit history</DialogDescription>
        <dl className="settings-dl text-sm">
          <dt>Created</dt>
          <dd><span className="inline-flex items-center gap-2"><PersonAvatar name={author} size={20} />{author}</span><span className="block text-xs text-secondary">{formatExactDateTime(history?.createdAt ?? note.createdAt)}</span></dd>
          <dt>Last change</dt>
          <dd><span className="inline-flex items-center gap-2"><PersonAvatar name={editor} size={20} />{editor}</span><span className="block text-xs text-secondary">{formatExactDateTime(history?.modifiedAt ?? note.modifiedAt)}</span></dd>
        </dl>
        {!note.serverId && <p className="settings-note">Not synced yet: the history appears once the note is on the server.</p>}
        {error && <p className="settings-note">{error}</p>}
        {history && history.edits.length > 0 && (
          <section aria-label="History">
            <div className="settings-label mb-1">History</div>
            <ol className="history-list">
              {history.edits.map((e, i) => (
                <li key={i} title={formatExactDateTime(e.at)}>
                  <PersonAvatar name={e.username} size={20} />
                  <span className="flex-1 min-w-0 truncate"><b>{e.username}</b> {ACTION[e.action] ?? e.action}</span>
                  <span className="text-xs text-secondary shrink-0">{formatAgo(e.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
