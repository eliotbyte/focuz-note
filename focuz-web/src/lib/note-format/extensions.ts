// Editor schema for notes. Notes are stored as Markdown (GFM task lists) in the plain `text`
// field, so the server, sync and search stay format-agnostic and old plain-text notes stay valid.
import type { AnyExtension, NodeViewRenderer } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { lowlight } from '../code-languages'
import { CodePaste, type LargeCode } from './code-paste'
import { Link } from '@tiptap/extension-link'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'

const NoteLink = Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' })

/**
 * codeBlockView: the React view of a code block (with its language list). Left out where there is
 * no React (tests), where code blocks render as plain <pre>.
 */
export function noteExtensions(opts: {
  placeholder?: string
  codeBlockView?: NodeViewRenderer
  /** Where long pasted code goes (read at paste time); without it, it is pasted as a code block. */
  onLargeCode?: () => ((c: LargeCode) => void) | undefined
} = {}): AnyExtension[] {
  const codeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null })
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false, // no Markdown equivalent
      codeBlock: false, // the highlighted one below
    }),
    opts.codeBlockView ? codeBlock.extend({ addNodeView: () => opts.codeBlockView! }) : codeBlock,
    NoteLink,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Write a note…' }),
    CodePaste.configure({ onLargeCode: opts.onLargeCode }),
    Markdown,
  ]
}

/**
 * Markdown produced by the editor, cleaned for storage: no trailing blank lines, and bare URLs
 * stay bare (the serializer writes every link as [text](href)).
 */
export function normalizeEditorMarkdown(md: string): string {
  return md
    .replace(/\[((?:https?:\/\/|mailto:)[^\]\s]+)\]\(\1\)/g, '$1')
    .replace(/\s+$/, '')
}
