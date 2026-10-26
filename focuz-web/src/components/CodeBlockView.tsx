import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { CODE_LANGUAGES, languageLabel, normalizeLanguage } from '../lib/code-languages'

/** A code block in the note editors: the code, and its language as a list in the top-right corner. */
function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const written = (node.attrs.language as string | null) ?? ''
  const known = normalizeLanguage(written)
  // A name we have no grammar for (written by hand) stays as it is and stays selectable.
  const value = known ?? written
  return (
    <NodeViewWrapper as="pre" className="note-code is-editing">
      <select
        contentEditable={false}
        className="code-lang"
        value={value}
        onChange={e => updateAttributes({ language: e.target.value || null })}
        disabled={!editor.isEditable}
        aria-label="Code language"
        title="Code language"
      >
        <option value="">No language</option>
        {CODE_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        {written && !known && <option value={written}>{languageLabel(written)}</option>}
      </select>
      <NodeViewContent<'code'> as="code" className={known ? `hljs language-${known}` : undefined} />
    </NodeViewWrapper>
  )
}

export const codeBlockView = ReactNodeViewRenderer(CodeBlockView)
