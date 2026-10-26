// Day math for the date picker. Days are local calendar days as YYYY-MM-DD strings, the same form
// `<input type="date">` used and the export range and the note date (`dayOf`) still use.

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of a local year, month (0-11) and day; out-of-range parts roll over like `Date`. */
export function toDay(year: number, month: number, date: number): string {
  const d = new Date(year, month, date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Year, month (0-11) and day of a YYYY-MM-DD string; null when it is not one. */
export function parseDay(day: string): { year: number; month: number; date: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, date: Number(m[3]) } : null
}

export function today(): string {
  const d = new Date()
  return toDay(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(day: string, n: number): string {
  const p = parseDay(day)!
  return toDay(p.year, p.month, p.date + n)
}

/** The same day of another month, or that month's last day when it is shorter (31 Jan + 1 → 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const p = parseDay(day)!
  const last = new Date(p.year, p.month + n + 1, 0).getDate()
  return toDay(p.year, p.month + n, Math.min(p.date, last))
}

/** The 42 days (6 weeks, Monday first) shown for a month, with the end of the month before and the start of the next. */
export function monthGrid(year: number, month: number): string[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => toDay(year, month, 1 - lead + i))
}

/** The day kept inside [min, max]; empty bounds are open. */
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min
  if (max && day > max) return max
  return day
}
