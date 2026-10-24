// The note date (`date`) is the day a note is about. It defaults to the creation time; the editor
// lets people pick another day and keeps the time of day, so notes of one day keep their order.

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp or Date. */
export function dayOf(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO timestamp on the picked day (YYYY-MM-DD), keeping the time of day of `base`. */
export function withDay(base: string | Date, day: string): string {
  const d = new Date(base)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return d.toISOString()
  d.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toISOString()
}
