// Pasting code into a note. Code is what comes from a code editor (VS Code puts its language in
// "vscode-editor-data") or what is pasted into a code block. Short code from VS Code becomes a code
// block in that language; long code goes to a file attached to the note (the composer decides how),
// with a way to keep it in the text instead.

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { languageLabel, normalizeLanguage } from '../code-languages'

/** Code of this many lines or more leaves the note's text for an attached file. */
export const LARGE_CODE_LINES = 20

export interface LargeCode {
  code: string
  /** A known language id, or null. */
  language: string | null
  /** Puts the code into the note as a code block after all, where it was pasted. */
  keepInText: () => void
}

/** The language VS Code sent with the copied text, if any. */
function vscodeLanguage(data: DataTransfer): string | null | undefined {
  const raw = data.getData('vscode-editor-data')
  if (!raw) return undefined
  try { return normalizeLanguage((JSON.parse(raw) as { mode?: string }).mode) } catch { return null }
}

export function handleCodePaste(editor: Editor, data: DataTransfer | null, onLargeCode?: (c: LargeCode) => void): boolean {
  if (!data) return false
  const text = data.getData('text/plain')
  if (!text) return false
  const fromEditor = vscodeLanguage(data)
  const inCodeBlock = editor.isActive('codeBlock')
  if (fromEditor === undefined && !inCodeBlock) return false

  const code = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const lines = code.split('\n').length
  const language = fromEditor ?? (inCodeBlock ? normalizeLanguage(editor.getAttributes('codeBlock').language) : null)
  const at = editor.state.selection.from
  const insertBlock = () => {
    const pos = Math.min(at, editor.state.doc.content.size)
    if (inCodeBlock) editor.chain().focus().insertContentAt(pos, { type: 'text', text: code }).run()
    else editor.chain().focus().insertContentAt(pos, { type: 'codeBlock', attrs: { language }, content: code ? [{ type: 'text', text: code }] : [] }).run()
  }

  if (lines >= LARGE_CODE_LINES && onLargeCode) {
    onLargeCode({ code, language, keepInText: insertBlock })
    return true
  }
  // Inside a code block the normal paste already keeps the text as it is.
  if (inCodeBlock || lines < 2) return false
  insertBlock()
  return true
}

/** The paste handler as an editor extension; onLargeCode is read when a paste happens. */
export const CodePaste = Extension.create<{ onLargeCode?: () => ((c: LargeCode) => void) | undefined }>({
  name: 'codePaste',
  addOptions() {
    return { onLargeCode: undefined }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const options = this.options
    return [new Plugin({
      key: new PluginKey('codePaste'),
      props: { handlePaste: (_view, event) => handleCodePaste(editor, event.clipboardData, options.onLargeCode?.()) },
    })]
  },
})

/** A Markdown file holding one code block: the fence is longer than any run of backticks in the code. */
export function codeFile(code: string, language: string | null, takenNames: string[]): File {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), m => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const body = `${fence}${language ?? ''}\n${code}\n${fence}\n`
  const base = language ? `Code (${languageLabel(language)})` : 'Code'
  let name = `${base}.md`
  for (let n = 2; takenNames.includes(name); n++) name = `${base} ${n}.md`
  return new File([body], name, { type: 'text/markdown' })
}
