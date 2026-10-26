import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import ArrowRightRoundedIcon from '@mui/icons-material/ArrowRightRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { addDays, addMonths, clampDay, monthGrid, parseDay, toDay, today } from '../lib/calendar'

type Props = {
  /** YYYY-MM-DD, or '' when no day is picked. */
  value: string
  onChange: (day: string) => void
  /** Earliest and latest day that can be picked (YYYY-MM-DD). */
  min?: string
  max?: string
  /** The left footer button: clears the day (export range) or sets today (note date). */
  resetLabel: string
  onReset: () => void
  /** What the calendar picks, for screen readers ("Start date"). */
  label: string
  align?: 'start' | 'center' | 'end'
  /** The trigger: one button element. */
  children: ReactNode
}

/** A day picked from a month calendar in a popover; the month title opens month and year wheels. */
export default function DatePicker({ value, onChange, min, max, resetLabel, onReset, label, align = 'start', children }: Props) {
  const [open, setOpen] = useState(false)
  return (
    // Modal: inside a dialog, only the topmost scroll lock lets the wheel through, and the wheels need it.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="cal" aria-label={label} onOpenAutoFocus={e => {
        // Focus starts on the picked day (or today), not on the first button.
        e.preventDefault()
        ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.cal-day[tabindex="0"]')?.focus()
      }}>
        {open && (
          <Calendar
            value={value}
            min={min}
            max={max}
            resetLabel={resetLabel}
            onPick={day => { onChange(day); setOpen(false) }}
            onReset={() => { onReset(); setOpen(false) }}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

const longDate = (day: string) => {
  const p = parseDay(day)!
  return new Date(p.year, p.month, p.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
const monthName = (month: number, style: 'long' | 'short' = 'long') => new Date(2000, month, 1).toLocaleDateString(undefined, { month: style })
// Monday first: 2024-01-01 was a Monday.
const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }))

function Calendar({ value, min, max, resetLabel, onPick, onReset, onClose }: {
  value: string; min?: string; max?: string; resetLabel: string
  onPick: (day: string) => void; onReset: () => void; onClose: () => void
}) {
  const now = today()
  // The day keyboard focus is on; its month is the one shown.
  const [focusDay, setFocusDay] = useState(() => clampDay(value || now, min, max))
  const [wheels, setWheels] = useState(false)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const focus = parseDay(focusDay)!
  const grid = monthGrid(focus.year, focus.month)
  const outOfRange = (day: string) => (!!min && day < min) || (!!max && day > max)
  const firstOfMonth = toDay(focus.year, focus.month, 1)
  const lastOfMonth = toDay(focus.year, focus.month + 1, 0)

  // Keyboard focus goes to focusDay when it comes back from the wheels or moves by keys; the month buttons
  // keep it. On open, the popover's autofocus puts it there.
  const focusCell = useRef(false)
  useEffect(() => {
    if (wheels || !focusCell.current) return
    focusCell.current = false
    cells.current.get(focusDay)?.focus()
  }, [focusDay, wheels])

  const move = (day: string) => setFocusDay(clampDay(day, min, max))
  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDay, -((new Date(focus.year, focus.month, focus.date).getDay() + 6) % 7)),
      End: () => addDays(focusDay, 6 - ((new Date(focus.year, focus.month, focus.date).getDay() + 6) % 7)),
    }
    const next = step[e.key]
    if (!next) return
    e.preventDefault()
    focusCell.current = true
    move(next())
  }

  if (wheels) {
    return (
      <MonthYearWheels
        year={focus.year}
        month={focus.month}
        min={min}
        max={max}
        onCancel={() => { focusCell.current = true; setWheels(false) }}
        onShow={(year, month) => {
          const last = new Date(year, month + 1, 0).getDate()
          focusCell.current = true
          move(toDay(year, month, Math.min(focus.date, last)))
          setWheels(false)
        }}
      />
    )
  }

  return (
    <>
      <div className="cal-head">
        <button type="button" className="cal-title" aria-expanded={false} onClick={() => setWheels(true)}>
          <ArrowRightRoundedIcon fontSize="small" aria-hidden />
          {monthName(focus.month)} {focus.year}
        </button>
        <div className="flex items-center">
          <button type="button" className="icon-btn !p-1" aria-label="Previous month" disabled={!!min && firstOfMonth <= min} onClick={() => move(addMonths(focusDay, -1))}>
            <ExpandLessRoundedIcon fontSize="small" />
          </button>
          <button type="button" className="icon-btn !p-1" aria-label="Next month" disabled={!!max && lastOfMonth >= max} onClick={() => move(addMonths(focusDay, 1))}>
            <ExpandMoreRoundedIcon fontSize="small" />
          </button>
        </div>
      </div>
      <table className="cal-grid" role="grid" aria-label={`${monthName(focus.month)} ${focus.year}`} onKeyDown={onGridKey}>
        <thead>
          <tr>{weekdays.map(w => <th key={w} scope="col" className="cal-weekday">{w}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, row) => (
            <tr key={row}>
              {grid.slice(row * 7, row * 7 + 7).map(day => {
                const p = parseDay(day)!
                return (
                  <td key={day} role="gridcell" aria-selected={day === value}>
                    <button
                      type="button"
                      ref={el => { if (el) cells.current.set(day, el); else cells.current.delete(day) }}
                      className={`cal-day ${p.month !== focus.month ? 'is-outside' : ''} ${day === now ? 'is-today' : ''} ${day === value ? 'is-selected' : ''}`}
                      tabIndex={day === focusDay ? 0 : -1}
                      aria-current={day === now ? 'date' : undefined}
                      aria-label={longDate(day)}
                      disabled={outOfRange(day)}
                      onClick={() => onPick(day)}
                    >
                      {p.date}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-foot">
        <button type="button" className="filter-btn filter-btn-ghost filter-btn-accent" onClick={onReset}>{resetLabel}</button>
        <button type="button" className="filter-btn filter-btn-ghost filter-btn-accent" onClick={onClose}>Close</button>
      </div>
    </>
  )
}

function MonthYearWheels({ year, month, min, max, onCancel, onShow }: {
  year: number; month: number; min?: string; max?: string
  onCancel: () => void; onShow: (year: number, month: number) => void
}) {
  const thisYear = new Date().getFullYear()
  const firstYear = Math.min(year, min ? parseDay(min)!.year : thisYear - 50)
  const lastYear = Math.max(year, max ? parseDay(max)!.year : thisYear + 10)
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i)
  const [y, setY] = useState(year)
  const [m, setM] = useState(month)
  // A month the range leaves no day in can't be shown.
  const monthOk = (mm: number) => (!min || toDay(y, mm + 1, 0) >= min) && (!max || toDay(y, mm, 1) <= max)

  return (
    <>
      <div className="cal-head">
        <button type="button" className="cal-title" aria-expanded onClick={onCancel}>
          <ArrowRightRoundedIcon fontSize="small" aria-hidden />
          {monthName(m)} {y}
        </button>
      </div>
      <div className="cal-wheels">
        <Wheel label="Month" items={Array.from({ length: 12 }, (_, i) => ({ value: i, label: monthName(i), disabled: !monthOk(i) }))} value={m} onChange={setM} autoFocus />
        <Wheel label="Year" items={years.map(v => ({ value: v, label: String(v) }))} value={y} onChange={setY} />
      </div>
      <div className="cal-foot is-end">
        <button type="button" className="filter-btn filter-btn-ghost filter-btn-accent" onClick={onCancel}>Cancel</button>
        <button type="button" className="filter-btn filter-btn-ghost filter-btn-accent" disabled={!monthOk(m)} onClick={() => onShow(y, m)}>Show</button>
      </div>
    </>
  )
}

const ROW = 36

/** A scroll wheel: the row in the middle band is the value. Scroll, drag, click a row, or use the arrow keys. */
function Wheel({ label, items, value, onChange, autoFocus }: {
  label: string; items: { value: number; label: string; disabled?: boolean }[]
  value: number; onChange: (v: number) => void; autoFocus?: boolean
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const index = Math.max(0, items.findIndex(it => it.value === value))

  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = index * ROW
    if (autoFocus) box.current?.focus({ preventScroll: true })
    // Only where it opens; afterwards the scroll position drives the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scrollTo = (i: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.current?.scrollTo({ top: Math.max(0, Math.min(items.length - 1, i)) * ROW, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div
      ref={box}
      className="cal-wheel"
      role="listbox"
      aria-label={label}
      aria-activedescendant={`wheel-${label}-${value}`}
      tabIndex={0}
      onScroll={e => {
        const i = Math.round(e.currentTarget.scrollTop / ROW)
        const it = items[Math.max(0, Math.min(items.length - 1, i))]
        if (it && it.value !== value) onChange(it.value)
      }}
      onKeyDown={e => {
        const delta = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key]
        if (delta == null) return
        e.preventDefault()
        scrollTo(index + delta)
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.value}
          id={`wheel-${label}-${it.value}`}
          role="option"
          aria-selected={it.value === value}
          aria-disabled={it.disabled || undefined}
          className="cal-wheel-item"
          onClick={() => scrollTo(i)}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}
