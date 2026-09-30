import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InboxRoundedIcon from '@mui/icons-material/InboxRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import { db } from '../lib/db'
import { notifyUndoable } from '../ui/notify'
import { EMPTY_RULE, folderKind, slugTag, type FolderIndex } from '../lib/folders'
import { FolderIcon } from './FolderIcon'
import { flattenVisible } from '../lib/filter-tree'
import { createFolder, moveFolder, renameFolder } from '../lib/folder-actions'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { DeleteFolderDialog, FolderLookDialog, MoveFolderDialog } from './FolderDialogs'
import { lookFromParams } from '../lib/folder-look'

export type FeedView = { kind: 'all' } | { kind: 'unsorted' } | { kind: 'folder'; id: number }

const INDENT_PX = 14

function storageKey(spaceId: number) {
  return `focuz:filters:expanded:${spaceId}`
}

function readExpanded(spaceId: number): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(spaceId))
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === 'number') : [])
  } catch {
    return new Set()
  }
}

/** Expanded branches, remembered per space on this device. Collapsed is the default. */
function useExpandedState(spaceId: number) {
  const [expanded, setExpanded] = useState<Set<number>>(() => readExpanded(spaceId))
  useEffect(() => { setExpanded(readExpanded(spaceId)) }, [spaceId])
  const update = (fn: (prev: Set<number>) => Set<number>) => {
    setExpanded(prev => {
      const next = fn(prev)
      try { localStorage.setItem(storageKey(spaceId), JSON.stringify([...next])) } catch {}
      return next
    })
  }
  return [expanded, update] as const
}

