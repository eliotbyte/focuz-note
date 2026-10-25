// Tags the app computes itself. A note never stores them, so they are not #tags and cannot be typed:
//  - open-tasks: has at least one unticked checklist item;
//  - tasks-in-progress: has both ticked and unticked items;
//  - closed-tasks: has checklist items and all of them are ticked;
//  - replies: is a reply to another note.
// Filters and folder rules use them like any other tag, so a chip can include them (green) or
// exclude them (red).
import { checklistCounts } from './note-format/render'

export const OPEN_TASKS_TAG = 'open-tasks'
export const IN_PROGRESS_TAG = 'tasks-in-progress'
export const CLOSED_TASKS_TAG = 'closed-tasks'
export const REPLIES_TAG = 'replies'

export const RESERVED_TAGS: readonly string[] = [OPEN_TASKS_TAG, IN_PROGRESS_TAG, CLOSED_TASKS_TAG, REPLIES_TAG]

const LABELS: Record<string, string> = {
  [OPEN_TASKS_TAG]: 'open tasks',
  [IN_PROGRESS_TAG]: 'tasks in progress',
  [CLOSED_TASKS_TAG]: 'closed tasks',
  [REPLIES_TAG]: 'replies',
}

export function isReservedTag(tag: string): boolean {
  return RESERVED_TAGS.includes(tag)
}

/** How a tag is shown. A reserved tag reads as words, because it is not a #tag. */
export function tagLabel(tag: string): string {
  return LABELS[tag] ?? `#${tag}`
}

export interface TagSource {
  tags?: string[] | null
  text?: string | null
  parentId?: number | null
}

/** Whether a note has the tag, reserved tags included. */
export function noteHasTag(note: TagSource, tag: string): boolean {
  if (!isReservedTag(tag)) return (note.tags || []).includes(tag)
  if (tag === REPLIES_TAG) return note.parentId != null
  const { open, done } = checklistCounts(note.text || '')
  if (tag === OPEN_TASKS_TAG) return open > 0
  if (tag === IN_PROGRESS_TAG) return open > 0 && done > 0
  return open === 0 && done > 0
}
