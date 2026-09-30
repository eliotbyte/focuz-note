import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord } from '../lib/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { notes as notesRepo } from '../data'
import { deleteFolder, planFolderDelete, setNoteInFolder } from '../lib/folder-actions'
import { descendantIds, folderKind, matchesRule, tagsForFolder, type FolderIndex } from '../lib/folders'
import { notePreviewText } from '../lib/note-format/render'
import type { FilterTreeNode } from '../lib/filter-tree'
import { FolderIcon } from './FolderIcon'

function flatten(roots: FilterTreeNode[]): FilterTreeNode[] {
  const out: FilterTreeNode[] = []
  const walk = (n: FilterTreeNode) => { out.push(n); n.children.forEach(walk) }
  roots.forEach(walk)
  return out
}

export function MoveFolderDialog({ index, folderId, onClose, onMove }: {
  index: FolderIndex
  folderId: number
  onClose: () => void
  onMove: (parentId: number | null) => void
}) {
  const node = index.nodes.get(folderId)
  const blocked = useMemo(() => new Set([folderId, ...descendantIds(index, folderId)]), [index, folderId])
  const currentParent = node?.ancestors.length ? node.ancestors[node.ancestors.length - 1] : null
  const targets = flatten(index.roots).filter(n => !blocked.has(n.id))
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-3">
        <DialogTitle>Move “{node?.rec.name}”</DialogTitle>
        <DialogDescription className="text-sm">What the folder shows stays the same; only its place in the list changes.</DialogDescription>
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-0.5" role="listbox" aria-label="New place">
          <button type="button" role="option" aria-selected={currentParent === null} disabled={currentParent === null}
            className="folder-pick" onClick={() => onMove(null)}>
            <span className="flex-1">Top level</span>
            {currentParent === null && <span className="text-xs text-secondary">current</span>}
          </button>
          {targets.map(n => (
            <button key={n.id} type="button" role="option" aria-selected={currentParent === n.id} disabled={currentParent === n.id}
              className="folder-pick" style={{ paddingLeft: 10 + n.depth * 14 }} onClick={() => onMove(n.id)}>
              <FolderIcon kind={folderKind(index.rules.get(n.id)!)} className="shrink-0 text-secondary" />
              <span className="flex-1 truncate">{n.rec.name}</span>
              {currentParent === n.id && <span className="text-xs text-secondary">current</span>}
            </button>
          ))}
        </div>
        <div className="flex justify-end"><button type="button" className="filter-btn" onClick={onClose}>Cancel</button></div>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteFolderDialog({ index, folderId, onClose, onDeleted }: {
  index: FolderIndex
  folderId: number
  onClose: () => void
  onDeleted: (removedIds: number[], undo: () => Promise<void>, message: string) => void
}) {
  const node = index.nodes.get(folderId)
  const [withSubfolders, setWithSubfolders] = useState(false)
  const [deleteNotes, setDeleteNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const plan = planFolderDelete(index, folderId, withSubfolders)
  const orphanNotes = useLiveQuery(async () => {
    const list = await Promise.all(plan.orphans.slice(0, 3).map(id => notesRepo.getByLocalId(id)))
    return list.filter(Boolean) as NoteRecord[]
  }, [plan.orphans.join(',')]) ?? []
  if (!node) return null
  const subNames = node.children.map(c => c.rec.name)
  const elsewhere = plan.notesShown - plan.orphans.length
  const canDeleteNotes = plan.orphans.length > 0

  async function confirm() {
    setBusy(true)
    const removedIds = [folderId, ...(withSubfolders ? descendantIds(index, folderId) : [])]
    const res = await deleteFolder(index, folderId, { withSubfolders, deleteNotes: deleteNotes && canDeleteNotes })
    const what = removedIds.length > 1 ? `${removedIds.length} folders deleted` : 'Folder deleted'
    const message = res.deletedNotes > 0 ? `${what} with ${res.deletedNotes} note${res.deletedNotes === 1 ? '' : 's'}` : `${what}. Notes are kept`
    onDeleted(removedIds, res.undo, message)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4" aria-describedby="delete-folder-desc">
        <DialogTitle className="!text-primary">Delete “{node.rec.name}”?</DialogTitle>
        <p id="delete-folder-desc" className="text-sm text-secondary leading-relaxed">
          Notes are not deleted with the folder: they stay in All notes and in other folders.
          {plan.notesShown > 0 && <> This folder shows {plan.notesShown} note{plan.notesShown === 1 ? '' : 's'}{elsewhere > 0 ? `, ${elsewhere} of them also in other folders` : ''}.</>}
        </p>
        {plan.subfolders > 0 && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Subfolders</legend>
            <label className="folder-choice">
              <input type="radio" name="subfolders" checked={!withSubfolders} onChange={() => { setWithSubfolders(false); setDeleteNotes(false) }} />
              <span>Keep subfolders<small>{subNames.join(', ')} move up one level</small></span>
            </label>
            <label className="folder-choice">
              <input type="radio" name="subfolders" checked={withSubfolders} onChange={() => { setWithSubfolders(true); setDeleteNotes(false) }} />
              <span>Delete subfolders too<small>{plan.subfolders} folder{plan.subfolders === 1 ? '' : 's'} inside</small></span>
            </label>
          </fieldset>
        )}
        <label className={`folder-choice ${canDeleteNotes ? '' : 'opacity-60'}`}>
          <input type="checkbox" checked={deleteNotes && canDeleteNotes} disabled={!canDeleteNotes} onChange={e => setDeleteNotes(e.target.checked)} />
          <span>
            {canDeleteNotes
              ? `Also delete ${plan.orphans.length} note${plan.orphans.length === 1 ? '' : 's'} that would be in no folder`
              : 'Also delete notes that would be in no folder'}
            <small>
              {canDeleteNotes
                ? orphanNotes.map(n => `“${notePreviewText(n.text).slice(0, 32)}”`).join(', ') + (plan.orphans.length > 3 ? ` and ${plan.orphans.length - 3} more` : '')
                : 'There are none: every note here is also in another folder.'}
            </small>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="filter-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="button button-danger" disabled={busy} onClick={() => { void confirm() }}>Delete</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Tick the folders a note belongs to. Tag-based folders only; smart folders and groups fill themselves. */
export function NoteFoldersDialog({ index, note, onClose }: { index: FolderIndex | undefined; note: NoteRecord; onClose: () => void }) {
  const live = useLiveQuery(() => notesRepo.getByLocalId(note.id!), [note.id]) ?? note
  const rows = index ? flatten(index.roots) : []
  // Show the tick right away; the saved tags catch up a moment later.
  const [pending, setPending] = useState<Map<number, boolean>>(new Map())
  const tagsKey = (live.tags || []).join('\u0000')
  useEffect(() => { setPending(new Map()) }, [tagsKey])
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-3" aria-describedby="note-folders-desc">
        <DialogTitle>Folders</DialogTitle>
        <p id="note-folders-desc" className="text-sm text-secondary">
          Ticking a folder adds its tags to the note. Smart folders pick notes by their rule.
        </p>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 space-y-0.5" role="group" aria-label="Folders">
          {rows.length === 0 && <div className="text-sm text-secondary py-2">No folders yet.</div>}
          {rows.map(n => {
            const rule = index!.rules.get(n.id)!
            const kind = folderKind(rule)
            const tags = tagsForFolder(rule)
            const inFolder = kind === 'group' ? (index!.deep.get(n.id)?.has(live.id!) ?? false) : matchesRule(live, rule)
            // Adding the tags is not enough when the note carries a tag the folder excludes.
            const blockedBy = tags && !inFolder ? rule.excludeTags.find(t => (live.tags || []).includes(t)) : undefined
            const disabled = !tags || !!blockedBy || (rule.notReply && live.parentId != null)
            const hint = kind === 'group' ? 'group' : kind === 'smart' ? 'by rule' : blockedBy ? `has #${blockedBy}` : ''
            return (
              <label key={n.id} className={`folder-pick ${disabled ? 'is-disabled' : ''}`} style={{ paddingLeft: 10 + n.depth * 14 }}>
                <input
                  type="checkbox"
                  checked={pending.get(n.id) ?? inFolder}
                  disabled={disabled}
                  onChange={e => {
                    const on = e.target.checked
                    setPending(prev => new Map(prev).set(n.id, on))
                    void setNoteInFolder(live.id!, live.tags || [], rule, on)
                  }}
                />
                <FolderIcon kind={kind} className="shrink-0 text-secondary" />
                <span className="flex-1 truncate">{n.rec.name}</span>
                {tags && !hint && <span className="text-xs text-secondary truncate max-w-[40%]">{tags.map(t => `#${t}`).join(' ')}</span>}
                {hint && <span className="text-xs text-secondary">{hint}</span>}
              </label>
            )
          })}
        </div>
        <div className="flex justify-end"><button type="button" className="button" onClick={onClose}>Done</button></div>
      </DialogContent>
    </Dialog>
  )
}
