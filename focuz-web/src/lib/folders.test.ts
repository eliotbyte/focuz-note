import { describe, expect, it } from 'vitest'
import type { FilterRecord, NoteRecord } from './types'
import {
  buildFolderIndex, describeRule, directOnly, folderKind, orphansAfterDelete, ruleChips, ruleFromParams, ruleToParams,
  slugTag, tagsForFolder, EMPTY_RULE,
} from './folders'

let nextNote = 1
function note(text: string, tags: string[] = [], parentId: number | null = null): NoteRecord {
  const now = new Date().toISOString()
  return { id: nextNote++, spaceId: 1, text, tags, parentId, createdAt: now, modifiedAt: now, date: now, isDirty: 0 } as NoteRecord
}
function folder(id: number, name: string, params: any, parentServerId: number | null = null): FilterRecord {
  const now = new Date().toISOString()
  return { id, serverId: id * 100, spaceId: 1, name, params, parentId: parentServerId, createdAt: now, modifiedAt: now, isDirty: 0 } as FilterRecord
}

// Работа (#work, not #archive) > Встречи (#work + "meeting")
// Проекты (group) > Focuz (#focuz), Ремонт (#reno)
// Дом (#home) > Покупки (#shopping)
function fixture() {
  nextNote = 1
  const notes = [
    note('Release call', ['work']), // 1
    note('Meeting with designer', ['work', 'focuz']), // 2
    note('Folders from filters', ['focuz']), // 3
    note('- [ ] sync tests\n- [x] paste images', ['focuz']), // 4
    note('Milk, bread', ['home', 'shopping']), // 5
    note('- [ ] call the plumber', ['home', 'reno']), // 6
    note('Read 20 pages a day'), // 7
    note('September report', ['work', 'archive']), // 8
    note('Bread is already there', [], 5), // 9 (reply, no tags)
  ]
  const filters = [
    folder(1, 'Работа', { includeTags: ['work'], excludeTags: ['archive'] }),
    folder(2, 'Встречи', { includeTags: ['work'], textContains: 'meeting' }, 100),
    folder(3, 'Проекты', { includeTags: [] }),
    folder(4, 'Focuz', { includeTags: ['focuz'] }, 300),
    folder(5, 'Ремонт', { includeTags: ['reno'] }, 300),
    folder(6, 'Дом', { includeTags: ['home'] }),
    folder(7, 'Покупки', { includeTags: ['shopping'] }, 600),
    folder(8, 'Open tasks', { hasOpenTasks: true }),
  ]
  return { notes, filters }
}
const ids = (s: Set<number> | undefined) => [...(s || [])].sort((a, b) => a - b)

describe('folder rules', () => {
  it('reads old params and keeps unrelated keys when writing back', () => {
    const rule = ruleFromParams({ includeTags: ['a'], excludeTags: ['b'], sort: 'date,ASC', _order: 20 } as any)
    expect(rule).toEqual({ ...EMPTY_RULE, includeTags: ['a'], excludeTags: ['b'] })
    const params: any = ruleToParams({ ...rule, textContains: ' x ' }, { sort: 'date,ASC', _order: 20 } as any)
    expect(params).toEqual({ includeTags: ['a'], excludeTags: ['b'], textContains: 'x', sort: 'date,ASC', _order: 20 })
  })

  it('tells folders, smart folders and groups apart', () => {
    expect(folderKind(ruleFromParams({ includeTags: ['a'], excludeTags: ['b'] }))).toBe('folder')
    expect(folderKind(ruleFromParams({ includeTags: ['a'], textContains: 'x' }))).toBe('smart')
    expect(folderKind(ruleFromParams({ hasOpenTasks: true }))).toBe('smart')
    expect(folderKind(ruleFromParams({ includeTags: [] }))).toBe('group')
    expect(tagsForFolder(ruleFromParams({ includeTags: ['a', 'b'] }))).toEqual(['a', 'b'])
    expect(tagsForFolder(ruleFromParams({ includeTags: ['a'], textContains: 'x' }))).toBeNull()
  })

  it('describes a rule in plain words', () => {
    expect(describeRule(ruleFromParams({ includeTags: ['work'], excludeTags: ['archive'] }))).toBe('Notes tagged #work, without #archive')
    expect(describeRule(EMPTY_RULE)).toBe('Shows the notes of its subfolders')
  })

  it('lists the rule as header chips', () => {
    const r = ruleFromParams({ includeTags: ['work', 'q3'], excludeTags: ['archive'] })
    expect(ruleChips({ ...r, textContains: 'invoice', hasOpenTasks: true, notReply: true })).toEqual([
      { kind: 'tag', label: '#work' },
      { kind: 'tag', label: '#q3' },
      { kind: 'without', label: '#archive' },
      { kind: 'text', label: '“invoice”' },
      { kind: 'tasks', label: 'Open tasks' },
      { kind: 'noreply', label: 'No replies' },
    ])
    expect(ruleChips(EMPTY_RULE)).toEqual([])
  })

  it('makes a tag from a folder name', () => {
    expect(slugTag('  Ремонт кухни ')).toBe('ремонт-кухни')
    expect(slugTag('Q3: Plans!')).toBe('q3-plans')
  })
})

