// Renders a note (Markdown, or legacy plain text) to HTML for the feed.
// Raw HTML in notes is disabled, so note text can never inject markup or scripts.
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

// Links open in a new tab and never leak the app URL.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer nofollow')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// GFM task lists: "- [ ] text" / "- [x] text" become checkboxes numbered in document order,
// matching the order used by toggleTask().
md.core.ruler.after('inline', 'task-lists', state => {
  let index = 0
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const first = inline.children?.[0]
    const m = first?.type === 'text' ? /^\[([ xX])\][ \u00a0]/.exec(first.content) : null
    if (!m || !first) continue
    const checked = m[1] !== ' '
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input type="checkbox" class="note-task-box" data-task-index="${index}"${checked ? ' checked' : ''} aria-label="${checked ? 'Done' : 'To do'}">`
    inline.children!.unshift(box)
    tokens[i - 2].attrJoin('class', `note-task${checked ? ' is-done' : ''}`)
    // mark the list itself for styling
    for (let j = i - 3; j >= 0; j--) {
      const t = tokens[j]
      if ((t.type === 'bullet_list_open' || t.type === 'ordered_list_open') && t.level === tokens[i - 2].level - 1) { t.attrJoin('class', 'note-task-list'); break }
    }
    index++
  }
})

export function renderNoteHtml(text: string): string {
  return md.render(text ?? '')
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=[ \u00a0])/

/** Toggles the n-th task checkbox (document order, fenced code ignored) in the note source. */
export function toggleTask(text: string, taskIndex: number): string {
  const lines = text.split('\n')
  let inFence = false
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue }
    if (inFence) continue
    const m = TASK_RE.exec(lines[i])
    if (!m) continue
    if (n === taskIndex) {
      const next = m[2] === ' ' ? 'x' : ' '
      lines[i] = `${m[1]}[${next}]${lines[i].slice(m[0].length)}`
      return lines.join('\n')
    }
    n++
  }
  return text
}

/** True when the note has at least one unticked checklist item (outside fenced code). */
export function hasOpenTasks(text: string): boolean {
  if (!text || !text.includes('[ ]')) return false
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = TASK_RE.exec(line)
    if (m && m[2] === ' ') return true
  }
  return false
}

/** Short plain-text preview (for reply pills etc.). */
export function notePreviewText(text: string): string {
  return (text ?? '')
    .replace(/^\s*```[\s\S]*?```/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/gm, '☐ ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
