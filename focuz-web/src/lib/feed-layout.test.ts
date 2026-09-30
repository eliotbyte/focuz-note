import { describe, expect, it } from 'vitest'
import { colsOptions, fitCols, layoutFromParams, paramsWithLayout } from './feed-layout'
import { lookFromParams, paramsWithLook } from './folder-look'
import { ruleFromParams, ruleToParams } from './folders'

describe('feed layout', () => {
  it('reads the layout from params, falling back to the list', () => {
    expect(layoutFromParams({ layout: { mode: 'grid', cols: 4 } })).toEqual({ mode: 'grid', cols: 4 })
    expect(layoutFromParams({ layout: { mode: 'mosaic', cols: 'x' } })).toEqual({ mode: 'list', cols: 3 })
    expect(layoutFromParams({ layout: { mode: 'grid', cols: 40 } })).toEqual({ mode: 'grid', cols: 8 })
    expect(layoutFromParams(null)).toEqual({ mode: 'list', cols: 3 })
  })

  it('writes the layout next to the rule and look, and drops it when back to the default', () => {
    const params = paramsWithLook({ includeTags: ['photos'] }, { icon: 'photo', color: 'blue' })
    const grid = paramsWithLayout(params, { mode: 'grid', cols: 5 })
    expect(grid).toEqual({ ...params, layout: { mode: 'grid', cols: 5 } })
    expect(paramsWithLayout(grid, { mode: 'list', cols: 3 })).toEqual(params)
    // Saving the rule or the look keeps the layout.
    const saved = ruleToParams({ ...ruleFromParams(grid), excludeTags: ['old'] }, grid)
    expect(layoutFromParams(paramsWithLook(saved, lookFromParams(saved)))).toEqual({ mode: 'grid', cols: 5 })
  })

  it('offers fewer steps on a phone than on a wide screen', () => {
    expect(colsOptions(328)).toEqual([2, 3])
    expect(colsOptions(620)).toEqual([2, 3, 4, 5])
    expect(colsOptions(1100)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(colsOptions(150)).toEqual([2])
  })

  it('brings a saved size within what the screen holds', () => {
    expect(fitCols(6, 328)).toBe(3)
    expect(fitCols(6, 1100)).toBe(6)
  })
})
