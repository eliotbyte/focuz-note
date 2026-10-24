import { describe, expect, it } from 'vitest'
import { dayOf, withDay } from './note-date'

describe('note date', () => {
  it('reads the local calendar day', () => {
    const d = new Date(2026, 9, 24, 23, 30)
    expect(dayOf(d)).toBe('2026-10-24')
  })

  it('moves to the picked day and keeps the time of day', () => {
    const base = new Date(2026, 9, 24, 14, 5, 9).toISOString()
    const moved = new Date(withDay(base, '2026-01-02'))
    expect(dayOf(moved)).toBe('2026-01-02')
    expect([moved.getHours(), moved.getMinutes(), moved.getSeconds()]).toEqual([14, 5, 9])
  })

  it('keeps the base when the day is not a date', () => {
    const base = new Date(2026, 9, 24, 14).toISOString()
    expect(withDay(base, '')).toBe(base)
  })
})
