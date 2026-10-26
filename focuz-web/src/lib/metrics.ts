// Metrics: what a user tracks over time (weight, spending, sleep). A metric is an activity type; each
// value hangs on a note, and the note's date is the value's date. Read from the local database, so it
// works offline; creating a metric needs the server (types are shared by the whole space).
import { db } from './db'
import { api } from './api'
import { formatDurationShort, parseDurationToMs } from './time'
import type { ActivityTypeRecord, NoteRecord } from './types'

export type MetricValueType = ActivityTypeRecord['valueType']

export interface MetricEntry {
  activityId: number
  noteId: number
  date: string
  raw: string
  /** The number behind the value (milliseconds for durations), when there is one. */
  num: number | null
  text: string
}

export interface MetricSummary {
  type: ActivityTypeRecord
  entries: MetricEntry[]
}

export const VALUE_TYPE_LABEL: Record<MetricValueType, string> = {
  float: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / no',
  time: 'Duration',
  text: 'Text',
}

export const AGGREGATION_LABEL: Record<string, string> = {
  avg: 'Average',
  sum: 'Total',
  min: 'Lowest',
  max: 'Highest',
  count: 'Count',
  count_true: 'Count of yes',
  percentage_true: 'Share of yes',
}

/** Aggregations offered when creating a metric; the first is the default. */
export const AGGREGATIONS: Record<MetricValueType, string[]> = {
  float: ['avg', 'sum', 'min', 'max'],
  integer: ['avg', 'sum', 'min', 'max'],
  time: ['sum', 'avg'],
  boolean: ['count_true', 'percentage_true'],
  text: ['count'],
}

export function metricNumber(t: ActivityTypeRecord, raw: string): number | null {
  if (t.valueType === 'integer' || t.valueType === 'float') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (t.valueType === 'time') {
    const ms = parseDurationToMs(raw)
    return Number.isFinite(ms) ? ms : null
  }
  if (t.valueType === 'boolean') return raw === 'true' ? 1 : raw === 'false' ? 0 : null
  return null
}

/** A value as people read it: "63.4 kg", "7h 30m", "yes". */
export function formatMetricValue(t: ActivityTypeRecord, raw: string): string {
  if (t.valueType === 'time') {
    const ms = parseDurationToMs(raw)
    return Number.isFinite(ms) ? formatDurationShort(ms) : raw
  }
  if (t.valueType === 'boolean') return raw === 'true' ? 'yes' : raw === 'false' ? 'no' : raw
  if ((t.valueType === 'float' || t.valueType === 'integer') && t.unit) return `${raw} ${t.unit}`
  return raw
}

/**
 * The difference between two values in the metric's own terms: "+0.4 kg", "−15m". Null when not a number,
 * or when values add up (spending, steps): there one value is not "more" than the last, just another one.
 */
export function formatChange(t: ActivityTypeRecord, from: number | null, to: number | null): string | null {
  if (from == null || to == null || t.valueType === 'boolean' || t.valueType === 'text' || addsUp(t.aggregation)) return null
  const d = to - from
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  const abs = Math.abs(d)
  if (t.valueType === 'time') return `${sign}${formatDurationShort(abs)}`
  const n = Number(abs.toFixed(3)).toString()
  return `${sign}${n}${t.unit ? ` ${t.unit}` : ''}`
}

export function addsUp(aggregation?: string | null): boolean {
  return aggregation === 'sum' || aggregation === 'count'
}

function noteDate(n: NoteRecord): string {
  return n.date || n.createdAt
}

/** Types usable in a space: built-in ones (space 0) and the space's own. */
function usableIn(t: ActivityTypeRecord, spaceId: number): boolean {
  return !t.deletedAt && t.serverId != null && (t.spaceId === spaceId || t.spaceId === 0 || t.spaceId == null)
}

/** Every metric of a space with its values, newest first. Metrics with values come first. */
export async function listMetrics(spaceId: number): Promise<MetricSummary[]> {
  const types = (await db.activityTypes.toArray()).filter(t => usableIn(t, spaceId))
  const notes = await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
  const noteById = new Map(notes.map(n => [n.id!, n]))
  const acts = notes.length ? await db.activities.where('noteId').anyOf([...noteById.keys()]).filter(a => !a.deletedAt).toArray() : []
  const byType = new Map<number, MetricEntry[]>()
  const typeById = new Map(types.map(t => [t.serverId!, t]))
  // One value per note and metric: a stale local duplicate may linger until the next sync.
  const seen = new Set<string>()
  for (const a of acts) {
    const t = typeById.get(a.typeId)
    const n = noteById.get(a.noteId)
    if (!t || !n || seen.has(`${a.noteId}:${a.typeId}`) || !a.valueRaw) continue
    seen.add(`${a.noteId}:${a.typeId}`)
    const list = byType.get(a.typeId) ?? []
    list.push({ activityId: a.id!, noteId: n.id!, date: noteDate(n), raw: a.valueRaw, num: metricNumber(t, a.valueRaw), text: n.text })
    byType.set(a.typeId, list)
  }
  const out = types.map(t => {
    const entries = byType.get(t.serverId!) ?? []
    entries.sort((x, y) => y.date.localeCompare(x.date) || y.activityId - x.activityId)
    return { type: t, entries }
  })
  out.sort((a, b) => {
    const la = a.entries[0]?.date ?? '', lb = b.entries[0]?.date ?? ''
    if (!!la !== !!lb) return la ? -1 : 1
    return lb.localeCompare(la) || a.type.name.localeCompare(b.type.name)
  })
  return out
}

export interface NewMetric {
  name: string
  valueType: MetricValueType
  unit?: string
  aggregation?: string
}

/** Creates a metric on the server and keeps it locally, so it can be used at once. Needs a connection. */
export async function createMetric(spaceId: number, m: NewMetric): Promise<ActivityTypeRecord> {
  const space = await db.spaces.get(spaceId)
  if (!space?.serverId) throw new Error('This space is not on the server yet. Try again after it syncs.')
  const res = await api(`/spaces/${space.serverId}/metrics`, { method: 'POST', body: JSON.stringify(m) })
  const t = res?.data ?? res
  const rec: ActivityTypeRecord = {
    serverId: t.id,
    spaceId,
    name: t.name,
    valueType: t.valueType,
    minValue: t.minValue ?? null,
    maxValue: t.maxValue ?? null,
    aggregation: t.aggregation ?? null,
    unit: t.unit ?? null,
    categoryId: null,
    createdAt: t.createdAt,
    modifiedAt: t.modifiedAt,
    deletedAt: null,
  }
  const existing = await db.activityTypes.where('serverId').equals(t.id).first()
  if (existing) rec.id = existing.id
  rec.id = await db.activityTypes.put(rec)
  return rec
}
