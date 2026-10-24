import { describe, expect, it } from 'vitest'
import { validateImageGeometry } from './image'

describe('validateImageGeometry', () => {
  it.each([
    ['16:9 full HD', 1920, 1080],
    ['16:9 at 480 px short side', 854, 480],
    ['21:9 ultrawide', 2560, 1080],
    ['square', 1000, 1000],
    ['portrait 3:4', 1080, 1440],
  ])('accepts %s', (_name, width, height) => {
    expect(validateImageGeometry({ width, height })).toEqual({ ok: true })
  })

  it.each([
    ['too small', 400, 300],
    ['too narrow', 480, 2000],
    ['too wide (beyond 2.4)', 3000, 1000],
    ['too long', 9000, 3000],
  ])('rejects %s', (_name, width, height) => {
    expect(validateImageGeometry({ width, height }).ok).toBe(false)
  })

  it('gives a reason with the limit', () => {
    expect(validateImageGeometry({ width: 400, height: 300 }).reason).toContain('480')
  })
})
