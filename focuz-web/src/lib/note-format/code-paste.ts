// Pasting into a note. Code is what comes from a code editor (VS Code puts its language in
// "vscode-editor-data") or what is pasted into a code block. Short code from VS Code becomes a code
// block in that language. Long code, and long plain text, go to a file attached to the note (the
// composer decides how), with a way to keep them in the text instead.

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { languageLabel, normalizeLanguage } from '../code-languages'

/** Code of this many lines or more leaves the note's text for an attached file. */
export const LARGE_CODE_LINES = 20
/** Text leaves too at this many lines, or at this many characters: about where the composer starts to scroll (a few long paragraphs are few lines). */
export const LARGE_TEXT_LINES = 20
export const LARGE_TEXT_CHARS = 1500

export interface LargePaste {
  kind: 'code' | 'text'
  /** The pasted text, line endings normalized. */
  content: string
  /** Code only: a known language id, or null. */
  language: string | null
  /** Puts it into the note after all, where it was pasted: code as a code block, text as pasted. */
  keepInText: () => void
}

/** The language VS Code sent with the copied text, if any. */
function vscodeLanguage(data: DataTransfer): string | null | undefined {
  const raw = data.getData('vscode-editor-data')
  if (!raw) return undefined
  try { return normalizeLanguage((JSON.parse(raw) as { mode?: string }).mode) } catch { return null }
}

// "Keep in text" for plain text replays the normal paste; this lets it through the handler.
let replaying = false

export function handleCodePaste(editor: Editor, data: DataTransfer | null, onLargePaste?: (p: LargePaste) => void): boolean {
  if (!data || replaying) return false
  const raw = data.getData('text/plain')
  if (!raw) return false
  const fromEditor = vscodeLanguage(data)
  const inCodeBlock = editor.isActive('codeBlock')
  const content = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const lines = content.split('\n').length
  const at = editor.state.selection.from
  const placeAt = () => Math.min(at, editor.state.doc.content.size)

  if (fromEditor === undefined && !inCodeBlock) {
    if (!onLargePaste || (lines < LARGE_TEXT_LINES && content.length < LARGE_TEXT_CHARS)) return false
    const html = data.getData('text/html')
    onLargePaste({
      kind: 'text',
      content,
      language: null,
      keepInText: () => {
        editor.chain().focus().setTextSelection(placeAt()).run()
        replaying = true
        try { if (html) editor.view.pasteHTML(html); else editor.view.pasteText(raw) } finally { replaying = false }
      },
    })
    return true
  }

  const language = fromEditor ?? (inCodeBlock ? normalizeLanguage(editor.getAttributes('codeBlock').language) : null)
  const insertBlock = () => {
    if (inCodeBlock) editor.chain().focus().insertContentAt(placeAt(), { type: 'text', text: content }).run()
    else editor.chain().focus().insertContentAt(placeAt(), { type: 'codeBlock', attrs: { language }, content: content ? [{ type: 'text', text: content }] : [] }).run()
  }

  if (lines >= LARGE_CODE_LINES && onLargePaste) {
    onLargePaste({ kind: 'code', content, language, keepInText: insertBlock })
    return true
  }
  // Inside a code block the normal paste already keeps the text as it is.
  if (inCodeBlock || lines < 2) return false
  insertBlock()
  return true
}

/** The paste handler as an editor extension; onLargePaste is read when a paste happens. */
export const CodePaste = Extension.create<{ onLargePaste?: () => ((p: LargePaste) => void) | undefined }>({
  name: 'codePaste',
  addOptions() {
    return { onLargePaste: undefined }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const options = this.options
    return [new Plugin({
      key: new PluginKey('codePaste'),
      props: { handlePaste: (_view, event) => handleCodePaste(editor, event.clipboardData, options.onLargePaste?.()) },
    })]
  },
})

/** A free name: "<base>.md", else "<base> 2.md", "<base> 3.md"… */
function freeName(base: string, takenNames: string[]): string {
  let name = `${base}.md`
  for (let n = 2; takenNames.includes(name); n++) name = `${base} ${n}.md`
  return name
}

/** The first words of a text, fit for a file name; "Pasted text" when there are none. */
export function textFileBase(text: string): string {
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
  const words = firstLine
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f`*_~[\]#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // The first sentence, cut at a word to 40 characters.
  const sentence = words.split(/(?<=[.!?…])\s/u)[0]
  const cut = sentence.length <= 40 ? sentence : sentence.slice(0, 40)
  const lastSpace = cut.lastIndexOf(' ')
  const base = sentence.length <= 40 || lastSpace <= 20 ? cut : cut.slice(0, lastSpace)
  // No punctuation at the end: "Done." would give "Done..md".
  return base.replace(/[\s.,;!…–—-]+$/u, '') || 'Pasted text'
}

/** The Markdown file for a long paste: code as one fenced block, text as it is. */
export function pasteFile(p: Pick<LargePaste, 'kind' | 'content' | 'language'>, takenNames: string[]): File {
  if (p.kind === 'text') {
    return new File([`${p.content}\n`], freeName(textFileBase(p.content), takenNames), { type: 'text/markdown' })
  }
  // The fence is longer than any run of backticks in the code.
  const longest = Math.max(0, ...Array.from(p.content.matchAll(/`+/g), m => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const body = `${fence}${p.language ?? ''}\n${p.content}\n${fence}\n`
  return new File([body], freeName(p.language ? `Code (${languageLabel(p.language)})` : 'Code', takenNames), { type: 'text/markdown' })
}
