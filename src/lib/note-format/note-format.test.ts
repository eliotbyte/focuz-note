import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { noteExtensions, normalizeEditorMarkdown } from './extensions'
import { notePreviewText, renderNoteHtml, toggleTask } from './render'

describe('note rendering', () => {
  it('keeps plain-text notes looking like before (line breaks, no markup)', () => {
    const html = renderNoteHtml('Купить: молоко\nхлеб\n\n<script>alert(1)</script>')
    expect(html).toContain('молоко<br>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders checklists with numbered checkboxes', () => {
    const html = renderNoteHtml('- [ ] milk\n- [x] bread\n  - [ ] nested')
    expect((html.match(/type="checkbox"/g) || []).length).toBe(3)
    expect(html).toContain('data-task-index="1" checked')
    expect(html).toContain('data-task-index="2"')
  })

  it('opens links in a new tab without referrer', () => {
    expect(renderNoteHtml('see https://example.com')).toContain('rel="noopener noreferrer nofollow"')
    expect(renderNoteHtml('[x](javascript:alert(1))')).not.toContain('href="javascript')
  })

  it('toggles the right task and skips code blocks', () => {
    const src = '- [ ] a\n```\n- [ ] not a task\n```\n1. [x] b\n* [ ] c'
    expect(toggleTask(src, 0)).toContain('- [x] a')
    expect(toggleTask(src, 1)).toContain('1. [ ] b')
    expect(toggleTask(src, 2)).toContain('* [x] c')
    expect(toggleTask(src, 2)).toContain('```\n- [ ] not a task\n```')
    expect(toggleTask(src, 9)).toBe(src)
  })

  it('makes a readable preview', () => {
    expect(notePreviewText('# Plan\n\n- [ ] **milk**\n- [x] [bread](https://x)')).toBe('Plan ☐ milk ☐ bread')
  })
})

describe('editor round trip', () => {
  const editor = new Editor({ extensions: noteExtensions() })
  const roundTrip = (s: string) => {
    editor.commands.setContent(s, { contentType: 'markdown' })
    return normalizeEditorMarkdown(editor.getMarkdown())
  }

  it('does not change plain-text notes', () => {
    for (const s of ['Купить: молоко, хлеб\nкофе в зёрнах', 'line 1\n\nline 3', 'see https://example.com today']) {
      expect(roundTrip(s)).toBe(s)
    }
  })

  it('keeps structure of formatted notes', () => {
    for (const s of ['# Title\n\nSome **bold** and ~~strike~~ and `code`', '- [ ] milk\n- [x] bread\n  - [ ] nested', '1. one\n2. two', '> quote', '[docs](https://a.b)']) {
      expect(roundTrip(s)).toBe(s)
    }
  })
})
