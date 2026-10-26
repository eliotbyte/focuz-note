import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { formatChange, formatMetricValue, listMetrics } from './metrics'
import type { ActivityTypeRecord } from './types'

const T = '2026-10-01T10:00:00.000Z'
const weight: ActivityTypeRecord = { serverId: 10, spaceId: 1, name: 'Weight', valueType: 'float', unit: 'kg', aggregation: 'avg', createdAt: T, modifiedAt: T }
const sleep: ActivityTypeRecord = { serverId: 3, spaceId: 0, name: 'sleep', valueType: 'time', aggregation: 'sum', createdAt: T, modifiedAt: T }

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.activities.clear(), db.activityTypes.clear()])
})

describe('metric values', () => {
  it('reads like people write them', () => {
    expect(formatMetricValue(weight, '63.4')).toBe('63.4 kg')
    expect(formatMetricValue(sleep, '7 hours 30 minutes')).toBe('7h 30m')
    expect(formatMetricValue(sleep, '27000000')).toBe('7h 30m')
    expect(formatChange(weight, 64.2, 63)).toBe('−1.2 kg')
    expect(formatChange(weight, 63, 63)).toBe('±0 kg')
    expect(formatChange({ ...sleep, aggregation: 'avg' }, 7 * 3600e3, 7.5 * 3600e3)).toBe('+30m')
    expect(formatChange(sleep, 7 * 3600e3, 7.5 * 3600e3)).toBeNull()
  })
})

describe('listMetrics', () => {
  it('lists the values of a space newest first, built-in types too, without deleted notes', async () => {
    await db.activityTypes.bulkAdd([weight, sleep, { ...weight, serverId: 11, spaceId: 2, name: 'Other space' }])
    const n1 = await db.notes.add({ spaceId: 1, text: 'Weight: 64.2 kg', tags: [], date: '2026-10-19T08:00:00Z', createdAt: T, modifiedAt: T, isDirty: 0 })
    const n2 = await db.notes.add({ spaceId: 1, text: 'Morning', tags: [], date: '2026-10-26T08:00:00Z', createdAt: T, modifiedAt: T, isDirty: 0 })
    const gone = await db.notes.add({ spaceId: 1, text: 'Deleted', tags: [], date: '2026-10-27T08:00:00Z', createdAt: T, modifiedAt: T, deletedAt: T, isDirty: 0 })
    await db.activities.bulkAdd([
      { noteId: n1, typeId: 10, valueRaw: '64.2', createdAt: T, modifiedAt: T, isDirty: 0 },
      { noteId: n2, typeId: 10, valueRaw: '63', createdAt: T, modifiedAt: T, isDirty: 0 },
      { noteId: gone, typeId: 10, valueRaw: '99', createdAt: T, modifiedAt: T, isDirty: 0 },
    ])
    const list = await listMetrics(1)
    expect(list.map(m => m.type.name)).toEqual(['Weight', 'sleep'])
    expect(list[0].entries.map(e => e.num)).toEqual([63, 64.2])
    expect(list[1].entries).toEqual([])
  })
})
