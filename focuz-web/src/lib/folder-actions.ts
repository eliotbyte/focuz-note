// Local writes for folders (saved filters). Everything goes through the normal sync queue.
import { db } from './db'
import type { FilterParams, FilterRecord } from './types'
import { createFilterLocal, deleteNote, updateFilterLocal, updateNoteLocal } from './local-writes'
import { notes as notesRepo } from '../data'
import type { FilterTreeNode } from './filter-tree'
import { descendantIds, orphansAfterDelete, ruleToParams, tagsForFolder, type FolderIndex, type FolderRule } from './folders'

function emit() { try { window.dispatchEvent(new Event('focuz:local-write')) } catch {} }

function nextOrder(siblings: FilterTreeNode[]): number {
  let max = 0
  for (const s of siblings) {
    const o = (s.rec.params as any)?._order
    if (typeof o === 'number' && o > max) max = o
  }
  return max + 10
}

/** How a record points at its parent: by server id, or by client id until the parent is synced. */
function parentLink(parent: FilterTreeNode | null): { parentId: number | null; parentClientId: string | undefined } {
  if (!parent) return { parentId: null, parentClientId: undefined }
  if (parent.serverId != null) return { parentId: parent.serverId, parentClientId: undefined }
  return { parentId: null, parentClientId: parent.clientId || undefined }
}

export async function createFolder(
  spaceId: number,
  index: FolderIndex,
  name: string,
  rule: FolderRule,
  parentLocalId: number | null,
  extra: Partial<FilterParams> = {},
): Promise<number> {
  const parent = parentLocalId != null ? index.nodes.get(parentLocalId) ?? null : null
  const siblings = parent ? parent.children : index.roots
  const link = parentLink(parent)
  const params: any = ruleToParams(rule, { ...extra, _order: nextOrder(siblings) } as any)
  if (link.parentClientId) params._parentClientId = link.parentClientId
  return createFilterLocal(spaceId, name.trim(), params, link.parentId)
}

export async function renameFolder(localId: number, name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  await updateFilterLocal(localId, { name: n })
}

export async function saveFolderRule(localId: number, rule: FolderRule): Promise<void> {
  const rec = await db.filters.get(localId)
  if (!rec) return
  await updateFilterLocal(localId, { params: ruleToParams(rule, rec.params) })
}

/** Moves a folder under another one (or to the top level), at the end. Its content does not change. */
export async function moveFolder(index: FolderIndex, localId: number, newParentLocalId: number | null): Promise<void> {
  const node = index.nodes.get(localId)
  if (!node) return
  if (newParentLocalId != null && (newParentLocalId === localId || descendantIds(index, localId).includes(newParentLocalId))) return
  const parent = newParentLocalId != null ? index.nodes.get(newParentLocalId) ?? null : null
  await setParent(node.rec, parent, nextOrder((parent ? parent.children : index.roots).filter(n => n.id !== localId)))
}

async function setParent(rec: FilterRecord, parent: FilterTreeNode | null, order?: number) {
  const link = parentLink(parent)
  const params: any = { ...(rec.params as any) }
  delete params._parentClientId
  if (link.parentClientId) params._parentClientId = link.parentClientId
  if (order != null) params._order = order
  await db.filters.update(rec.id!, { parentId: link.parentId, params, modifiedAt: new Date().toISOString(), isDirty: 1 })
}

export interface DeletePlan {
  subfolders: number
  notesShown: number
  /** Notes that would end up in no folder at all; only these may be deleted along with it. */
  orphans: number[]
}

export function planFolderDelete(index: FolderIndex, localId: number, withSubfolders: boolean): DeletePlan {
  return {
    subfolders: descendantIds(index, localId).length,
    notesShown: index.deep.get(localId)?.size ?? 0,
    orphans: orphansAfterDelete(index, localId, withSubfolders),
  }
}

/** Deletes a folder. Returns an undo function that puts everything back. */
export async function deleteFolder(
  index: FolderIndex,
  localId: number,
  opts: { withSubfolders: boolean; deleteNotes: boolean },
): Promise<{ undo: () => Promise<void>; deletedNotes: number }> {
  const node = index.nodes.get(localId)
  if (!node) return { undo: async () => {}, deletedNotes: 0 }
  const removed = [localId, ...(opts.withSubfolders ? descendantIds(index, localId) : [])]
  const orphans = opts.deleteNotes ? orphansAfterDelete(index, localId, opts.withSubfolders) : []
  const parent = node.ancestors.length ? index.nodes.get(node.ancestors[node.ancestors.length - 1]) ?? null : null
  const lifted = opts.withSubfolders ? [] : node.children.map(ch => ({ id: ch.id, parentId: ch.rec.parentId ?? null, params: ch.rec.params }))

  const now = new Date().toISOString()
  await db.transaction('rw', db.filters, async () => {
    // Subfolders take the deleted folder's place, after its current siblings.
    let order = nextOrder((parent ? parent.children : index.roots).filter(n => n.id !== localId))
    for (const ch of opts.withSubfolders ? [] : node.children) { await setParent(ch.rec, parent, order); order += 10 }
    for (const id of removed) await db.filters.update(id, { deletedAt: now, modifiedAt: now, isDirty: 1 })
  })
  for (const id of orphans) await deleteNote(id)
  emit()

  return {
    deletedNotes: orphans.length,
    undo: async () => {
      const t = new Date().toISOString()
      await db.transaction('rw', db.filters, async () => {
        for (const id of removed) await db.filters.update(id, { deletedAt: null, modifiedAt: t, isDirty: 1 })
        for (const l of lifted) await db.filters.update(l.id, { parentId: l.parentId, params: l.params, modifiedAt: t, isDirty: 1 })
      })
      for (const id of orphans) await notesRepo.restoreDeleted(id)
      emit()
    },
  }
}

/** Puts a note into a tag-based folder (adds the folder's tags) or takes it out (removes them). */
export async function setNoteInFolder(noteId: number, noteTags: string[], rule: FolderRule, inFolder: boolean): Promise<void> {
  const tags = tagsForFolder(rule)
  if (!tags) return
  const next = inFolder
    ? Array.from(new Set([...noteTags, ...tags]))
    : noteTags.filter(t => !tags.includes(t))
  await updateNoteLocal(noteId, { tags: next })
}