export default function FolderTree({
  spaceId,
  index,
  view,
  onSelect,
  onEditRule,
  header,
}: {
  spaceId: number
  index: FolderIndex | undefined
  view: FeedView
  onSelect: (view: FeedView) => void
  onEditRule: (folderId: number) => void
  /** Shown above the list (the space name and menu). */
  header?: ReactNode
}) {
  const [expanded, setExpanded] = useExpandedState(spaceId)
  const [creating, setCreating] = useState<{ parent: number | null } | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [moving, setMoving] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [styling, setStyling] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropOver, setDropOver] = useState<{ id: number; pos: 'before' | 'after' | 'inside' } | null>(null)

  const roots = useMemo(() => index?.roots ?? [], [index])
  const nodes = index?.nodes
  const visible = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])
  const selectedId = view.kind === 'folder' ? view.id : null

  // Keep the selected folder visible (e.g. opened from a URL inside a collapsed branch).
  useEffect(() => {
    if (!selectedId || !nodes) return
    const node = nodes.get(selectedId)
    if (!node) return
    const missing = node.ancestors.filter(a => !expanded.has(a))
    if (missing.length) setExpanded(prev => new Set([...prev, ...missing]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, nodes])

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function create(name: string, withTag: boolean) {
    if (!index) return
    const parent = creating?.parent ?? null
    setCreating(null)
    const rule = withTag ? { ...EMPTY_RULE, includeTags: [slugTag(name)] } : EMPTY_RULE
    const id = await createFolder(spaceId, index, name, rule, parent)
    if (parent != null) setExpanded(prev => new Set([...prev, parent]))
    onSelect({ kind: 'folder', id })
  }

  async function reorder(dragLocalId: number, targetLocalId: number, pos: 'before' | 'after' | 'inside') {
    if (!index || !nodes) return
    const drag = nodes.get(dragLocalId)
    const target = nodes.get(targetLocalId)
    if (!drag || !target || dragLocalId === targetLocalId) return
    if (target.ancestors.includes(dragLocalId)) return // no dropping into own subtree
    if (pos === 'inside') {
      await moveFolder(index, dragLocalId, targetLocalId)
      setExpanded(prev => new Set([...prev, targetLocalId]))
      return
    }
    const parentId = target.ancestors.length ? target.ancestors[target.ancestors.length - 1] : null
    const parent = parentId != null ? nodes.get(parentId) : undefined
    const siblings = (parent ? parent.children : roots).filter(n => n.id !== dragLocalId)
    const at = siblings.findIndex(n => n.id === targetLocalId) + (pos === 'after' ? 1 : 0)
    const ordered = [...siblings]
    ordered.splice(Math.max(0, at), 0, drag)
    const currentParent = drag.ancestors.length ? drag.ancestors[drag.ancestors.length - 1] : null
    if (currentParent !== parentId) await moveFolder(index, dragLocalId, parentId)
    const now = new Date().toISOString()
    await db.transaction('rw', db.filters, async () => {
      for (let i = 0; i < ordered.length; i++) {
        const rec = await db.filters.get(ordered[i].id)
        if (!rec) continue
        await db.filters.update(rec.id!, { params: { ...(rec.params as any), _order: (i + 1) * 10 }, modifiedAt: now, isDirty: 1 })
      }
    })
    window.dispatchEvent(new Event('focuz:local-write'))
  }

  function onDragOver(e: React.DragEvent, id: number) {
    if (dragId == null) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const pos: 'before' | 'after' | 'inside' = y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'inside'
    setDropOver({ id, pos })
  }
  async function onDrop(e: React.DragEvent, id: number) {
    e.preventDefault()
    const d = dropOver
    const drag = dragId
    setDropOver(null)
    setDragId(null)
    if (drag == null || !d || d.id !== id) return
    await reorder(drag, id, d.pos)
  }

  const rowBase = 'filter-row folder-row group relative flex items-center gap-1.5 pr-1 h-8 cursor-pointer rounded-[var(--radius-control)] select-none'
  const rowTone = (selected: boolean) => selected ? 'filter-row-selected text-primary' : 'text-secondary hover:text-primary'
  const onKeySelect = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  }

  const unsortedCount = index?.unsorted.size ?? 0

  return (
    <div className="min-w-0 h-full">
      <div className="card h-full flex flex-col !px-2 !py-3">
        {header}
        <div className="text-[14px] space-y-0.5">
          <div
            role="button"
            tabIndex={0}
            aria-pressed={view.kind === 'all'}
            className={`${rowBase} pl-2 ${rowTone(view.kind === 'all')}`}
            onClick={() => onSelect({ kind: 'all' })}
            onKeyDown={onKeySelect(() => onSelect({ kind: 'all' }))}
          >
            <NotesRoundedIcon fontSize="inherit" className="icon-sm shrink-0" />
            <span className="truncate flex-1">All notes</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-pressed={view.kind === 'unsorted'}
            className={`${rowBase} pl-2 ${rowTone(view.kind === 'unsorted')}`}
            onClick={() => onSelect({ kind: 'unsorted' })}
            onKeyDown={onKeySelect(() => onSelect({ kind: 'unsorted' }))}
            title="Notes that are in no folder"
          >
            <InboxRoundedIcon fontSize="inherit" className="icon-sm shrink-0" />
            <span className="truncate flex-1">Unsorted</span>
            {unsortedCount > 0 && <span className="folder-count">{unsortedCount}</span>}
          </div>
        </div>

        <div className="mt-3 mb-1 pl-2 pr-1 flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-secondary">Folders</span>
          <span className="flex items-center gap-0.5">
            {expanded.size > 0 && (
              <button className="icon-btn !p-1" title="Collapse all" aria-label="Collapse all" onClick={() => setExpanded(() => new Set())}>
                <UnfoldLessRoundedIcon fontSize="inherit" className="icon-sm" />
              </button>
            )}
            <button type="button" className="folder-new-btn" onClick={() => setCreating({ parent: null })} aria-label="New folder">
              <AddRoundedIcon fontSize="inherit" className="icon-sm" />
              <span>New</span>
            </button>
          </span>
        </div>

        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain text-[14px]" role="tree" aria-label="Folders">
          {creating?.parent === null && (
            <li><NewFolderInput spaceId={spaceId} depth={0} onCreate={create} onCancel={() => setCreating(null)} /></li>
          )}
          {visible.map(node => {
            const isSelected = selectedId === node.id
            const hasChildren = node.children.length > 0
            const isOpen = expanded.has(node.id)
            const rule = index!.rules.get(node.id)!
            const kind = folderKind(rule)
            const count = index!.deep.get(node.id)?.size ?? 0
            return (
              <li
                key={node.id}
                role="treeitem"
                aria-label={node.rec.name}
                aria-level={node.depth + 1}
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-selected={isSelected}
                draggable={renaming !== node.id}
                onDragStart={(e) => { setDragId(node.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => onDragOver(e, node.id)}
                onDrop={(e) => onDrop(e, node.id)}
                onDragEnd={() => { setDragId(null); setDropOver(null) }}
              >
                <div
                  tabIndex={0}
                  className={[rowBase, rowTone(isSelected), dropOver?.id === node.id && dropOver.pos === 'inside' ? 'filter-row-drop' : ''].join(' ')}
                  style={{ paddingLeft: 4 + node.depth * INDENT_PX }}
                  onClick={() => onSelect({ kind: 'folder', id: node.id })}
                  onDoubleClick={() => setRenaming(node.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ kind: 'folder', id: node.id }) }
                    if (e.key === 'F2') { e.preventDefault(); setRenaming(node.id) }
                    if (e.key === 'ArrowRight' && hasChildren && !isOpen) toggle(node.id)
                    if (e.key === 'ArrowLeft' && hasChildren && isOpen) toggle(node.id)
                  }}
                  title={node.rec.name}
                >
                  {Array.from({ length: node.depth }).map((_, i) => (
                    <span key={i} aria-hidden className="filter-guide" style={{ left: 4 + i * INDENT_PX + 9 }} />
                  ))}
                  {hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded text-secondary hover:text-primary"
                      onClick={(e) => { e.stopPropagation(); toggle(node.id) }}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      <ChevronRightRoundedIcon fontSize="inherit" className="icon-sm transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-[18px]" aria-hidden />
                  )}
                  <FolderIcon kind={kind} look={lookFromParams(node.rec.params)} className="shrink-0 folder-icon" />
                  {renaming === node.id ? (
                    <RenameInput
                      initial={node.rec.name}
                      onDone={(name) => { setRenaming(null); if (name && name !== node.rec.name) void renameFolder(node.id, name) }}
                    />
                  ) : (
                    <span className="truncate flex-1 min-w-0">{node.rec.name}</span>
                  )}
                  {count > 0 && renaming !== node.id && <span className="folder-count">{count}</span>}
                  <FolderMenu
                    name={node.rec.name}
                    onNewSubfolder={() => { setCreating({ parent: node.id }); setExpanded(prev => new Set([...prev, node.id])) }}
                    onRename={() => setRenaming(node.id)}
                    onLook={() => setStyling(node.id)}
                    onEditRule={() => onEditRule(node.id)}
                    onMove={() => setMoving(node.id)}
                    onDelete={() => setDeleting(node.id)}
                  />
                </div>
                {dropOver?.id === node.id && dropOver.pos !== 'inside' && (
                  <div className="h-0.5 rounded bg-[rgb(var(--c-accent))]" style={{ marginLeft: 4 + node.depth * INDENT_PX }} />
                )}
                {creating?.parent === node.id && (isOpen || !hasChildren) && (
                  <NewFolderInput spaceId={spaceId} depth={node.depth + 1} onCreate={create} onCancel={() => setCreating(null)} />
                )}
              </li>
            )
          })}
          {index && roots.length === 0 && !creating && (
            <li className="px-2 py-2 text-sm text-secondary leading-snug">
              Folders collect notes by tags or by what they say. Create one with “New”.
            </li>
          )}
        </ul>
      </div>
      {index && styling != null && <FolderLookDialog index={index} folderId={styling} onClose={() => setStyling(null)} />}
      {index && moving != null && (
        <MoveFolderDialog index={index} folderId={moving} onClose={() => setMoving(null)} onMove={async (parent) => {
          setMoving(null)
          await moveFolder(index, moving, parent)
          if (parent != null) setExpanded(prev => new Set([...prev, parent]))
        }} />
      )}
      {index && deleting != null && (
        <DeleteFolderDialog
          index={index}
          folderId={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(removedIds, undo, message) => {
            setDeleting(null)
            if (view.kind === 'folder' && removedIds.includes(view.id)) onSelect({ kind: 'all' })
            notifyUndoable(message, { label: 'Undo', onClick: undo })
          }}
        />
      )}
    </div>
  )
}

