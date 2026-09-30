// Inline Markdown formatting of a plain-text selection (the compact editor is a textarea).
// Marks never span lines in Markdown, so a multi-line selection is formatted line by line.

export type InlineMark = 'bold' | 'italic' | 'strike' | 'code'

const MARKER: Record<InlineMark, string> = { bold: '**', italic: '*', strike: '~~', code: '`' }

/** New text plus the selection to restore (the formatted words, without the markers). */
export interface TextEdit { text: string; start: number; end: number }

function run(text: string, from: number, step: 1 | -1, ch: string): number {
  let n = 0
  for (let i = step === 1 ? from : from - 1; i >= 0 && i < text.length && text[i] === ch; i += step) n++
  return n
}

// "*" is both italic and half of bold: ***x*** is both, **x** is bold only.
function hasMark(mark: InlineMark, before: number, after: number): boolean {
  if (mark === 'italic') return before % 2 === 1 && after % 2 === 1
  const len = MARKER[mark].length
  return before >= len && after >= len
}

// One selected line: [c, d) is the text itself, markers may sit inside or outside the selection.
interface Segment { c: number; d: number; has: boolean }

function segments(text: string, start: number, end: number, mark: InlineMark): Segment[] {
  const ch = MARKER[mark][0]
  const out: Segment[] = []
  let lineStart = start
  for (let i = start; i <= end; i++) {
    if (i < end && text[i] !== '\n') continue
    let c = lineStart
    let d = i
    lineStart = i + 1
    while (c < d && /\s/.test(text[c])) c++
    while (d > c && /\s/.test(text[d - 1])) d--
    c += run(text, c, 1, ch)
    if (c >= d) continue
    d -= run(text, d, -1, ch)
    out.push({ c, d, has: hasMark(mark, run(text, c, -1, ch), run(text, d, 1, ch)) })
  }
  return out
}

/** True when every selected line already has the mark (the button shows as pressed). */
export function isMarkActive(text: string, start: number, end: number, mark: InlineMark): boolean {
  const segs = segments(text, start, end, mark)
  return segs.length > 0 && segs.every(s => s.has)
}

/** Adds the mark to the selection, or removes it when every selected line has it already. */
export function toggleMark(text: string, start: number, end: number, mark: InlineMark): TextEdit {
  const segs = segments(text, start, end, mark)
  if (segs.length === 0) return { text, start, end }
  const m = MARKER[mark]
  const len = m.length
  const remove = segs.every(s => s.has)
  let out = ''
  let cursor = 0
  let selStart = -1
  let selEnd = -1
  for (const { c, d, has } of segs) {
    if (remove) {
      out += text.slice(cursor, c - len)
      cursor = d + len
    } else {
      // Adding: lines that have the mark already stay as they are.
      out += text.slice(cursor, c) + (has ? '' : m)
      cursor = d
    }
    if (selStart < 0) selStart = out.length
    out += text.slice(c, d)
    selEnd = out.length
    if (!remove && !has) out += m
  }
  out += text.slice(cursor)
  return { text: out, start: selStart, end: selEnd }
}

/** Turns the selection into a link; the address part is selected so it can be typed over. */
export function insertLink(text: string, start: number, end: number): TextEdit {
  let a = start
  let b = end
  while (a < b && /\s/.test(text[a])) a++
  while (b > a && /\s/.test(text[b - 1])) b--
  const label = text.slice(a, b)
  const isUrl = /^(https?:\/\/|mailto:)\S+$/i.test(label)
  const url = isUrl ? label : 'https://'
  const out = `${text.slice(0, a)}[${label}](${url})${text.slice(b)}`
  const urlStart = a + label.length + 3
  // For a pasted address the label is what people want to change; otherwise the address.
  return isUrl ? { text: out, start: a + 1, end: a + 1 + label.length } : { text: out, start: urlStart, end: urlStart + url.length }
}
