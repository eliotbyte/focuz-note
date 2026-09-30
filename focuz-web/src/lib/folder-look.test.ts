import { describe, expect, it } from 'vitest'
import { lookFromParams, paramsWithLook } from './folder-look'
import { ruleFromParams, ruleToParams } from './folders'

describe('folder look', () => {
  it('reads icon and color from params, ignoring unknown values', () => {
    expect(lookFromParams({ includeTags: ['work'], icon: 'work', color: 'blue' })).toEqual({ icon: 'work', color: 'blue' })
    expect(lookFromParams({ icon: 'unicorn', color: '#ff0000' })).toEqual({ icon: undefined, color: undefined })
    expect(lookFromParams(null)).toEqual({ icon: undefined, color: undefined })
  })

  it('writes the look without touching the rule', () => {
    const params = { includeTags: ['work'], sort: 'date,DESC' as const }
    expect(paramsWithLook(params, { icon: 'star', color: 'green' })).toEqual({ ...params, icon: 'star', color: 'green' })
    expect(paramsWithLook({ ...params, icon: 'star', color: 'green' }, {})).toEqual(params)
  })

  it('survives saving the rule', () => {
    const params = paramsWithLook({ includeTags: ['work'] }, { icon: 'work', color: 'teal' })
    const saved = ruleToParams({ ...ruleFromParams(params), excludeTags: ['archive'] }, params)
    expect(lookFromParams(saved)).toEqual({ icon: 'work', color: 'teal' })
  })
})