function FolderMenu({ name, onNewSubfolder, onRename, onLook, onEditRule, onMove, onDelete }: {
  name: string
  onNewSubfolder: () => void
  onRename: () => void
  onLook: () => void
  onEditRule: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`folder-more ${open ? 'is-open' : ''}`}
          aria-label={`Folder actions: ${name}`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizRoundedIcon fontSize="inherit" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onNewSubfolder}>New subfolder</DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onLook}>Icon and color…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onEditRule}>Edit rule</DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>Move to…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="menu-danger">Delete…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name) }
  return (
    <input
      autoFocus
      className="folder-input flex-1 min-w-0"
      aria-label="Folder name"
      value={v}
      onChange={e => setV(e.target.value)}
      onClick={e => e.stopPropagation()}
      onFocus={e => e.currentTarget.select()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); finish(v.trim() || null) }
        if (e.key === 'Escape') { e.preventDefault(); finish(null) }
      }}
      onBlur={() => finish(v.trim() || null)}
    />
  )
}

function NewFolderInput({ spaceId, depth, onCreate, onCancel }: {
  spaceId: number
  depth: number
  onCreate: (name: string, withTag: boolean) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [withTag, setWithTag] = useState(true)
  const tag = slugTag(name)
  const tagged = useLiveQuery(
    async () => tag ? db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt && (n.tags || []).includes(tag)).count() : 0,
    [spaceId, tag],
  ) ?? 0
  const rootRef = useRef<HTMLDivElement | null>(null)
  const submit = () => { if (name.trim()) onCreate(name.trim(), withTag && !!tag) }
  return (
    <div
      ref={rootRef}
      className="folder-new"
      style={{ paddingLeft: 4 + depth * INDENT_PX + 22 }}
      onBlur={(e) => {
        // Leaving the whole block with nothing typed cancels it.
        if (!name.trim() && !rootRef.current?.contains(e.relatedTarget as Node)) onCancel()
      }}
    >
      <input
        autoFocus
        className="folder-input w-full"
        placeholder="Folder name"
        aria-label="New folder name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
      />
      {tag ? (
        <div className="folder-new-options" role="radiogroup" aria-label="What goes in it">
          <button type="button" role="radio" aria-checked={withTag} className="folder-opt" onClick={() => setWithTag(true)}>
            <FolderRoundedIcon fontSize="inherit" className="icon-sm shrink-0 mt-0.5" />
            <span>Notes tagged <b>#{tag}</b><small>{tagged > 0 ? `${tagged} already` : 'new tag · notes you add here get it'}</small></span>
          </button>
          <button type="button" role="radio" aria-checked={!withTag} className="folder-opt" onClick={() => setWithTag(false)}>
            <FolderOutlinedIcon fontSize="inherit" className="icon-sm shrink-0 mt-0.5" />
            <span>Just a group<small>shows what its subfolders show</small></span>
          </button>
          <div className="flex justify-end gap-1 pt-0.5">
            <button type="button" className="filter-btn filter-btn-ghost !h-7" onClick={onCancel}>Cancel</button>
            <button type="button" className="button !h-7 !px-3 text-sm" onClick={submit}>Create</button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-secondary px-1 pt-1">For example “Work” or “Ideas”. Enter creates, Esc cancels.</div>
      )}
    </div>
  )
}
