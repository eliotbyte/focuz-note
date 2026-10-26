import { describe, expect, it } from 'vitest'
import { addDays, addMonths, clampDay, monthGrid, parseDay, toDay } from './calendar'

describe('calendar', () => {
  it('rolls days over month and year ends', () => {
    expect(toDay(2026, 11, 32)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('keeps the day when moving by months, or takes the last one', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonths('2026-10-26', -12)).toBe('2025-10-26')
  })

  it('lays a month out in six weeks starting on Monday', () => {
    const grid = monthGrid(2026, 9) // October 2026 starts on a Thursday
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2026-09-28')
    expect(grid[3]).toBe('2026-10-01')
    expect(grid[41]).toBe('2026-11-08')
  })

  it('parses only full days', () => {
    expect(parseDay('2026-10-26')).toEqual({ year: 2026, month: 9, date: 26 })
    expect(parseDay('')).toBeNull()
  })

  it('clamps to open or closed bounds', () => {
    expect(clampDay('2026-10-30', undefined, '2026-10-26')).toBe('2026-10-26')
    expect(clampDay('2026-01-01', '2026-02-01')).toBe('2026-02-01')
    expect(clampDay('2026-05-05')).toBe('2026-05-05')
  })
})
