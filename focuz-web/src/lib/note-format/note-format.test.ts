import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { noteExtensions, normalizeEditorMarkdown } from './extensions'
import { noteLabel, notePreviewText, renderNoteHtml, toggleTask } from './render'
import { codeFile, handleCodePaste, LARGE_CODE_LINES, type LargeCode } from './code-paste'
import { normalizeLanguage } from '../code-languages'

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

  it('names a note that is only pictures', () => {
    expect(noteLabel('')).toBe('Picture')
    expect(noteLabel('  ')).toBe('Picture')
    expect(noteLabel('Hi')).toBe('Hi')
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

describe('code blocks', () => {
  const editor = new Editor({ extensions: noteExtensions() })
  const roundTrip = (s: string) => {
    editor.commands.setContent(s, { contentType: 'markdown' })
    return normalizeEditorMarkdown(editor.getMarkdown())
  }

  it('keep their language through the editor', () => {
    for (const s of ['```csharp\nvar x = 1;\n```', '```python\nprint("hi")\n```', '```\nplain\n```']) {
      expect(roundTrip(s)).toBe(s)
    }
  })

  it('render coloured, escaped and labelled', () => {
    const html = renderNoteHtml('```cs\nif (a < b) { return "<x>"; }\n```')
    expect(html).toContain('data-lang="C#"')
    expect(html).toContain('class="hljs language-csharp"')
    expect(html).toContain('<span class="hljs-keyword">if</span>')
    expect(html).toContain('&lt;x&gt;')
    expect(html).not.toContain('<x>')
  })

  it('render unknown languages as plain escaped code', () => {
    const html = renderNoteHtml('```brainfuck\n<script>+++</script>\n```')
    expect(html).toContain('data-lang="brainfuck"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('know the usual names and VS Code ids', () => {
    expect(normalizeLanguage('C#')).toBe('csharp')
    expect(normalizeLanguage('py')).toBe('python')
    expect(normalizeLanguage('typescriptreact')).toBe('typescript')
    expect(normalizeLanguage('shellscript')).toBe('bash')
    expect(normalizeLanguage('cobol')).toBe(null)
  })
})

describe('pasting code', () => {
  const editor = new Editor({ extensions: noteExtensions() })
  const clip = (text: string, vscodeMode?: string) => ({
    getData: (type: string) => type === 'text/plain' ? text : type === 'vscode-editor-data' && vscodeMode ? JSON.stringify({ mode: vscodeMode }) : '',
  }) as unknown as DataTransfer
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line${i}();`).join('\n')

  it('turns short code from VS Code into a code block in its language', () => {
    editor.commands.setContent('')
    expect(handleCodePaste(editor, clip('a = 1\nb = 2', 'python'))).toBe(true)
    expect(normalizeEditorMarkdown(editor.getMarkdown())).toBe('```python\na = 1\nb = 2\n```')
  })

  it('hands long code to the composer, which can still put it back', () => {
    editor.commands.setContent('')
    let got: LargeCode | null = null
    expect(handleCodePaste(editor, clip(lines(LARGE_CODE_LINES), 'csharp'), c => { got = c })).toBe(true)
    expect(got!.language).toBe('csharp')
    expect(editor.getMarkdown()).toBe('')
    got!.keepInText()
    expect(normalizeEditorMarkdown(editor.getMarkdown())).toMatch(/^```csharp\nline0\(\);/)
  })

  it('leaves ordinary text to the normal paste', () => {
    editor.commands.setContent('')
    expect(handleCodePaste(editor, clip(lines(50)), () => { throw new Error('not code') })).toBe(false)
  })

  it('writes long code to a Markdown file with a safe fence and a free name', () => {
    const f = codeFile('a = "```"\n', 'python', ['Code (Python).md'])
    expect(f.name).toBe('Code (Python) 2.md')
    expect(f.size).toBeGreaterThan(0)
  })
})
