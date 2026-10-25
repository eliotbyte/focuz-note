// Folders are saved filters shown as a tree. A note is never stored "in" a folder: a folder
// shows the notes that match its rule, plus everything its subfolders show. A folder whose rule
// is only tags behaves like a classic folder: putting a note in it means adding those tags.
import type { FilterParams, FilterRecord, NoteRecord } from './types'
import { buildFilterTree, type FilterTreeNode } from './filter-tree'
import { OPEN_TASKS_TAG, REPLIES_TAG, isReservedTag, noteHasTag, tagLabel } from './reserved-tags'

export type FolderKind = 'folder' | 'smart' | 'group'

export interface FolderRule {
  /** Tags the notes must have. "open-tasks" is reserved: it means the note has an unticked checklist item. */
  includeTags: string[]
  excludeTags: string[]
  textContains: string
  includeActivities: string[]
}

export const EMPTY_RULE: FolderRule = { includeTags: [], excludeTags: [], textContains: '', includeActivities: [] }

const strList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

/** Rules saved before reserved tags existed: the old flags are the same as including or excluding them. */
function withLegacyTags(list: string[], tag: string, on: boolean | undefined): string[] {
  return on && !list.includes(tag) ? [...list, tag] : list
}

export function ruleFromParams(p?: FilterParams | null): FolderRule {
  const params = (p || {}) as FilterParams
  return {
    includeTags: withLegacyTags(strList(params.includeTags), OPEN_TASKS_TAG, params.hasOpenTasks),
    excludeTags: withLegacyTags(strList(params.excludeTags), REPLIES_TAG, params.notReply),
    textContains: typeof params.textContains === 'string' ? params.textContains.trim() : '',
    includeActivities: strList(params.includeActivities),
  }
}

/** Writes a rule back into params, keeping everything else (sort, tree order, parent link). */
export function ruleToParams(rule: FolderRule, base?: FilterParams | null): FilterParams {
  const out: any = { ...(base || {}) }
  out.includeTags = [...rule.includeTags]
  out.excludeTags = [...rule.excludeTags]
  out.textContains = rule.textContains.trim() || undefined
  out.includeActivities = rule.includeActivities.length ? [...rule.includeActivities] : undefined
  // Old flags are dropped: the reserved tags above carry them now.
  out.notReply = undefined
  out.hasOpenTasks = undefined
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

export function hasOwnRule(r: FolderRule): boolean {
  return r.includeTags.length > 0 || r.excludeTags.length > 0 || !!r.textContains || r.includeActivities.length > 0
}

export function folderKind(r: FolderRule): FolderKind {
  if (!hasOwnRule(r)) return 'group'
  // A classic folder is only tags: putting a note in it adds those tags. Reserved tags cannot be added.
  if (r.includeTags.length > 0 && !r.textContains && r.includeActivities.length === 0 && !r.includeTags.some(isReservedTag)) return 'folder'
  return 'smart'
}

export function sameRule(a: FolderRule, b: FolderRule): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every(v => y.includes(v))
  return eq(a.includeTags, b.includeTags) && eq(a.excludeTags, b.excludeTags) && a.textContains === b.textContains
    && eq(a.includeActivities, b.includeActivities)
}

/** Activity type names per note; only needed when a rule filters by activities. */
export type ActivityLookup = (noteId: number) => Set<string> | undefined

export function matchesRule(note: NoteRecord, r: FolderRule, activities?: ActivityLookup): boolean {
  if (!hasOwnRule(r)) return false
  if (!r.includeTags.every(t => noteHasTag(note, t))) return false
  if (r.excludeTags.some(t => noteHasTag(note, t))) return false
  if (r.textContains && !(note.text || '').toLowerCase().includes(r.textContains.toLowerCase())) return false
  if (r.includeActivities.length) {
    const names = note.id != null ? activities?.(note.id) : undefined
    if (!names || !r.includeActivities.every(a => names.has(a))) return false
  }
  return true
}

export function rulesUseActivities(filters: FilterRecord[]): boolean {
  return filters.some(f => strList(f.params?.includeActivities).length > 0)
}

/** Tags a note needs to show up in this folder, or null when notes can't be put there by hand. */
export function tagsForFolder(r: FolderRule): string[] | null {
  return folderKind(r) === 'folder' ? r.includeTags : null
}

