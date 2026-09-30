import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import { insertLink, isMarkActive, toggleMark, type InlineMark, type TextEdit } from '../lib/markdown-wrap'
import { INLINE_TOOLS, textareaSelectionBoxes, touchScreen } from '../lib/selection-format'

// A small bar over selected text, as phones do it (see lib/selection-format for placement).

export function BarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="fse-tool"
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
      data-active={active || undefined}
      onMouseDown={e => e.preventDefault()} // keep the text selected
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Replaces the text so that Ctrl+Z still undoes it, and selects the formatted words. */
function applyEdit(ta: HTMLTextAreaElement, edit: TextEdit) {
  const old = ta.value
  let p = 0
  while (p < old.length && p < edit.text.length && old[p] === edit.text[p]) p++
  let s = 0
  while (s < old.length - p && s < edit.text.length - p && old[old.length - 1 - s] === edit.text[edit.text.length - 1 - s]) s++
  ta.focus()
  ta.setSelectionRange(p, old.length - s)
  const inserted = edit.text.slice(p, edit.text.length - s)
  // execCommand keeps the browser's undo history; it fires the input event React listens to.
  if (!document.execCommand('insertText', false, inserted)) {
    ta.setRangeText(inserted, p, old.length - s, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ta.setSelectionRange(edit.start, edit.end)
}

/**
 * Formatting bar for a Markdown textarea. Render it inside a positioned wrapper that also holds
 * the textarea: the bar is placed relative to that wrapper and scrolls with it.
 */
export function TextareaFormatBar({ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement | null> }) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<{ x: number; y: number; below: boolean; active: Record<InlineMark, boolean> } | null>(null)

  const update = useCallback(() => {
    const ta = textareaRef.current
    const wrap = ta?.offsetParent as HTMLElement | null
    if (!ta || !wrap || document.activeElement !== ta) return setAt(null)
    const boxes = textareaSelectionBoxes(ta)
    if (!boxes) return setAt(null)
    const origin = wrap.getBoundingClientRect()
    const barH = barRef.current?.offsetHeight || 44
    // Above the selection, unless it is a touch screen or there is no room at the top of the window.
    const below = touchScreen() || boxes.first.top - barH - 8 < 0
    const line = below ? boxes.last : boxes.first
    const { value, selectionStart: s, selectionEnd: e } = ta
    setAt({
      x: line.left + line.width / 2 - origin.left,
      y: (below ? line.bottom + 8 : line.top - 8) - origin.top,
      below,
      active: {
        bold: isMarkActive(value, s, e, 'bold'),
        italic: isMarkActive(value, s, e, 'italic'),
        strike: isMarkActive(value, s, e, 'strike'),
        code: isMarkActive(value, s, e, 'code'),
      },
    })
  }, [textareaRef])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    let frame = 0
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    // selectionchange covers mouse, keyboard and touch handles; blur hides the bar.
    document.addEventListener('selectionchange', schedule)
    ta.addEventListener('select', schedule)
    ta.addEventListener('blur', schedule)
    ta.addEventListener('input', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      ta.removeEventListener('select', schedule)
      ta.removeEventListener('blur', schedule)
      ta.removeEventListener('input', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [textareaRef, update])

  // Keep the bar inside the wrapper horizontally once its width is known.
  useLayoutEffect(() => {
    const bar = barRef.current
    const wrap = bar?.offsetParent as HTMLElement | null
    if (!bar || !wrap || !at) return
    const half = bar.offsetWidth / 2
    const x = Math.min(Math.max(at.x, half), Math.max(half, wrap.clientWidth - half))
    bar.style.left = `${x}px`
  }, [at])

  if (!at) return null
  const run = (fn: (text: string, s: number, e: number) => TextEdit) => {
    const ta = textareaRef.current
    if (!ta) return
    applyEdit(ta, fn(ta.value, ta.selectionStart, ta.selectionEnd))
    update()
  }
  return (
    <div
      ref={barRef}
      className="sel-bar sel-bar-anchored"
      data-below={at.below || undefined}
      style={{ left: at.x, top: at.y }}
      role="toolbar"
      aria-label="Format selection"
    >
      {INLINE_TOOLS.map(t => (
        <BarButton key={t.mark} label={t.label} active={at.active[t.mark]} onClick={() => run((text, s, e) => toggleMark(text, s, e, t.mark))}>{t.icon}</BarButton>
      ))}
      <span className="sel-bar-sep" aria-hidden />
      <BarButton label="Link" onClick={() => run(insertLink)}><LinkRoundedIcon fontSize="inherit" /></BarButton>
    </div>
  )
}
