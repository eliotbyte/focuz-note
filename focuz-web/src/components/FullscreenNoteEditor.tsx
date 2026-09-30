import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { noteExtensions, normalizeEditorMarkdown } from '../lib/note-format/extensions'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import RedoRoundedIcon from '@mui/icons-material/RedoRounded'
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded'
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import StrikethroughSRoundedIcon from '@mui/icons-material/StrikethroughSRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import DataObjectRoundedIcon from '@mui/icons-material/DataObjectRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import TitleRoundedIcon from '@mui/icons-material/TitleRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
/** Shortcut label for the current platform: "Mod-Shift-B" -> "Ctrl+Shift+B" / "⌘⇧B". */
function keys(spec: string): string {
  const parts = spec.split('-')
  if (isMac) return parts.map(p => ({ Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↩' } as Record<string, string>)[p] ?? p).join('')
  return parts.map(p => (p === 'Mod' ? 'Ctrl' : p)).join('+')
}

function Kbd({ spec }: { spec: string }) {
  return <span className="fse-kbd">{keys(spec)}</span>
}

function ToolButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="fse-tool"
      aria-label={label}
      title={shortcut ? `${label} (${keys(shortcut)})` : label}
      aria-pressed={active ?? undefined}
      data-active={active || undefined}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()} // keep the editor selection
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: !!e?.can().undo(),
      canRedo: !!e?.can().redo(),
      bold: !!e?.isActive('bold'),
      italic: !!e?.isActive('italic'),
      strike: !!e?.isActive('strike'),
      code: !!e?.isActive('code'),
      bulletList: !!e?.isActive('bulletList'),
      orderedList: !!e?.isActive('orderedList'),
      taskList: !!e?.isActive('taskList'),
      link: !!e?.isActive('link'),
      linkHref: (e?.getAttributes('link').href as string | undefined) ?? '',
      heading: [1, 2, 3].find(l => e?.isActive('heading', { level: l })) ?? 0,
      blockquote: !!e?.isActive('blockquote'),
      codeBlock: !!e?.isActive('codeBlock'),
    }),
  })
}

function LinkButton({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  useEffect(() => { if (open) setUrl(href || '') }, [open, href])
  function apply(e: React.FormEvent) {
    e.preventDefault()
    const v = url.trim()
    if (!v) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else {
      const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
      if (editor.state.selection.empty && !active) {
        editor.chain().focus().insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href: withProtocol } }] }).run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: withProtocol }).run()
      }
    }
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="fse-tool" aria-label="Link" title={`Link (${keys('Mod-K')})`} data-active={active || undefined} onMouseDown={e => e.preventDefault()}>
          <LinkRoundedIcon fontSize="inherit" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-3 w-80 fse-popover" onOpenAutoFocus={e => { e.preventDefault(); requestAnimationFrame(() => document.getElementById('fse-link-input')?.focus()) }}>
        <form onSubmit={apply} className="flex flex-col gap-2">
          <label htmlFor="fse-link-input" className="text-sm font-semibold">Link address</label>
          <input id="fse-link-input" className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="example.com" autoComplete="off" inputMode="url" />
          <div className="flex justify-between gap-2">
            {active ? (
              <button type="button" className="fse-text-btn" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setOpen(false) }}>
                <LinkOffRoundedIcon fontSize="inherit" className="icon-sm" /> Remove
              </button>
            ) : <span />}
            <button type="submit" className="button">Apply</button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export interface FullscreenNoteEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initialText: string
  onTextChange: (text: string) => void
  onSubmit: () => void
  submitLabel: string
  canSubmit: boolean
  onPickImage?: () => void
  imagesDisabled?: boolean
  /** Tags input, attachment thumbnails etc., shown under the text. */
  footer?: ReactNode
  placeholder?: string
}

