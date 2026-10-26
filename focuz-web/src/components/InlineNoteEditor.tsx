import { useEffect, useId, useImperativeHandle, useRef, type Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { TextSelection } from '@tiptap/pm/state'
import { codeBlockView } from './CodeBlockView'
import { noteExtensions, normalizeEditorMarkdown } from '../lib/note-format/extensions'
import type { LargeCode } from '../lib/note-format/code-paste'
import { filesFromDataTransfer, hasFiles } from '../lib/clipboard'
import { INLINE_TOOLS } from '../lib/selection-format'
import { BUBBLE_OPTIONS, LinkButton, TOGGLE, ToolButton, useToolbarState } from './FullscreenNoteEditor'

export interface InlineNoteEditorHandle { focus: () => void }

/**
 * The note text in the composer, shown as it will look: bold is bold, a checklist has boxes. Typing
 * Markdown (**bold**, ~~strike~~, "[ ] ", "# ") turns into formatting as you type; selecting text
 * shows a small formatting bar. The text is stored as Markdown, the same as the full-screen editor.
 */
export default function InlineNoteEditor({
  text,
  onChange,
  onSubmit,
  placeholder,
  label,
  handle,
  onLargeCode,
}: {
  text: string
  onChange: (text: string) => void
  /** Ctrl/Cmd+Enter. */
  onSubmit: () => void
  placeholder: string
  label: string
  handle?: Ref<InlineNoteEditorHandle>
  /** Long pasted code; without it, it is pasted as a code block. */
  onLargeCode?: (c: LargeCode) => void
}) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const largeCodeRef = useRef(onLargeCode)
  largeCodeRef.current = onLargeCode
  // The last text this editor reported, so a change from outside (a reset after Create, the
  // full-screen editor) can be told apart from our own and loaded into the editor.
  const lastText = useRef(text)
  const linkInputId = useId()

  const editor = useEditor({
    extensions: noteExtensions({ placeholder, codeBlockView, onLargeCode: () => largeCodeRef.current }),
    content: text,
    contentType: 'markdown',
    autofocus: 'end',
    // Only user edits write back, so opening a note to edit never rewrites its text.
    onUpdate: ({ editor: e }) => {
      const md = normalizeEditorMarkdown(e.getMarkdown())
      lastText.current = md
      onChange(md)
    },
    editorProps: {
      attributes: { class: 'note-prose inline-editor-content', 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          submitRef.current()
          return true
        }
        return false
      },
      // Pictures are taken by the composer around the editor (the event bubbles on to it).
      handlePaste: (_view, event) => {
        const data = event.clipboardData
        return !!data && filesFromDataTransfer(data).length > 0 && !data.getData('text/plain')
      },
      handleDrop: (_view, event) => !!(event as DragEvent).dataTransfer && hasFiles((event as DragEvent).dataTransfer!),
    },
  })

  useEffect(() => {
    if (!editor || text === lastText.current) return
    lastText.current = text
    editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: false })
  }, [editor, text])

  useImperativeHandle(handle, () => ({ focus: () => { editor?.commands.focus('end') } }), [editor])

  const s = useToolbarState(editor)
  const bubbleLinkOpen = useRef(false)
  if (!editor || !s) return <div className="inline-editor" />
  const chain = () => editor.chain().focus()

  return (
    <div className="inline-editor" onClick={e => { if (e.target === e.currentTarget) editor.commands.focus('end') }}>
      <EditorContent editor={editor} />
      <BubbleMenu
        editor={editor}
        className="sel-bar"
        role="toolbar"
        aria-label="Format selection"
        options={BUBBLE_OPTIONS}
        shouldShow={({ editor: e, state, from, to }) =>
          bubbleLinkOpen.current || (from !== to && e.isFocused && state.selection instanceof TextSelection && !e.isActive('codeBlock'))}
      >
        {INLINE_TOOLS.map(t => (
          <ToolButton key={t.mark} label={t.label} shortcut={t.shortcut} active={s[t.mark]} onClick={() => chain()[TOGGLE[t.mark]]().run()}>{t.icon}</ToolButton>
        ))}
        <span className="sel-bar-sep" aria-hidden />
        <LinkButton editor={editor} active={s.link} href={s.linkHref} inputId={linkInputId} onOpenChange={o => { bubbleLinkOpen.current = o }} />
      </BubbleMenu>
    </div>
  )
}
