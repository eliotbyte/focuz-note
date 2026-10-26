import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { formatChange, formatMetricValue, listMetrics, AGGREGATION_LABEL, VALUE_TYPE_LABEL, type MetricSummary } from '../lib/metrics'
import { formatRelativeShort } from '../lib/time'
import { noteLabel } from '../lib/note-format/render'
import NewMetricDialog from './NewMetricDialog'

function day(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

/** Numbers only: lowest, highest and average over every value. */
function stats(m: MetricSummary): string | null {
  const nums = m.entries.map(e => e.num).filter((n): n is number => n != null)
  if (nums.length < 2 || (m.type.valueType !== 'float' && m.type.valueType !== 'integer')) return null
  const f = (n: number) => formatMetricValue(m.type, String(Number(n.toFixed(2))))
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length
  return `Lowest ${f(Math.min(...nums))} · highest ${f(Math.max(...nums))} · average ${f(avg)}`
}

/** Metrics of a space: the last value of each and, for the open one, every value with its note. */
export default function MetricsView({ spaceId, canWrite, onOpenNote }: {
  spaceId: number
  canWrite: boolean
  onOpenNote: (noteId: number) => void
}) {
  const metrics = useLiveQuery(() => listMetrics(spaceId), [spaceId])
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const used = (metrics ?? []).filter(m => m.entries.length > 0)
  const unused = (metrics ?? []).filter(m => m.entries.length === 0)
  const open = metrics?.find(m => m.type.serverId === openId) ?? null

  function row(m: MetricSummary) {
    const [last, prev] = m.entries
    const change = last && prev ? formatChange(m.type, prev.num, last.num) : null
    const selected = m.type.serverId === openId
    return (
      <li key={m.type.serverId!}>
        <button
          type="button"
          className="metric-row"
          aria-expanded={selected}
          onClick={() => setOpenId(selected ? null : m.type.serverId!)}
        >
          <span className="min-w-0 flex-1">
            <span className="metric-name">{m.type.name}</span>
            <span className="metric-meta">
              {last
                ? `${m.entries.length} ${m.entries.length === 1 ? 'value' : 'values'} · last ${formatRelativeShort(last.date)}`
                : VALUE_TYPE_LABEL[m.type.valueType] + (m.type.unit ? `, ${m.type.unit}` : '')}
            </span>
          </span>
          {last && (
            <span className="text-right shrink-0">
              <span className="metric-value">{formatMetricValue(m.type, last.raw)}</span>
              {change && <span className="metric-meta" title={`Since ${day(prev.date)}`}>{change}</span>}
            </span>
          )}
          <ChevronRightRoundedIcon fontSize="inherit" className={`metric-chevron${selected ? ' is-open' : ''}`} aria-hidden />
        </button>
        {selected && open && <MetricDetail m={open} onOpenNote={onOpenNote} />}
      </li>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="folder-head">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="folder-title">
            <ShowChartRoundedIcon fontSize="inherit" className="folder-icon text-secondary" aria-hidden />
            <span className="truncate">Metrics</span>
          </h2>
          {canWrite && (
            <button type="button" className="filter-btn filter-btn-accent" onClick={() => setCreating(true)}>
              <AddRoundedIcon fontSize="inherit" aria-hidden /> New metric
            </button>
          )}
        </div>
        <p className="metric-intro">
          Numbers you track over time. Each value lives in a note: add one with the chart button under a note’s text, or ask your agent to record it.
        </p>
      </div>

      {metrics && used.length === 0 && (
        <div className="feed-empty">
          No values yet. {canWrite ? 'Write a note and add a metric to it.' : ''}
        </div>
      )}
      {used.length > 0 && <ul className="card !p-1.5 metric-list">{used.map(row)}</ul>}
      {unused.length > 0 && (
        <section className="space-y-1.5">
          <div className="tree-label px-2">Not used yet</div>
          <ul className="card !p-1.5 metric-list">{unused.map(row)}</ul>
        </section>
      )}

      <NewMetricDialog spaceId={spaceId} open={creating} onClose={() => setCreating(false)} onCreated={(t) => setOpenId(t.serverId ?? null)} />
    </div>
  )
}

function MetricDetail({ m, onOpenNote }: { m: MetricSummary; onOpenNote: (noteId: number) => void }) {
  const [limit, setLimit] = useState(30)
  const line = stats(m)
  const agg = m.type.aggregation ? AGGREGATION_LABEL[m.type.aggregation] : null
  return (
    <div className="metric-detail">
      <div className="metric-meta">
        {VALUE_TYPE_LABEL[m.type.valueType]}{m.type.unit ? `, ${m.type.unit}` : ''}
        {agg ? ` · per period: ${agg.toLowerCase()}` : ''}
        {m.entries.length > 0 ? ` · since ${day(m.entries[m.entries.length - 1].date)}` : ''}
      </div>
      {line && <div className="metric-meta">{line}</div>}
      {m.entries.length === 0 ? (
        <p className="metric-meta">No values yet.</p>
      ) : (
        <ol className="metric-entries" aria-label={`${m.type.name} values`}>
          {m.entries.slice(0, limit).map((e, i) => {
            const older = m.entries[i + 1]
            const change = older ? formatChange(m.type, older.num, e.num) : null
            return (
              <li key={e.activityId}>
                <button type="button" className="metric-entry" onClick={() => onOpenNote(e.noteId)} title="Open the note">
                  <span className="metric-entry-date">{day(e.date)}</span>
                  <span className="metric-entry-value">{formatMetricValue(m.type, e.raw)}</span>
                  <span className="metric-entry-change">{change ?? ''}</span>
                  <span className="metric-entry-note">{noteLabel(e.text)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {m.entries.length > limit && (
        <button type="button" className="link-btn" onClick={() => setLimit(limit + 100)}>Show older values</button>
      )}
    </div>
  )
}
