import { describe, expect, it } from 'vitest'
import { ownThread, repliesPublicBelow } from './note-threads'

// 1 ─ 2 ─ 3, 1 ─ 4; 5 alone
const notes = [
  { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 1 }, { id: 5, parentId: null },
]
const byId = new Map(notes.map(n => [n.id, n]))

describe('note threads', () => {
  it('a note and its replies at any depth are its own thread', () => {
    expect([...ownThread(notes, 2)].sort()).toEqual([2, 3])
    expect([...ownThread(notes, 1)].sort()).toEqual([1, 2, 3, 4])
    expect([...ownThread(notes, 5)]).toEqual([5])
  })

  it('stops on a loop already in the data', () => {
    const loop = [{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }]
    expect([...ownThread(loop, 1)].sort()).toEqual([1, 2])
    expect(repliesPublicBelow(new Map(loop.map(n => [n.id, n])), 1, new Map())).toBe(false)
  })

  it('replies are public below the nearest shared note that shares its replies', () => {
    expect(repliesPublicBelow(byId, 3, new Map([[1, true]]))).toBe(true)
    expect(repliesPublicBelow(byId, 3, new Map([[1, true], [2, false]]))).toBe(false)
    expect(repliesPublicBelow(byId, 5, new Map([[1, true]]))).toBe(false)
    expect(repliesPublicBelow(byId, null, new Map([[1, true]]))).toBe(false)
  })
})
