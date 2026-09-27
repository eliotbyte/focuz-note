import { useMemo } from 'react'
import { renderNoteHtml, toggleTask } from '../lib/note-format/render'
import { updateNoteLocal } from '../lib/sync'

/**
 * Note text in the feed: Markdown (legacy plain text renders the same as before).
 * Checklist boxes can be ticked right here.
 */
export default function NoteBody({ noteId, text, className }: { noteId?: number; text: string; className?: string }) {
  // Safe: markdown-it runs with html disabled, so note text cannot produce markup of its own.
  const html = useMemo(() => renderNoteHtml(text), [text])
  return (
    <div
      className={`note-prose ${className ?? ''}`}
      onClick={e => {
        const el = e.target as HTMLElement
        if (el instanceof HTMLInputElement && el.classList.contains('note-task-box')) {
          e.stopPropagation()
          const idx = Number(el.dataset.taskIndex)
          if (noteId == null || !Number.isFinite(idx)) { e.preventDefault(); return }
          const next = toggleTask(text, idx)
          if (next !== text) void updateNoteLocal(noteId, { text: next })
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
