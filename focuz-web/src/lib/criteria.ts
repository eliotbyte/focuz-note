// One shape for "what narrows the feed", shared by the filter bar, quick filters and folder rules.
import type { FolderRule } from './folders'
import { OPEN_TASKS_TAG, REPLIES_TAG } from './reserved-tags'

export type SortValue = 'modifiedat,DESC' | 'modifiedat,ASC' | 'createdat,DESC' | 'createdat,ASC' | 'date,DESC' | 'date,ASC'

export interface Criteria {
  text: string
  /** Tags the notes must have. Reserved tags (open tasks, replies, ...) are listed here like any other. */
  include: string[]
  /** Tags the notes must not have. */
  exclude: string[]
  activities: string[]
}

/**
 * Quick filters as stored per space: "!tag" = exclude. The old flags `openTasks` and `noParents`
 * are read as reserved tags and never written again.
 */
export interface QuickState {
  text: string
  tags: string[]
  activities?: string[]
  noParents?: boolean
  openTasks?: boolean
  sort: SortValue
}

export const EMPTY_CRITERIA: Criteria = { text: '', include: [], exclude: [], activities: [] }
export const DEFAULT_QUICK: QuickState = { text: '', tags: [], sort: 'modifiedat,DESC' }

export const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'modifiedat,DESC', label: 'Last edited' },
  { value: 'modifiedat,ASC', label: 'Oldest edited' },
  { value: 'createdat,DESC', label: 'Newest created' },
  { value: 'createdat,ASC', label: 'Oldest created' },
  { value: 'date,DESC', label: 'Newest by date' },
  { value: 'date,ASC', label: 'Oldest by date' },
]

export function sortLabel(v: string | undefined): string {
  return SORT_OPTIONS.find(o => o.value === v)?.label ?? 'Last edited'
}

const uniq = (xs: string[]) => [...new Set(xs)]

export function criteriaFromQuick(q: QuickState): Criteria {
  const tags = Array.isArray(q.tags) ? q.tags : []
  let include = tags.filter(t => !t.startsWith('!'))
  let exclude = tags.filter(t => t.startsWith('!')).map(t => t.slice(1))
  if (q.openTasks) include = uniq([...include, OPEN_TASKS_TAG])
  if (q.noParents) exclude = uniq([...exclude, REPLIES_TAG])
  return {
    text: q.text || '',
    include,
    exclude,
    activities: Array.isArray(q.activities) ? q.activities : [],
  }
}

export function quickFromCriteria(c: Criteria, base: QuickState): QuickState {
  // The old flags are dropped here, so they cannot come back on the next read.
  const rest: QuickState = { ...base }
  delete rest.openTasks
  return {
    ...rest,
    text: c.text,
    tags: [...c.include, ...c.exclude.map(t => `!${t}`)],
    activities: c.activities,
    noParents: false,
  }
}

export function criteriaFromRule(r: FolderRule): Criteria {
  return { text: r.textContains, include: r.includeTags, exclude: r.excludeTags, activities: r.includeActivities }
}

export function ruleFromCriteria(c: Criteria): FolderRule {
  return { textContains: c.text.trim(), includeTags: c.include, excludeTags: c.exclude, includeActivities: c.activities }
}

export function isEmptyCriteria(c: Criteria): boolean {
  return !c.text.trim() && !c.include.length && !c.exclude.length && !c.activities.length
}

/** Rule for "Save as folder": the current folder's rule narrowed by the criteria. */
export function mergeIntoRule(base: FolderRule | null, c: Criteria): FolderRule {
  return {
    includeTags: uniq([...(base?.includeTags ?? []), ...c.include]),
    excludeTags: uniq([...(base?.excludeTags ?? []), ...c.exclude]),
    textContains: c.text.trim() || base?.textContains || '',
    includeActivities: uniq([...(base?.includeActivities ?? []), ...c.activities]),
  }
}