/** A tag for a new folder from its name: "Ремонт кухни" -> "ремонт-кухни". */
export function slugTag(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function describeRule(r: FolderRule): string {
  if (!hasOwnRule(r)) return 'Shows the notes of its subfolders'
  const tagList = (ts: string[], joiner: string) => ts.map(tagLabel).join(joiner)
  const parts: string[] = []
  if (r.includeTags.length) parts.push(`tagged ${tagList(r.includeTags, ' and ')}`)
  if (r.excludeTags.length) parts.push(`without ${tagList(r.excludeTags, ', ')}`)
  if (r.textContains) parts.push(`containing “${r.textContains}”`)
  if (r.includeActivities.length) parts.push(`with ${r.includeActivities.join(', ')}`)
  return `Notes ${parts.join(', ')}`
}

export type RuleChipKind = 'tag' | 'without' | 'text' | 'activity'

/** The rule as short chips for the folder header, in the same order as describeRule. */
export function ruleChips(r: FolderRule): { kind: RuleChipKind; label: string }[] {
  return [
    ...r.includeTags.map(t => ({ kind: 'tag' as const, label: tagLabel(t) })),
    ...r.excludeTags.map(t => ({ kind: 'without' as const, label: tagLabel(t) })),
    ...(r.textContains ? [{ kind: 'text' as const, label: `“${r.textContains}”` }] : []),
    ...r.includeActivities.map(a => ({ kind: 'activity' as const, label: a })),
  ]
}

export interface FolderIndex {
  roots: FilterTreeNode[]
  nodes: Map<number, FilterTreeNode>
  rules: Map<number, FolderRule>
  /** Notes matching the folder's own rule. */
  own: Map<number, Set<number>>
  /** Own notes plus everything in subfolders; this is what a folder shows and counts. */
  deep: Map<number, Set<number>>
  /** Top-level notes that are in no folder at all. */
  unsorted: Set<number>
  total: number
}

export function buildFolderIndex(
  filters: FilterRecord[],
  notes: NoteRecord[],
  opts: { activities?: ActivityLookup; ruleOverride?: { id: number; rule: FolderRule } | null } = {},
): FolderIndex {
  const roots = buildFilterTree(filters)
  const nodes = new Map<number, FilterTreeNode>()
  const walk = (n: FilterTreeNode) => { nodes.set(n.id, n); n.children.forEach(walk) }
  roots.forEach(walk)

  const rules = new Map<number, FolderRule>()
  for (const n of nodes.values()) {
    const override = opts.ruleOverride && opts.ruleOverride.id === n.id ? opts.ruleOverride.rule : null
    rules.set(n.id, override ?? ruleFromParams(n.rec.params))
  }

  const own = new Map<number, Set<number>>()
  const inSome = new Set<number>()
  for (const [id, rule] of rules) {
    const set = new Set<number>()
    if (hasOwnRule(rule)) {
      for (const note of notes) {
        if (note.id != null && matchesRule(note, rule, opts.activities)) set.add(note.id)
      }
    }
    set.forEach(x => inSome.add(x))
    own.set(id, set)
  }

  const deep = new Map<number, Set<number>>()
  const fill = (n: FilterTreeNode): Set<number> => {
    const set = new Set(own.get(n.id))
    for (const ch of n.children) fill(ch).forEach(x => set.add(x))
    deep.set(n.id, set)
    return set
  }
  roots.forEach(fill)

  const unsorted = new Set<number>()
  for (const note of notes) {
    if (note.id != null && note.parentId == null && !inSome.has(note.id)) unsorted.add(note.id)
  }
  return { roots, nodes, rules, own, deep, unsorted, total: notes.length }
}

/** Notes that match the folder itself but none of its subfolders ("only this folder"). */
export function directOnly(index: FolderIndex, folderId: number): Set<number> {
  const node = index.nodes.get(folderId)
  const out = new Set(index.own.get(folderId))
  if (!node) return out
  for (const ch of node.children) index.deep.get(ch.id)?.forEach(x => out.delete(x))
  return out
}

export function descendantIds(index: FolderIndex, folderId: number): number[] {
  const node = index.nodes.get(folderId)
  if (!node) return []
  const out: number[] = []
  const walk = (n: FilterTreeNode) => { for (const ch of n.children) { out.push(ch.id); walk(ch) } }
  walk(node)
  return out
}

/**
 * Notes shown in the folder that would not be in any folder after deleting it
 * (with or without its subfolders). Notes that are also in other folders never count.
 */
export function orphansAfterDelete(index: FolderIndex, folderId: number, withSubfolders: boolean): number[] {
  const removed = new Set([folderId, ...(withSubfolders ? descendantIds(index, folderId) : [])])
  const kept = new Set<number>()
  for (const [id, set] of index.own) if (!removed.has(id)) set.forEach(x => kept.add(x))
  return [...(index.deep.get(folderId) || [])].filter(x => !kept.has(x))
}
