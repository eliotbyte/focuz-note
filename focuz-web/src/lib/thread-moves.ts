// Moving a note between threads from the UI: a local write, then a toast with Undo.
import type { NoteRecord } from './types'
import { setNoteParentLocal } from './local-writes'
import { notify, notifyUndoable } from '../ui/notify'

export async function moveToThread(note: NoteRecord, parentId: number | null, message: string) {
  const before = note.parentId ?? null
  if (!(await setNoteParentLocal(note.id!, parentId))) {
    notify('A note can’t reply to itself or to one of its replies', 'warning')
    return
  }
  notifyUndoable(message, { label: 'Undo', onClick: () => { void setNoteParentLocal(note.id!, before) } })
}

/** ⋮ → Detach from thread: the reply becomes a note of its own. */
export function detachFromThread(note: NoteRecord) {
  return moveToThread(note, null, 'Detached from thread')
}
