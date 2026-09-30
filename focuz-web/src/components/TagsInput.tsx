import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { tags as tagsRepo } from '../data'

export default function TagsInput({ value, onChange, placeholder, className, spaceId, invertible = false }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string; className?: string; spaceId?: number; invertible?: boolean }) {
  const MAX_LEN = 20
  const [draft, setDraft] = useState<string>('')
  const [focused, setFocused] = useState<boolean>(false)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    // Keep draft trimmed of delimiter-only strings
    if (draft.trim() === '' && draft.length > 0) setDraft('')
  }, [draft])

  function normalizeBase(tagText: string): string {
    return tagText.startsWith('!') ? tagText.slice(1) : tagText
  }

  // Sanitize draft input while typing
  function sanitizeDraftInput(raw: string): string {
    const allowedLetterOrDigit = /[A-Za-zА-Яа-яЁё0-9]/
    let out = ''
    let prev: string | null = null
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (invertible && i === 0 && ch === '!') {
        // allow leading '!'
        if (out.startsWith('!')) continue
        out += '!'
        prev = '!'
        continue
      }
      if (allowedLetterOrDigit.test(ch)) {
        const base = invertible && out.startsWith('!') ? out.slice(1) : out
        if (base.length >= MAX_LEN) continue
        out += ch
        prev = ch
        continue
      }
      if ((ch === '-' || ch === '_')) {
        // cannot be first (ignores if no leading alnum yet)
        const base = invertible && out.startsWith('!') ? out.slice(1) : out
        if (base.length === 0) continue
        // prevent any two special chars in a row ("-", "_" in any order)
        if (prev === '-' || prev === '_') continue
        if (base.length >= MAX_LEN) continue
        out += ch
        prev = ch
        continue
      }
      // ignore all other characters
    }
    return out
  }

  // Normalize a completed tag base to meet constraints, return '' if invalid
  function normalizeFinalBase(rawBase: string): string {
    if (!rawBase) return ''
    // remove leading non-alnum
    let s = rawBase.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '')
    if (!s) return ''
    // reject any adjacent special chars (including mixed -_ or _-)
    if (/[-_]{2,}/.test(s)) return ''
    // enforce max length
    if (s.length > MAX_LEN) return ''
    // trim trailing non-alnum
    s = s.replace(/[^A-Za-zА-Яа-яЁё0-9]+$/, '')
    // ensure starts and ends with alnum
    if (!/^[A-Za-zА-Яа-яЁё0-9].*[A-Za-zА-Яа-яЁё0-9]$/.test(s)) {
      if (/^[A-Za-zА-Яа-яЁё0-9]$/.test(s)) return s
      return ''
    }
    return s
  }

  function draftFromSuggestion(name: string, keepBang: boolean, currentDraft: string): string {
    let base = name || ''
    if (base.length > MAX_LEN) base = base.slice(0, MAX_LEN)
    base = base.replace(/[^A-Za-zА-Яа-яЁё0-9]+$/, '')
    const bang = invertible && keepBang && currentDraft.trim().startsWith('!') ? '!' : ''
    return bang + base
  }

  function pushTag(tagText: string) {
    const token = tagText.trim()
    if (!token) return
    // Handle invertible '!' prefix and validate base
    const hasBang = invertible && token.startsWith('!')
    const baseRaw = hasBang ? token.slice(1) : token
    const base = normalizeFinalBase(baseRaw)
    if (!base) return
    const final = hasBang ? ('!' + base) : base
    const next = Array.from(new Set([...value, final]))
    onChange(next)
    setDraft('')
    setSelectedIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === ';' || e.key === ',' || e.key === '.') {
      e.preventDefault()
      pushTag(draft)
      return
    }
    if (e.key === 'ArrowDown') {
      const list = suggestions
      if (!list.length) return
      e.preventDefault()
      const nextIdx = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, list.length - 1)
      setSelectedIdx(nextIdx)
      if (invertible) setDraft(draftFromSuggestion(list[nextIdx], true, draft))
      else setDraft(draftFromSuggestion(list[nextIdx], false, draft))
      return
    }
    if (e.key === 'ArrowUp') {
      const list = suggestions
      if (!list.length) return
      e.preventDefault()
      const nextIdx = selectedIdx <= 0 ? 0 : selectedIdx - 1
      setSelectedIdx(nextIdx)
      if (invertible) setDraft(draftFromSuggestion(list[nextIdx], true, draft))
      else setDraft(draftFromSuggestion(list[nextIdx], false, draft))
      return
    }
    if (e.key === 'Enter') {
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        e.preventDefault()
        const chosen = suggestions[selectedIdx]
        const final = invertible && draft.trim().startsWith('!') ? ('!' + chosen) : chosen
        pushTag(final)
        return
      }
    }
    if (e.key === 'Backspace' && draft === '') {
      const last = value[value.length - 1]
      if (last) {
        e.preventDefault()
        onChange(value.slice(0, -1))
        setDraft(last)
        // focus stays on input
      }
    }
  }

  function handleBlur() {
    setFocused(false)
    if (draft.trim()) pushTag(draft)
  }

  function removeTag(idx: number) {
    const next = value.filter((_, i) => i !== idx)
    onChange(next)
  }

  function toggleInvertTag(idx: number) {
    const tag = value[idx]
    const toggled = tag.startsWith('!') ? tag.slice(1) : ('!' + normalizeBase(tag))
    const next = value.slice()
    next[idx] = toggled
    onChange(next)
  }

  const containerClasses = useMemo(() => {
    const base = 'input min-h-10 py-1 flex items-center gap-2 flex-wrap'
    return className ? `${base} ${className}` : base
  }, [className])

  // Build last-used map from recent notes and compute suggestions from tags directory
  const suggestions = useLiveQuery(async () => {
    if (!spaceId) return [] as string[]
    return tagsRepo.suggest({
      spaceId,
      selected: value,
      query: draft,
      invertible,
      limit: 10,
    })
  }, [spaceId, draft, invertible, JSON.stringify(value)]) || []

  const menuOpen = focused && !!spaceId && suggestions.length > 0

  useEffect(() => {
    if (!menuOpen) { setMenuRect(null); return }
    if (typeof window === 'undefined') return

    const update = () => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setMenuRect({ left: r.left, top: r.bottom + 8, width: r.width })
    }

    update()
    window.addEventListener('resize', update)
    // capture scroll from nested scroll containers too (Quick filters panel has overflow-y-auto)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [menuOpen, suggestions.length])

  return (
    <div className="w-full relative" ref={containerRef}>
      <div className={containerClasses} onClick={() => inputRef.current?.focus()}>
        {value.map((tag, idx) => (
          <span key={`${tag}-${idx}`} className="pill pill-accent pill-tag gap-2">
            {invertible ? (
              <button
                type="button"
                className="inline-flex items-center gap-1"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleInvertTag(idx) }}
                title={tag.startsWith('!') ? 'Include tag' : 'Exclude tag'}
                aria-label={tag.startsWith('!') ? 'Include tag' : 'Exclude tag'}
              >
                <span>{tag.startsWith('!') ? tag : tag}</span>
              </button>
            ) : (
              <span>{tag}</span>
            )}
            <button
              type="button"
              className="text-secondary hover:text-primary"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeTag(idx) }}
              aria-label="Remove tag"
              title="Remove"
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="bg-transparent outline-none flex-1 min-w-24 text-primary"
          value={draft}
          placeholder={value.length === 0 ? (placeholder || 'Add tags') : ''}
          onChange={e => {
            const sanitized = sanitizeDraftInput(e.target.value)
            setDraft(sanitized)
            setSelectedIdx(-1)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        />
      </div>
      {menuOpen && menuRect && createPortal(
        <div
          className="dropdown-menu z-[200]"
          style={{ position: 'fixed', left: menuRect.left, top: menuRect.top, width: menuRect.width }}
        >
          <div className="max-h-60 overflow-auto">
            {suggestions.map((s, i) => (
              <button
                key={`${s}-${i}`}
                type="button"
                className={`dropdown-item ${i === selectedIdx ? 'text-primary' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { const final = invertible && draft.trim().startsWith('!') ? ('!' + s) : s; pushTag(final) }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
} 