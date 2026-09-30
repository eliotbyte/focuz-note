// Conversions between local activity values (strings) and the server representation.
import { parseDurationToMs } from './time'
import type { ActivityTypeRecord } from './types'

export function parseBooleanLoose(v: string): boolean | null {
  const s = v.trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return null
}

export function validateActivityValue(t: ActivityTypeRecord, raw: string): string {
  const trimmed = (raw ?? '').toString().trim()
  if (!trimmed) throw new Error('Value is required')
  switch (t.valueType) {
    case 'integer': {
      const v = Number(trimmed)
      if (!Number.isInteger(v)) throw new Error('Value must be integer')
      if (typeof t.minValue === 'number' && v < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && v > t.maxValue) throw new Error('Value is out of range')
      return String(v)
    }
    case 'float': {
      const f = Number(trimmed)
      if (!Number.isFinite(f)) throw new Error('Value must be float')
      if (typeof t.minValue === 'number' && f < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && f > t.maxValue) throw new Error('Value is out of range')
      return String(f)
    }
    case 'boolean': {
      const b = parseBooleanLoose(trimmed)
      if (b == null) throw new Error('Value must be boolean')
      return b ? 'true' : 'false'
    }
    case 'time': {
      const ms = parseDurationToMs(trimmed)
      if (!Number.isFinite(ms)) throw new Error('Value must be a duration (e.g. 1h 2m 3s 250ms)')
      if (typeof t.minValue === 'number' && ms < t.minValue) throw new Error('Value is out of range')
      if (typeof t.maxValue === 'number' && ms > t.maxValue) throw new Error('Value is out of range')
      return String(Math.round(ms))
    }
    case 'text':
    default:
      return trimmed
  }
}

export function toServerActivityValue(t: ActivityTypeRecord | undefined, raw: string): any {
  const base = (raw ?? '').toString()
  const type = t?.valueType
  try {
    switch (type) {
      case 'integer': return { data: Number.parseInt(base, 10) }
      case 'float': return { data: Number(base) }
      case 'boolean': {
        const b = parseBooleanLoose(base)
        return { data: !!b }
      }
      case 'time': {
        // Convert milliseconds (string) to PostgreSQL interval literal like '1 hour 2 minutes 3 seconds'
        const ms = Number(base)
        if (!Number.isFinite(ms)) return { data: base }
        const totalMs = Math.max(0, Math.round(ms))
        const h = Math.floor(totalMs / 3600000)
        const m = Math.floor((totalMs % 3600000) / 60000)
        const s = Math.floor((totalMs % 60000) / 1000)
        const msR = totalMs % 1000
        const parts: string[] = []
        if (h) parts.push(`${h} hour${h !== 1 ? 's' : ''}`)
        if (m) parts.push(`${m} minute${m !== 1 ? 's' : ''}`)
        if (s || (!h && !m && !msR)) parts.push(`${s} second${s !== 1 ? 's' : ''}`)
        if (msR) parts.push(`${msR} milliseconds`)
        const interval = parts.join(' ')
        return { data: interval }
      }
      case 'text':
      default: return { data: base }
    }
  } catch {
    return { data: base }
  }
}

export function fromServerActivityValue(v: any): string {
  if (v == null) return ''
  if (typeof v === 'object' && 'data' in v) {
    const d = (v as any).data
    if (typeof d === 'boolean') return d ? 'true' : 'false'
    if (typeof d === 'number') return String(d)
    return String(d ?? '')
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return '' }
}
