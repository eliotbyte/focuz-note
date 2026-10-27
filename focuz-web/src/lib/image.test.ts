import { describe, expect, it } from 'vitest'
import { isLongImage, validateImageGeometry } from './image'

describe('validateImageGeometry', () => {
  it.each([
    ['16:9 full HD', 1920, 1080],
    ['21:9 ultrawide', 2560, 1080],
    ['square', 1000, 1000],
    ['portrait 3:4', 1080, 1440],
    ['small screenshot', 400, 300],
    ['pixel art at 64 px', 64, 64],
    ['long chat screenshot 1:8', 1000, 8000],
    ['panorama 8:1', 4000, 500],
  ])('accepts %s', (_name, width, height) => {
    expect(validateImageGeometry({ width, height })).toEqual({ ok: true })
  })

  it.each([
    ['icon', 32, 32],
    ['tracking pixel', 1, 1],
    ['too narrow (beyond 1:8)', 480, 4000],
    ['too long', 9000, 3000],
    ['empty', 0, 0],
  ])('rejects %s', (_name, width, height) => {
    expect(validateImageGeometry({ width, height }).ok).toBe(false)
  })

  it('gives a reason with the limit', () => {
    expect(validateImageGeometry({ width: 32, height: 32 }).reason).toContain('64')
  })

  it('names every broken rule at once', () => {
    const reason = validateImageGeometry({ width: 40, height: 9000 }).reason
    expect(reason).toContain('at least 64 px')
    expect(reason).toContain('8 times')
    expect(reason).toContain('at most 8000 px')
  })
})

describe('isLongImage', () => {
  it('tells long screenshots and panoramas from ordinary pictures', () => {
    expect(isLongImage({ width: 1920, height: 1080 })).toBe(false)
    expect(isLongImage({ width: 1000, height: 8000 })).toBe(true)
    expect(isLongImage({ width: 4000, height: 500 })).toBe(true)
  })
})
