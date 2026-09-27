import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activityTypes as activityTypesRepo } from '../data'
import { parseDurationToMs, formatDurationShort } from '../lib/time'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './ui/dropdown-menu'

export type ActivityDraft = { typeId: number; valueRaw: string }

export default function ActivitiesInput({
  value,
  onChange,
  spaceId,
  placeholder = 'Add activity',
  hideAddButton,
  menuOnly,
  onAddedType,
  requestEditTypeId,
  onEditRequestHandled,
}: {
  value: ActivityDraft[]
  onChange: (next: ActivityDraft[]) => void
  spaceId?: number
  placeholder?: string
  hideAddButton?: boolean
  menuOnly?: boolean
  onAddedType?: (typeId: number) => void
  requestEditTypeId?: number | null
  onEditRequestHandled?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [timeDraftText, setTimeDraftText] = useState<string>('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const activityTypes = (useLiveQuery(async () => {
    return activityTypesRepo.listForSpace(spaceId)
  }, [spaceId]) || [])

  const byId = useMemo(() => new Map(activityTypes.map(t => [t.serverId!, t])), [activityTypes])
  const items = value

  const availableTypes = useMemo(() => {
    const existing = new Set(items.map(i => i.typeId))
    return activityTypes.filter(t => !existing.has(t.serverId!))
  }, [activityTypes, JSON.stringify(items.map(i => i.typeId))])

  function clampNumber(v: number, min?: number | null, max?: number | null): number {
    let out = v
    if (typeof min === 'number') out = Math.max(out, min)
    if (typeof max === 'number') out = Math.min(out, max)
    return out
  }

  function sanitizeIntegerInput(raw: string, allowMinus: boolean): string {
    let s = raw.replace(/[^0-9-]/g, '')
    if (!allowMinus) s = s.replace(/-/g, '')
    // keep only leading minus
    if (s.indexOf('-') > 0) s = s.replace(/-/g, '')
    return s
  }

  function sanitizeFloatInput(raw: string, allowMinus: boolean): string {
    let s = raw.replace(/[^0-9-.]/g, '')
    if (!allowMinus) s = s.replace(/-/g, '')
    // keep only leading minus
    if (s.indexOf('-') > 0) s = s.replace(/-/g, '')
    // keep only first dot
    const firstDot = s.indexOf('.')
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
    }
    return s
  }

  

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest?.('[data-actmenu="1"]')) setMenuOpen(false)
      if (!target.closest?.('[data-actedit="1"]')) {
        if (editingIdx != null) {
          const draft = items[editingIdx]
          const t = byId.get(draft.typeId)
          const vt = t?.valueType
          const minV = t?.minValue ?? null
          const maxV = t?.maxValue ?? null
          if (vt === 'time') {
            const parsed = parseDurationToMs(timeDraftText || draft.valueRaw)
            if (Number.isFinite(parsed)) {
              const clamped = clampNumber(Math.round(parsed), minV, maxV)
              const next = items.slice()
              next[editingIdx] = { ...next[editingIdx], valueRaw: String(clamped) }
              onChange(next)
            }
          } else if (vt === 'integer' || vt === 'float') {
            const parseFn = vt === 'integer' ? (s: string) => (s === '-' ? NaN : Number.parseInt(s, 10)) : (s: string) => Number(s)
            const num = parseFn(draft.valueRaw)
            if (Number.isFinite(num)) {
              const clamped = clampNumber(num as number, minV, maxV)
              const next = items.slice()
              next[editingIdx] = { ...next[editingIdx], valueRaw: vt === 'integer' ? String(Math.trunc(clamped)) : String(clamped) }
              onChange(next)
            }
          }
          setEditingIdx(null)
        }
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen, editingIdx, items, byId, timeDraftText])

  // Initialize time editor text when switching which activity is being edited
  useEffect(() => {
    if (editingIdx == null) return
    const draft = items[editingIdx]
    const t = byId.get(draft.typeId)
    if (t?.valueType === 'time') {
      const raw = draft.valueRaw
      const numMs = Number(raw)
      if (Number.isFinite(numMs)) {
        setTimeDraftText(formatDurationShort(numMs))
        return
      }
      const parsed = parseDurationToMs(String(raw))
      if (Number.isFinite(parsed)) {
        setTimeDraftText(formatDurationShort(parsed))
        return
      }
      setTimeDraftText(raw || '')
    } else {
      setTimeDraftText('')
    }
  }, [editingIdx, items, byId])

  // React to external edit requests (e.g., added from menu-only picker)
  useEffect(() => {
    if (requestEditTypeId == null) return
    const idx = items.findIndex(it => it.typeId === requestEditTypeId)
    if (idx >= 0) {
      setEditingIdx(idx)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
    onEditRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestEditTypeId])

  function addType(typeId: number) {
    setMenuOpen(false)
    const exists = items.find(i => i.typeId === typeId)
    if (exists) {
      if (!menuOnly) {
        const idx = items.indexOf(exists)
        setEditingIdx(idx)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
      return
    }
    const next = [...items, { typeId, valueRaw: '' }]
    onChange(next)
    onAddedType?.(typeId)
    if (!menuOnly) {
      setEditingIdx(next.length - 1)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  if (menuOnly) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          Activity
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56" data-actmenu="1">
          <div className="max-h-60 overflow-auto">
            {availableTypes.length === 0 ? (
              <DropdownMenuItem disabled>All activities added</DropdownMenuItem>
            ) : (
              availableTypes.map(t => (
                <DropdownMenuItem key={t.serverId!} onSelect={() => addType(t.serverId!)}>
                  {t.name}
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <div className="space-y-2" ref={rootRef} data-actedit="1">
      {!menuOnly && items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((it, idx) => {
            const t = byId.get(it.typeId)
            const label = t ? t.name : `#${it.typeId}`
            const valueDisplay = (() => {
              if (t?.valueType === 'time') {
                const numMs = Number(it.valueRaw)
                if (Number.isFinite(numMs)) return formatDurationShort(numMs)
                const parsed = parseDurationToMs(String(it.valueRaw))
                if (Number.isFinite(parsed)) return formatDurationShort(parsed)
              }
              return it.valueRaw || '…'
            })()
            return (
              <button
                key={`${it.typeId}`}
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-1 text-xs text-secondary hover:bg-neutral-700 select-none"
                onClick={() => { setEditingIdx(idx); setTimeout(() => inputRef.current?.focus(), 0) }}
                title={label}
              >
                <span className="text-neutral-300">{label}:</span>
                <span className="text-neutral-200">{valueDisplay}</span>
                <span
                  className="ml-1 text-neutral-400 hover:text-neutral-200 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const next = items.filter((_, i) => i !== idx)
                    onChange(next)
                    if (editingIdx === idx) setEditingIdx(null)
                  }}
                  aria-label="Remove activity"
                  title="Remove"
                >×</span>
              </button>
            )
          })}
        </div>
      )}
      {!menuOnly && editingIdx != null && items[editingIdx] && (() => {
        const draft = items[editingIdx]
        const t = byId.get(draft.typeId)
        const vt = t?.valueType
        const minV = t?.minValue ?? null
        const maxV = t?.maxValue ?? null
        if (vt === 'time') {
          const placeholderText = 'e.g. 1h 2m 3s 250ms or 1:02:03.250'
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">{t?.name}</span>
              <input
                ref={inputRef}
                className="input h-7 text-sm"
                placeholder={placeholderText}
                value={timeDraftText}
                onChange={e => {
                  setTimeDraftText(e.target.value)
                }}
                onBlur={() => {
                  const parsed = parseDurationToMs(timeDraftText || draft.valueRaw)
                  if (!Number.isFinite(parsed)) return
                  const clamped = clampNumber(Math.round(parsed), minV, maxV)
                  const next = items.slice()
                  next[editingIdx] = { ...next[editingIdx], valueRaw: String(clamped) }
                  onChange(next)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const parsed = parseDurationToMs(timeDraftText || draft.valueRaw)
                    if (Number.isFinite(parsed)) {
                      const clamped = clampNumber(Math.round(parsed), minV, maxV)
                      const next = items.slice()
                      next[editingIdx] = { ...next[editingIdx], valueRaw: String(clamped) }
                      onChange(next)
                    }
                    setEditingIdx(null)
                  }
                  if (e.key === 'Escape') setEditingIdx(null)
                }}
              />
            </div>
          )
        }
        if (vt === 'integer' || vt === 'float') {
          const allowMinus = typeof minV === 'number' ? (minV < 0) : true
          const sanitizer = vt === 'integer' ? sanitizeIntegerInput : sanitizeFloatInput
          const parseFn = vt === 'integer' ? (s: string) => (s === '-' ? NaN : Number.parseInt(s, 10)) : (s: string) => Number(s)
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">{t?.name}</span>
              <input
                ref={inputRef}
                className="input h-7 text-sm"
                placeholder={placeholder}
                inputMode={vt === 'integer' ? 'numeric' : 'decimal'}
                value={draft.valueRaw}
                onChange={e => {
                  const raw = sanitizer(e.target.value, allowMinus)
                  const next = items.slice()
                  next[editingIdx] = { ...next[editingIdx], valueRaw: raw }
                  onChange(next)
                }}
                onBlur={() => {
                  const num = parseFn(draft.valueRaw)
                  if (!Number.isFinite(num)) return
                  const clamped = clampNumber(num as number, minV, maxV)
                  const next = items.slice()
                  next[editingIdx] = { ...next[editingIdx], valueRaw: vt === 'integer' ? String(Math.trunc(clamped)) : String(clamped) }
                  onChange(next)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const num = parseFn(draft.valueRaw)
                    if (Number.isFinite(num)) {
                      const clamped = clampNumber(num as number, minV, maxV)
                      const next = items.slice()
                      next[editingIdx] = { ...next[editingIdx], valueRaw: vt === 'integer' ? String(Math.trunc(clamped)) : String(clamped) }
                      onChange(next)
                    }
                    setEditingIdx(null)
                  }
                  if (e.key === 'Escape') setEditingIdx(null)
                }}
              />
            </div>
          )
        }
        // default: text
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">{t?.name}</span>
            <input
              ref={inputRef}
              className="input h-7 text-sm"
              placeholder={placeholder}
              value={draft.valueRaw}
              onChange={e => {
                const v = e.target.value
                const next = items.slice()
                next[editingIdx] = { ...next[editingIdx], valueRaw: v }
                onChange(next)
              }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIdx(null) }}
            />
          </div>
        )
      })()}
      {!hideAddButton && activityTypes.length > 0 && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="button button-secondary" data-actmenu="1">Activity ▾</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" data-actmenu="1" align="start">
            <div className="max-h-60 overflow-auto">
              {availableTypes.length === 0 ? (
                <DropdownMenuItem disabled>All activities added</DropdownMenuItem>
              ) : (
                availableTypes.map(t => (
                  <DropdownMenuItem key={t.serverId!} onSelect={() => addType(t.serverId!)}>
                    {t.name}
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}


