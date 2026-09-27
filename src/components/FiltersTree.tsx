import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { FilterRecord } from '../lib/types'
import { filters as filtersRepo } from '../data'
import { notifyUndoable } from '../ui/notify'
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { buildFilterTree, collectDescendantIds, flattenVisible, type FilterTreeNode } from '../lib/filter-tree'

const INDENT_PX = 14

function storageKey(spaceId: number) {
  return `focuz:filters:expanded:${spaceId}`
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

function readExpanded(spaceId: number): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(spaceId))
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === 'number') : [])
  } catch {
    return new Set()
  }
}

export default function FiltersTree({
  spaceId,
  selectedId,
  isNoFiltersActive,
  onSelect,
  onClearAll,
}: {
  spaceId: number
  selectedId?: number | null
  isNoFiltersActive: boolean
  onSelect: (f: FilterRecord | null) => void
  onClearAll: () => void
}) {
  const filters = useLiveQuery(() => filtersRepo.listActiveBySpace(spaceId), [spaceId]) ?? []
  const [expanded, setExpanded] = useExpandedState(spaceId)
  const [manage, setManage] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropOver, setDropOver] = useState<{ id: number; pos: 'before' | 'after' | 'inside' } | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!manage) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setManage(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [manage])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roots = useMemo(() => buildFilterTree(filters), [JSON.stringify(filters)])
  const nodesById = useMemo(() => {
    const m = new Map<number, FilterTreeNode>()
    const walk = (n: FilterTreeNode) => { m.set(n.id, n); n.children.forEach(walk) }
    roots.forEach(walk)
    return m
  }, [roots])
  const visible = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])

  // Make sure the selected filter is visible (e.g. opened from a URL inside a collapsed branch).
  useEffect(() => {
    if (!selectedId) return
    const node = nodesById.get(selectedId)
    if (!node) return
    const missing = node.ancestors.filter(a => !expanded.has(a))
    if (missing.length) setExpanded(prev => new Set([...prev, ...missing]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, nodesById])

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteWithChildren(localId: number) {
    const node = nodesById.get(localId)
    if (!node) return
    const ids = collectDescendantIds(node)
    await filtersRepo.softDeleteMany(ids)
    notifyUndoable(ids.length > 1 ? `Deleted ${ids.length} filters` : 'Filter deleted', { label: 'Undo', onClick: () => filtersRepo.restoreDeletedMany(ids) })
    if (selectedId && ids.includes(selectedId)) onSelect(null)
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const id = ((e as CustomEvent).detail?.id as number) || 0
      if (id) void deleteWithChildren(id)
    }
    window.addEventListener('focuz:delete-filter-request', handler)
    return () => { window.removeEventListener('focuz:delete-filter-request', handler) }
  })

  async function applyReparentAndOrder(dragLocalId: number, targetLocalId: number, pos: 'before' | 'after' | 'inside') {
    const drag = nodesById.get(dragLocalId)
    const target = nodesById.get(targetLocalId)
    if (!drag || !target || dragLocalId === targetLocalId) return
    if (target.ancestors.includes(dragLocalId)) return // no dropping into own subtree

    let newParentServerId: number | null = null
    let newParentClientId: string | null = null
    let siblings: FilterTreeNode[]
    if (pos === 'inside') {
      newParentServerId = target.serverId ?? null
      newParentClientId = target.serverId ? null : (target.clientId || null)
      siblings = target.children.filter(n => n.id !== dragLocalId)
    } else {
      const parent = target.ancestors.length ? nodesById.get(target.ancestors[target.ancestors.length - 1]) : undefined
      newParentServerId = parent?.serverId ?? null
      newParentClientId = parent && !parent.serverId ? (parent.clientId || null) : null
      siblings = (parent ? parent.children : roots).filter(n => n.id !== dragLocalId)
    }
    let insertIndex = pos === 'inside' ? siblings.length : siblings.findIndex(n => n.id === targetLocalId) + (pos === 'after' ? 1 : 0)
    if (insertIndex < 0) insertIndex = siblings.length
    const ordered = [...siblings]
    ordered.splice(insertIndex, 0, drag)

    const now = new Date().toISOString()
    const bulk = ordered.map((n, i) => {
      const params: any = { ...(n.rec.params as any), _order: (i + 1) * 10 }
      const changes: Partial<Pick<FilterRecord, 'parentId' | 'params' | 'modifiedAt' | 'isDirty'>> = { params, isDirty: 1, modifiedAt: now }
      if (n.id === dragLocalId) {
        params._parentClientId = newParentServerId != null ? undefined : (newParentClientId || undefined)
        changes.parentId = newParentServerId
      }
      return { id: n.id, changes }
    })
    await filtersRepo.bulkUpdate(bulk)
    if (pos === 'inside') setExpanded(prev => new Set([...prev, targetLocalId]))
  }

  function onDragOver(e: React.DragEvent, id: number) {
    e.preventDefault()
    if (dragId == null) return
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
    await applyReparentAndOrder(drag, id, d.pos)
  }

  const rowBase = 'filter-row group relative flex items-center gap-1 pr-2 h-8 cursor-pointer rounded-[var(--radius-control)] select-none'

  return (
    <div className="min-w-0 h-full" ref={ref}>
      <div className="card h-full flex flex-col !px-2 !py-3">
        <div className="mb-2 px-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-title text-muted">
            <FilterAltRoundedIcon fontSize="inherit" className="icon-sm" />
            <span>Filters</span>
          </span>
          <span className="flex items-center gap-1">
            {expanded.size > 0 && (
              <button className="icon-btn !p-1" title="Collapse all" aria-label="Collapse all" onClick={() => setExpanded(() => new Set())}>
                <UnfoldLessRoundedIcon fontSize="inherit" className="icon-sm" />
              </button>
            )}
            <button
              className={`text-sm px-2 py-0.5 rounded-[var(--radius-control)] ${manage ? 'text-primary filter-row-selected' : 'text-secondary hover:text-primary'}`}
              onClick={() => setManage(m => !m)}
            >{manage ? 'Done' : 'Manage'}</button>
          </span>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain text-[14px]" role="tree" aria-label="Saved filters">
          <li role="treeitem" aria-label="All notes" aria-selected={isNoFiltersActive}>
            <div
              className={`${rowBase} pl-2 ${isNoFiltersActive ? 'filter-row-selected text-primary' : 'text-secondary hover:text-primary'}`}
              onClick={onClearAll}
            >
              <span className="truncate">All notes</span>
            </div>
          </li>
          {visible.map(node => {
            const isSelected = selectedId === node.id
            const hasChildren = node.children.length > 0
            const isOpen = expanded.has(node.id)
            return (
              <li
                key={node.id}
                role="treeitem"
                aria-label={node.rec.name}
                aria-level={node.depth + 1}
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-selected={isSelected}
                draggable={manage}
                onDragStart={(e) => { setDragId(node.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => onDragOver(e, node.id)}
                onDrop={(e) => onDrop(e, node.id)}
                onDragEnd={() => { setDragId(null); setDropOver(null) }}
              >
                <div
                  className={[
                    rowBase,
                    isSelected ? 'filter-row-selected text-primary' : 'text-secondary hover:text-primary',
                    dropOver?.id === node.id && dropOver.pos === 'inside' ? 'filter-row-drop' : '',
                  ].join(' ')}
                  style={{ paddingLeft: 4 + node.depth * INDENT_PX }}
                  onClick={() => onSelect(node.rec)}
                  title={node.rec.name}
                >
                  {/* indent guides: one line per ancestor level */}
                  {Array.from({ length: node.depth }).map((_, i) => (
                    <span key={i} aria-hidden className="filter-guide" style={{ left: 4 + i * INDENT_PX + 9 }} />
                  ))}
                  {hasChildren ? (
                    <button
                      type="button"
                      className="shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded text-secondary hover:text-primary"
                      onClick={(e) => { e.stopPropagation(); toggle(node.id) }}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      <ChevronRightRoundedIcon fontSize="inherit" className="icon-sm transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-[18px]" aria-hidden />
                  )}
                  <span className="truncate flex-1 min-w-0">{node.rec.name}</span>
                  {hasChildren && !isOpen && (
                    <span className="shrink-0 text-[11px] text-secondary tabular-nums">{node.descendantCount}</span>
                  )}
                  {manage && (
                    <button
                      className="shrink-0 icon-btn !p-0.5"
                      title="Delete filter (with nested)"
                      aria-label="Delete filter"
                      onClick={(e) => { e.stopPropagation(); void deleteWithChildren(node.id) }}
                    >
                      <CloseRoundedIcon fontSize="inherit" className="icon-sm" />
                    </button>
                  )}
                </div>
                {dropOver?.id === node.id && dropOver.pos !== 'inside' && (
                  <div className="h-0.5 rounded bg-[rgb(var(--c-accent))]" style={{ marginLeft: 4 + node.depth * INDENT_PX }} />
                )}
              </li>
            )
          })}
          {filters.length === 0 && (
            <li className="px-2 py-2 text-sm text-secondary">No saved filters yet. Use “Save” in Quick filters.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
