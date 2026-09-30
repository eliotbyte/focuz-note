import { describe, expect, it, beforeEach } from 'vitest'
import { getFrozen, mergeFrozen, setFrozen, _resetFrozenForTests } from './feed-snapshot'

describe('mergeFrozen', () => {
  it('takes the live order when nothing is frozen yet', () => {
    expect(mergeFrozen(undefined, [3, 1, 2])).toEqual([3, 1, 2])
  })

  it('keeps frozen notes in place when the live order changes or they stop matching', () => {
    expect(mergeFrozen([1, 2, 3], [3, 1])).toEqual([1, 2, 3])
  })

  it('puts new notes where the live order has them', () => {
    expect(mergeFrozen([1, 2, 3], [9, 1, 2, 8, 3, 7])).toEqual([9, 1, 2, 8, 3, 7])
  })

  it('returns the same array when nothing is new', () => {
    const frozen = [1, 2]
    expect(mergeFrozen(frozen, [2, 1])).toBe(frozen)
  })
})

describe('frozen store', () => {
  beforeEach(() => _resetFrozenForTests())

  it('forgets a list once its filters change', () => {
    setFrozen('a', 'x', [1, 2])
    expect(getFrozen('a', 'x')).toEqual([1, 2])
    expect(getFrozen('a', 'y')).toBeUndefined()
    expect(getFrozen('b', 'x')).toBeUndefined()
  })
})