describe('folder index', () => {
  it('a folder shows its own notes plus its subfolders', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes)
    expect(ids(idx.deep.get(1))).toEqual([1, 2]) // archive excluded
    expect(ids(idx.deep.get(2))).toEqual([2])
    expect(ids(idx.deep.get(3))).toEqual([2, 3, 4, 6]) // group = union of children
    expect(ids(idx.own.get(3))).toEqual([])
    expect(ids(idx.deep.get(6))).toEqual([5, 6]) // replies without tags are not in the folder
    expect(ids(idx.deep.get(8))).toEqual([4, 6])
  })

  it('"only this folder" leaves out what subfolders already show', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes)
    expect(ids(directOnly(idx, 1))).toEqual([1])
    expect(ids(directOnly(idx, 6))).toEqual([6])
    expect(ids(directOnly(idx, 3))).toEqual([])
  })

  it('unsorted holds top-level notes that are in no folder', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes)
    expect(ids(idx.unsorted)).toEqual([7, 8])
  })

  it('moving a subfolder does not change what it shows', () => {
    const { notes, filters } = fixture()
    const before = buildFolderIndex(filters, notes)
    const moved = filters.map(f => f.id === 5 ? { ...f, parentId: 600 } : f) // Ремонт: Проекты -> Дом
    const after = buildFolderIndex(moved, notes)
    expect(ids(after.deep.get(5))).toEqual(ids(before.deep.get(5)))
    expect(ids(after.deep.get(3))).toEqual([2, 3, 4])
  })

  it('previews an edited rule without saving it', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes, { ruleOverride: { id: 1, rule: ruleFromParams({ includeTags: ['work'] }) } })
    expect(ids(idx.deep.get(1))).toEqual([1, 2, 8])
    expect(ids(idx.unsorted)).toEqual([7])
  })

  it('filters by activities when a lookup is given', () => {
    const { notes, filters } = fixture()
    const withRun = [...filters, folder(9, 'Runs', { includeActivities: ['run'] })]
    const idx = buildFolderIndex(withRun, notes, { activities: id => id === 3 ? new Set(['run']) : undefined })
    expect(ids(idx.deep.get(9))).toEqual([3])
  })
})

describe('deleting a folder', () => {
  it('never offers to delete notes that are in other folders', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes)
    // Дом: 5 is also in Покупки, 6 is in Ремонт and Open tasks
    expect(orphansAfterDelete(idx, 6, false)).toEqual([])
    expect(orphansAfterDelete(idx, 6, true)).toEqual([5]) // with Покупки gone, 5 is in no folder
    // Работа: 1 only here, 2 is also in Focuz
    expect(orphansAfterDelete(idx, 1, false)).toEqual([1])
    expect(orphansAfterDelete(idx, 1, true)).toEqual([1])
  })

  it('counts notes that would be left without a folder', () => {
    const { notes, filters } = fixture()
    const idx = buildFolderIndex(filters, notes)
    expect(orphansAfterDelete(idx, 4, false).sort()).toEqual([3])
  })
})
