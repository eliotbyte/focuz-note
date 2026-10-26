import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { AGGREGATIONS, AGGREGATION_LABEL, VALUE_TYPE_LABEL, createMetric, type MetricValueType } from '../lib/metrics'
import { ApiError, isNetworkError } from '../lib/api'
import type { ActivityTypeRecord } from '../lib/types'

const KINDS: MetricValueType[] = ['float', 'integer', 'time', 'boolean', 'text']

function errorText(e: unknown): string {
  if (isNetworkError(e)) return 'No connection to the server. Creating a metric needs it; adding values works offline.'
  if (e instanceof ApiError) return (e.body as any)?.error?.message || e.message
  return e instanceof Error ? e.message : 'Could not create the metric'
}

/** Creates a metric of the space: name, kind of value, unit, and how values add up over a period. */
export default function NewMetricDialog({ spaceId, open, initialName = '', onClose, onCreated }: {
  spaceId: number
  open: boolean
  initialName?: string
  onClose: () => void
  onCreated?: (t: ActivityTypeRecord) => void
}) {
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<MetricValueType>('float')
  const [unit, setUnit] = useState('')
  const [aggregation, setAggregation] = useState(AGGREGATIONS.float[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initialName); setKind('float'); setUnit(''); setAggregation(AGGREGATIONS.float[0]); setError(null); setBusy(false)
  }, [open, initialName])

  const numeric = kind === 'float' || kind === 'integer'
  const aggs = AGGREGATIONS[kind]

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const rec = await createMetric(spaceId, { name: name.trim(), valueType: kind, unit: numeric && unit.trim() ? unit.trim() : undefined, aggregation })
      onCreated?.(rec)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4">
        <DialogTitle>New metric</DialogTitle>
        <DialogDescription className="text-sm">
          Something you track over time, such as weight or spending. Each value is kept in a note, dated like the note.
        </DialogDescription>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <div>
            <label className="auth-label block" htmlFor="metric-name">Name</label>
            <input
              id="metric-name"
              className="input w-full"
              value={name}
              maxLength={100}
              autoFocus
              placeholder="Weight"
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <div className="auth-label" id="metric-kind">Value</div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="metric-kind">
              {KINDS.map(k => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className="filter-chip-select"
                  onClick={() => { setKind(k); setAggregation(AGGREGATIONS[k][0]) }}
                >{VALUE_TYPE_LABEL[k]}</button>
              ))}
            </div>
          </div>
          {numeric && (
            <div>
              <label className="auth-label block" htmlFor="metric-unit">Unit</label>
              <input id="metric-unit" className="input w-40" value={unit} maxLength={20} placeholder="kg" onChange={e => setUnit(e.target.value)} />
            </div>
          )}
          {aggs.length > 1 && (
            <div>
              <div className="auth-label" id="metric-agg">Per day, week or month, show the</div>
              <div className="seg" role="radiogroup" aria-labelledby="metric-agg">
                {aggs.map(a => (
                  <button key={a} type="button" role="radio" aria-checked={aggregation === a} aria-pressed={aggregation === a} onClick={() => setAggregation(a)}>
                    {AGGREGATION_LABEL[a] ?? a}
                  </button>
                ))}
              </div>
              <div className="auth-hint">Average suits weight or blood values; total suits spending or steps.</div>
            </div>
          )}
          {error && <p className="settings-error" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
