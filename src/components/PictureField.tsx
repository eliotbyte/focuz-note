import { useEffect, useRef, useState } from 'react'
import ImageEditorDialog from './ImageEditorDialog'
import { Avatar } from './ui/avatar'
import { notify } from '../ui/notify'
import { errorText } from '../lib/spaces-api'

/** Square pictures are stored at this size (small enough for the database, sharp on HiDPI). */
export const PICTURE_SIDE = 256

/**
 * A picture setting: choose a file or paste from the clipboard, crop it to a square, save.
 * While it is on screen, Ctrl+V with an image in the clipboard starts the same flow.
 */
export default function PictureField({ label, name, src, round, disabled, onSave, onRemove }: {
  label: string
  name: string
  src?: string
  round?: boolean
  disabled?: boolean
  onSave: (blob: Blob) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  const take = (blob: Blob | null | undefined) => {
    if (!blob) return
    if (!blob.type.startsWith('image/')) { notify('That is not a picture', 'warning'); return }
    setEditing(blob)
  }

  useEffect(() => {
    if (disabled || editing) return
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'))
      if (file) { e.preventDefault(); take(file) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [disabled, editing])

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'))
        if (type) { take(await item.getType(type)); return }
      }
      notify('No picture in the clipboard', 'info', { description: 'Copy an image first, or press Ctrl+V here.' })
    } catch {
      notify('Press Ctrl+V to paste', 'info', { description: 'The browser did not let the page read the clipboard.' })
    }
  }

  async function run(f: () => Promise<void>, done: string) {
    setBusy(true)
    try { await f(); notify(done, 'success') } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="settings-label">{label}</div>
      <div className="picture-field">
        <Avatar name={name} size={64} shape={round ? 'round' : 'square'} src={src} />
        <div className="space-y-1.5">
          <div className="picture-field-actions">
            <button type="button" className="button button-secondary !h-8" disabled={disabled || busy} onClick={() => input.current?.click()}>Upload…</button>
            <button type="button" className="button button-secondary !h-8" disabled={disabled || busy} onClick={() => { void pasteFromClipboard() }}>Paste</button>
            {src && <button type="button" className="filter-btn filter-btn-ghost !h-8" disabled={disabled || busy} onClick={() => { void run(onRemove, 'Picture removed') }}>Remove</button>}
          </div>
          <p className="text-xs text-secondary">PNG, JPEG or WebP. You can also press Ctrl+V with a picture copied.</p>
        </div>
        <input ref={input} type="file" accept="image/*" hidden aria-label={`${label}: choose a file`}
          onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {editing && (
        <ImageEditorDialog
          image={editing}
          title={label}
          square
          round={round}
          maxSide={PICTURE_SIDE}
          onCancel={() => setEditing(null)}
          onSave={async (blob) => {
            await onSave(blob)
            setEditing(null)
            notify('Picture saved', 'success')
          }}
        />
      )}
    </div>
  )
}
