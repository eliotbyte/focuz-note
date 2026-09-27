import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { db } from '../lib/db'
import type { NoteRecord } from '../lib/types'
import { canManage, canPublishNote } from '../lib/roles'
import { useSpaceView } from '../lib/space-context'
import { publicUrl, useNotePublicState } from '../lib/useSpaces'
import { errorText, setShareReplies, shareNote, unshare } from '../lib/spaces-api'
import { defaultServer, getServer } from '../lib/server'
import { notePreviewText } from '../lib/note-format/render'
import { notify } from '../ui/notify'
import { CopyField } from './spaces/SpaceSettingsDialog'

/** Publish a note (optionally with its replies), show its link, or make it private again. */
export default function NoteShareDialog({ note, onClose, onOpenNote }: { note: NoteRecord; onClose: () => void; onOpenNote?: (localId: number) => void }) {
  const view = useSpaceView()
  const state = useNotePublicState(note)
  const [includeReplies, setIncludeReplies] = useState(true)
  const [busy, setBusy] = useState(false)
  const root = useLiveQuery(async () => (state.inherited ? await db.notes.get(state.inherited.rootLocalId) : undefined), [state.inherited?.rootLocalId])
  const server = getServer()
  const mayPublish = canPublishNote(view.role, note.authorId, view.meId)
  const mayChange = (authorId: number | null | undefined, createdBy?: number) =>
    canManage(view.role) || canPublishNote(view.role, authorId, view.meId) || (createdBy != null && createdBy === view.meId)

  async function run(f: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try { await f(); if (done) notify(done, 'success') } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }

  let body: React.ReactNode
  if (state.direct) {
    const s = state.direct
    const can = mayChange(note.authorId, s.createdBy)
    body = (
      <>
        <div className="share-status is-public"><PublicRoundedIcon fontSize="inherit" /> Public: anyone with the link can read {s.includeReplies ? 'this note and its replies' : 'this note'}.</div>
        <CopyField value={publicUrl(s.token, server, defaultServer())} label="Public link" />
        {can && (
          <>
            <label className="settings-switch">
              <input type="checkbox" role="switch" checked={s.includeReplies} disabled={busy}
                onChange={e => { const on = e.target.checked; void run(() => setShareReplies(s.token, on), on ? 'Replies are public too' : 'Replies are private now') }} />
              <span><b>Replies are public too</b><small>All replies below this note, including ones written later.</small></span>
            </label>
            <div className="flex justify-end">
              <button type="button" className="button button-danger" disabled={busy} onClick={() => { void run(() => unshare(s.token), 'The note is private again').then(onClose) }}>
                Make private
              </button>
            </div>
          </>
        )}
      </>
    )
  } else if (state.inherited) {
    const s = state.inherited.share
    const can = mayChange(root?.authorId, s.createdBy)
    body = (
      <>
        <div className="share-status is-public"><PublicRoundedIcon fontSize="inherit" /> Public as a reply to a shared note:</div>
        <button type="button" className="share-root" onClick={() => { if (root?.id && onOpenNote) { onOpenNote(root.id); onClose() } }}>
          {root ? notePreviewText(root.text).slice(0, 120) : 'Shared note'}
        </button>
        <CopyField value={publicUrl(s.token, server, defaultServer())} label="Public link" />
        {can ? (
          <div className="flex justify-end">
            <button type="button" className="button button-danger" disabled={busy} onClick={() => { void run(() => setShareReplies(s.token, false), 'Replies are private now').then(onClose) }}>
              Make all replies private
            </button>
          </div>
        ) : <p className="settings-note">Whoever shared that note can make its replies private.</p>}
      </>
    )
  } else if (!note.serverId) {
    body = <p className="settings-note">This note is not on the server yet. It can be shared once it syncs.</p>
  } else if (!mayPublish) {
    body = <p className="settings-note">{view.role === 'guest' ? 'Guests can’t publish notes.' : 'You can publish only your own notes in this space. Ask an admin.'}</p>
  } else {
    body = (
      <>
        <div className="share-status"><LockRoundedIcon fontSize="inherit" /> Private: only {view.shared ? 'members of this space' : 'you'} can see it.</div>
        <label className="settings-switch">
          <input type="checkbox" role="switch" checked={includeReplies} onChange={e => setIncludeReplies(e.target.checked)} />
          <span><b>Replies are public too</b><small>All replies below this note, including ones written later. Turn off to share only this note.</small></span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="filter-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="button" disabled={busy} onClick={() => { void run(() => shareNote(note.spaceId, note.serverId!, includeReplies), 'Anyone with the link can read it now') }}>
            <PublicRoundedIcon fontSize="inherit" className="icon-sm" /> Make public
          </button>
        </div>
      </>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4">
        <DialogTitle className="!text-primary !text-[17px] font-semibold">Share note</DialogTitle>
        <DialogDescription className="text-sm truncate">{notePreviewText(note.text).slice(0, 120)}</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  )
}
