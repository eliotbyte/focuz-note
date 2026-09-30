import type { ReactNode } from 'react'
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import StrikethroughSRoundedIcon from '@mui/icons-material/StrikethroughSRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import type { InlineMark } from './markdown-wrap'

// A small bar over selected text, as phones do it. On touch screens it sits under the selection,
// so the system's copy/paste menu above it stays reachable.
export const touchScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export const INLINE_TOOLS: { mark: InlineMark; label: string; shortcut: string; icon: ReactNode }[] = [
  { mark: 'bold', label: 'Bold', shortcut: 'Mod-B', icon: <FormatBoldRoundedIcon fontSize="inherit" /> },
  { mark: 'italic', label: 'Italic', shortcut: 'Mod-I', icon: <FormatItalicRoundedIcon fontSize="inherit" /> },
  { mark: 'strike', label: 'Strikethrough', shortcut: 'Mod-Shift-S', icon: <StrikethroughSRoundedIcon fontSize="inherit" /> },
  { mark: 'code', label: 'Code', shortcut: 'Mod-E', icon: <CodeRoundedIcon fontSize="inherit" /> },
]

const MIRRORED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing',
  'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
] as const

/** Where the selected text of a textarea is drawn: its first and last line boxes (viewport coordinates). */
export function textareaSelectionBoxes(ta: HTMLTextAreaElement): { first: DOMRect; last: DOMRect } | null {
  const { selectionStart: start, selectionEnd: end, value } = ta
  if (start === end) return null
  const cs = getComputedStyle(ta)
  const mirror = document.createElement('div')
  for (const p of MIRRORED) mirror.style[p] = cs[p]
  Object.assign(mirror.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden', overflow: 'hidden', height: 'auto', whiteSpace: 'pre-wrap' })
  const mark = document.createElement('span')
  mark.textContent = value.slice(start, end)
  mirror.append(value.slice(0, start), mark, value.slice(end))
  document.body.append(mirror)
  const base = mirror.getBoundingClientRect()
  const rects = Array.from(mark.getClientRects()).filter(r => r.width > 0)
  mirror.remove()
  if (rects.length === 0) return null
  const box = ta.getBoundingClientRect()
  const place = (r: DOMRect) => new DOMRect(box.left + r.left - base.left - ta.scrollLeft, box.top + r.top - base.top - ta.scrollTop, r.width, r.height)
  return { first: place(rects[0]), last: place(rects[rects.length - 1]) }
}

