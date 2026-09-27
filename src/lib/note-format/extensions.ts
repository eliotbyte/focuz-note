// Editor schema for notes. Notes are stored as Markdown (GFM task lists) in the plain `text`
// field, so the server, sync and search stay format-agnostic and old plain-text notes stay valid.
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Link } from '@tiptap/extension-link'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'

const NoteLink = Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' })

export function noteExtensions(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false, // no Markdown equivalent
    }),
    NoteLink,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Write a note…' }),
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