/** Full-window note editor (rich text, stored as Markdown). */
export default function FullscreenNoteEditor(props: FullscreenNoteEditorProps) {
  const { open, onOpenChange, title } = props
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fse-overlay" />
        <DialogPrimitive.Content className="fse" aria-describedby={undefined} onOpenAutoFocus={e => e.preventDefault()}>
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {open ? <EditorBody {...props} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function EditorBody({ initialText, onTextChange, onSubmit, submitLabel, canSubmit, onPickImage, imagesDisabled, footer, placeholder, onOpenChange }: FullscreenNoteEditorProps) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const canSubmitRef = useRef(canSubmit)
  canSubmitRef.current = canSubmit

  const editor = useEditor({
    extensions: noteExtensions({ placeholder }),
    content: initialText,
    contentType: 'markdown',
    autofocus: 'end',
    // Only user edits write back, so opening and closing a note never rewrites its text.
    onUpdate: ({ editor: e }) => onTextChange(normalizeEditorMarkdown(e.getMarkdown())),
    editorProps: {
      attributes: { class: 'note-prose fse-content', 'aria-label': 'Note text', 'aria-multiline': 'true', role: 'textbox' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          if (canSubmitRef.current) submitRef.current()
          return true
        }
        if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          document.querySelector<HTMLButtonElement>('.fse-tool[aria-label="Link"]')?.click()
          return true
        }
        return false
      },
    },
  })
  const s = useToolbarState(editor)
  if (!editor || !s) return null
  const chain = () => editor.chain().focus()

  return (
    <div className="fse-frame">
      <div className="fse-toolbar" role="toolbar" aria-label="Formatting">
        <div className="fse-group">
          <ToolButton label="Undo" shortcut="Mod-Z" disabled={!s.canUndo} onClick={() => chain().undo().run()}><UndoRoundedIcon fontSize="inherit" /></ToolButton>
          <ToolButton label="Redo" shortcut={isMac ? 'Mod-Shift-Z' : 'Mod-Y'} disabled={!s.canRedo} onClick={() => chain().redo().run()}><RedoRoundedIcon fontSize="inherit" /></ToolButton>
        </div>
        <div className="fse-group">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="fse-tool" aria-label="Text style" title="Text style" data-active={(s.heading || s.blockquote || s.codeBlock) || undefined} onMouseDown={e => e.preventDefault()}>
                <TextFieldsRoundedIcon fontSize="inherit" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="fse-menu" onCloseAutoFocus={e => { e.preventDefault(); editor.commands.focus() }}>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="fse-menu-item"><TitleRoundedIcon fontSize="inherit" className="icon-sm" /><span>Heading</span></DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="fse-menu">
                  {[1, 2, 3].map(l => (
                    <DropdownMenuItem key={l} className="fse-menu-item" data-active={s.heading === l || undefined} onSelect={() => chain().toggleHeading({ level: l as 1 | 2 | 3 }).run()}>
                      <span className={`fse-h fse-h${l}`}>H{l}</span><span>Heading {l}</span><Kbd spec={`Mod-Alt-${l}`} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem className="fse-menu-item" data-active={(!s.heading && !s.blockquote && !s.codeBlock) || undefined} onSelect={() => chain().setParagraph().run()}>
                <NotesRoundedIcon fontSize="inherit" className="icon-sm" /><span>Text</span><Kbd spec="Mod-Alt-0" />
              </DropdownMenuItem>
              <DropdownMenuItem className="fse-menu-item" data-active={s.blockquote || undefined} onSelect={() => chain().toggleBlockquote().run()}>
                <FormatQuoteRoundedIcon fontSize="inherit" className="icon-sm" /><span>Quote</span><Kbd spec="Mod-Shift-B" />
              </DropdownMenuItem>
              <DropdownMenuItem className="fse-menu-item" data-active={s.codeBlock || undefined} onSelect={() => chain().toggleCodeBlock().run()}>
                <DataObjectRoundedIcon fontSize="inherit" className="icon-sm" /><span>Code block</span><Kbd spec="Mod-Alt-C" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="fse-menu-item" onSelect={() => chain().setHorizontalRule().run()}>
                <HorizontalRuleRoundedIcon fontSize="inherit" className="icon-sm" /><span>Divider</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="fse-tool" aria-label="Text formatting" title="Bold, italic…" data-active={(s.bold || s.italic || s.strike || s.code) || undefined} onMouseDown={e => e.preventDefault()}>
                <FormatBoldRoundedIcon fontSize="inherit" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="fse-menu" onCloseAutoFocus={e => { e.preventDefault(); editor.commands.focus() }}>
              <DropdownMenuItem className="fse-menu-item" data-active={s.bold || undefined} onSelect={() => chain().toggleBold().run()}>
                <FormatBoldRoundedIcon fontSize="inherit" className="icon-sm" /><span>Bold</span><Kbd spec="Mod-B" />
              </DropdownMenuItem>
              <DropdownMenuItem className="fse-menu-item" data-active={s.italic || undefined} onSelect={() => chain().toggleItalic().run()}>
                <FormatItalicRoundedIcon fontSize="inherit" className="icon-sm" /><span>Italic</span><Kbd spec="Mod-I" />
              </DropdownMenuItem>
              <DropdownMenuItem className="fse-menu-item" data-active={s.strike || undefined} onSelect={() => chain().toggleStrike().run()}>
                <StrikethroughSRoundedIcon fontSize="inherit" className="icon-sm" /><span>Strikethrough</span><Kbd spec="Mod-Shift-S" />
              </DropdownMenuItem>
              <DropdownMenuItem className="fse-menu-item" data-active={s.code || undefined} onSelect={() => chain().toggleCode().run()}>
                <CodeRoundedIcon fontSize="inherit" className="icon-sm" /><span>Code</span><Kbd spec="Mod-E" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton label="Bulleted list" shortcut="Mod-Shift-8" active={s.bulletList} onClick={() => chain().toggleBulletList().run()}><FormatListBulletedRoundedIcon fontSize="inherit" /></ToolButton>
          <ToolButton label="Numbered list" shortcut="Mod-Shift-7" active={s.orderedList} onClick={() => chain().toggleOrderedList().run()}><FormatListNumberedRoundedIcon fontSize="inherit" /></ToolButton>
          <ToolButton label="Checklist" shortcut="Mod-Shift-9" active={s.taskList} onClick={() => chain().toggleTaskList().run()}><ChecklistRoundedIcon fontSize="inherit" /></ToolButton>
          <LinkButton editor={editor} active={s.link} href={s.linkHref} />
          {onPickImage && (
            <ToolButton label="Add photo" disabled={imagesDisabled} onClick={onPickImage}><ImageOutlinedIcon fontSize="inherit" /></ToolButton>
          )}
        </div>
        <div className="fse-group fse-group-end">
          <ToolButton label="Exit full screen" shortcut="Esc" onClick={() => onOpenChange(false)}><CloseFullscreenRoundedIcon fontSize="inherit" /></ToolButton>
        </div>
      </div>

      <div className="fse-scroll" onClick={e => { if (e.target === e.currentTarget) editor.commands.focus('end') }}>
        <EditorContent editor={editor} className="fse-editor" />
      </div>

      <div className="fse-footer">
        {footer}
        <div className="fse-actions">
          <span className="fse-hint">{keys('Mod-Enter')} to {submitLabel.toLowerCase()}</span>
          <button type="button" className="button" disabled={!canSubmit} onClick={() => onSubmit()}>{submitLabel}</button>
        </div>
      </div>
    </div>
  )
}
