import { describe, expect, it } from 'vitest'
import { OPEN_TASKS_TAG, noteHasTag } from './reserved-tags'
import { criteriaFromQuick, quickFromCriteria, EMPTY_CRITERIA, DEFAULT_QUICK, isEmptyCriteria } from './criteria'
import { matchesRule, ruleFromParams, ruleToParams, folderKind } from './folders'
import type { NoteRecord } from './types'

const open = { text: '- [ ] buy milk', tags: [] as string[] }
const done = { text: '- [x] bought milk', tags: [] as string[] }
const tagged = { text: 'plain', tags: ['work'] }

describe('reserved tag open-tasks', () => {
  it('is on a note with an unticked checklist item, and not otherwise', () => {
    expect(noteHasTag(open, OPEN_TASKS_TAG)).toBe(true)
    expect(noteHasTag(done, OPEN_TASKS_TAG)).toBe(false)
    expect(noteHasTag(tagged, OPEN_TASKS_TAG)).toBe(false)
  })

  it('reads ordinary tags from the note', () => {
    expect(noteHasTag(tagged, 'work')).toBe(true)
    expect(noteHasTag(tagged, 'home')).toBe(false)
  })

  it('works in a folder rule as include and as exclude', () => {
    const note = { ...open, id: 1, parentId: null, createdAt: '', modifiedAt: '', date: '', spaceId: 1 } as unknown as NoteRecord
    expect(matchesRule(note, { ...ruleFromParams({}), includeTags: [OPEN_TASKS_TAG] })).toBe(true)
    expect(matchesRule(note, { ...ruleFromParams({}), excludeTags: [OPEN_TASKS_TAG] })).toBe(false)
  })

  it('makes a rule with the reserved tag a smart folder, never a classic one', () => {
    expect(folderKind(ruleFromParams({ includeTags: [OPEN_TASKS_TAG] }))).toBe('smart')
  })
})

describe('old saved filters keep working', () => {
  it('turns a saved hasOpenTasks flag in a folder rule into the reserved tag', () => {
    expect(ruleFromParams({ hasOpenTasks: true }).includeTags).toEqual([OPEN_TASKS_TAG])
  })

  it('turns a saved openTasks flag in quick filters into the reserved tag, and drops the flag on write', () => {
    const quick = criteriaFromQuick({ ...DEFAULT_QUICK, tags: ['work'], openTasks: true })
    expect(quick.include).toEqual(['work', OPEN_TASKS_TAG])
    const written = quickFromCriteria(quick, { ...DEFAULT_QUICK, openTasks: true })
    expect(written.openTasks).toBeUndefined()
    expect(written.tags).toEqual(['work', OPEN_TASKS_TAG])
  })

  it('does not write the old hasOpenTasks flag back into folder params', () => {
    const params: any = ruleToParams(ruleFromParams({ includeTags: [OPEN_TASKS_TAG] }), { hasOpenTasks: true } as any)
    expect(params.hasOpenTasks).toBeUndefined()
    expect(params.includeTags).toEqual([OPEN_TASKS_TAG])
  })

  it('counts a reserved tag as a filter, so the bar is not empty', () => {
    expect(isEmptyCriteria({ ...EMPTY_CRITERIA, include: [OPEN_TASKS_TAG] })).toBe(false)
  })
})

describe('task states and replies', () => {
  const at = (text: string, parentId: number | null = null) => ({ text, tags: [], parentId })
  it('splits checklists into open, in progress and closed', () => {
    const only = at('- [ ] a\n- [ ] b')
    const mixed = at('- [x] a\n- [ ] b')
    const all = at('- [x] a\n- [X] b')
    const none = at('just text')
    expect([noteHasTag(only, 'open-tasks'), noteHasTag(only, 'tasks-in-progress'), noteHasTag(only, 'closed-tasks')]).toEqual([true, false, false])
    expect([noteHasTag(mixed, 'open-tasks'), noteHasTag(mixed, 'tasks-in-progress'), noteHasTag(mixed, 'closed-tasks')]).toEqual([true, true, false])
    expect([noteHasTag(all, 'open-tasks'), noteHasTag(all, 'tasks-in-progress'), noteHasTag(all, 'closed-tasks')]).toEqual([false, false, true])
    expect([noteHasTag(none, 'open-tasks'), noteHasTag(none, 'closed-tasks')]).toEqual([false, false])
  })

  it('treats a reply as the replies tag', () => {
    expect(noteHasTag(at('x', 4), 'replies')).toBe(true)
    expect(noteHasTag(at('x'), 'replies')).toBe(false)
  })
})

describe('old quick filters', () => {
  it('turns the old hideReplies-style flags into the replies tag', () => {
    expect(criteriaFromQuick({ ...DEFAULT_QUICK, noParents: true }).exclude).toEqual(['replies'])
    expect(quickFromCriteria(criteriaFromQuick({ ...DEFAULT_QUICK, noParents: true }), DEFAULT_QUICK).tags).toEqual(['!replies'])
  })
})
