// One shape for "what narrows the feed", shared by the filter bar, quick filters and folder rules.
import type { FolderRule } from './folders'

export type SortValue = 'modifiedat,DESC' | 'modifiedat,ASC' | 'createdat,DESC' | 'createdat,ASC' | 'date,DESC' | 'date,ASC'

export interface Criteria {
  text: string
  include: string[]
  exclude: string[]
  activities: string[]
  hideReplies: boolean
  openTasks: boolean
}

/** Quick filters as stored per space (kept compatible with older saved values: "!tag" = exclude). */
export interface QuickState {
  text: string
  tags: string[]
  activities?: string[]
  noParents: boolean
  openTasks?: boolean
  sort: SortValue
}

export const EMPTY_CRITERIA: Criteria = { text: '', include: [], exclude: [], activities: [], hideReplies: false, openTasks: false }
export const DEFAULT_QUICK: QuickState = { text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' }

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

export function criteriaFromQuick(q: QuickState): Criteria {
  const tags = Array.isArray(q.tags) ? q.tags : []
  return {
    text: q.text || '',
    include: tags.filter(t => !t.startsWith('!')),
    exclude: tags.filter(t => t.startsWith('!')).map(t => t.slice(1)),
    activities: Array.isArray(q.activities) ? q.activities : [],
    hideReplies: !!q.noParents,
    openTasks: !!q.openTasks,
  }
}

export function quickFromCriteria(c: Criteria, base: QuickState): QuickState {
  return {
    ...base,
    text: c.text,
    tags: [...c.include, ...c.exclude.map(t => `!${t}`)],
    activities: c.activities,
    noParents: c.hideReplies,
    openTasks: c.openTasks,
  }
}

export function criteriaFromRule(r: FolderRule): Criteria {
  return { text: r.textContains, include: r.includeTags, exclude: r.excludeTags, activities: r.includeActivities, hideReplies: r.notReply, openTasks: r.hasOpenTasks }
}

export function ruleFromCriteria(c: Criteria): FolderRule {
  return { textContains: c.text.trim(), includeTags: c.include, excludeTags: c.exclude, includeActivities: c.activities, notReply: c.hideReplies, hasOpenTasks: c.openTasks }
}

export function isEmptyCriteria(c: Criteria): boolean {
  return !c.text.trim() && !c.include.length && !c.exclude.length && !c.activities.length && !c.hideReplies && !c.openTasks
}

/** Rule for "Save as folder": the current folder's rule (unless it is a group) narrowed by the criteria. */
export function mergeIntoRule(base: FolderRule | null, c: Criteria): FolderRule {
  const uniq = (xs: string[]) => [...new Set(xs)]
  const b = base
  return {
    includeTags: uniq([...(b?.includeTags ?? []), ...c.include]),
    excludeTags: uniq([...(b?.excludeTags ?? []), ...c.exclude]),
    textContains: c.text.trim() || b?.textContains || '',
    includeActivities: uniq([...(b?.includeActivities ?? []), ...c.activities]),
    notReply: !!b?.notReply || c.hideReplies,
    hasOpenTasks: !!b?.hasOpenTasks || c.openTasks,
  }
}
