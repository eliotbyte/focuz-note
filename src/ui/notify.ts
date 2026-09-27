import { toast } from 'sonner'

// When to toast (keep it rare):
//  - the result of something the user just did: "Note deleted · Undo", "Image is too small";
//  - rare events that change what the user sees: a conflict copy appeared, a new app version.
// Never for background state (offline, server unreachable, sync errors): the status chip in the
// top bar shows that continuously and does not interrupt.

export type NotifyKind = 'info' | 'success' | 'warning' | 'error'

export function notify(
  message: string,
  kind: NotifyKind = 'info',
  opts?: { id?: string; durationMs?: number; description?: string },
) {
  const o = { id: opts?.id, duration: opts?.durationMs, description: opts?.description }
  if (kind === 'success') return toast.success(message, o)
  if (kind === 'warning') return toast.warning(message, o)
  if (kind === 'error') return toast.error(message, o)
  return toast(message, o)
}

export function notifyUndoable(message: string, action: { label: string; onClick: () => void | Promise<void> }, opts?: { durationMs?: number }) {
  return toast(message, {
    // One undo toast at a time: deleting several notes in a row updates it instead of stacking.
    id: 'undo',
    duration: opts?.durationMs ?? 6000,
    action: {
      label: action.label,
      onClick: () => { void Promise.resolve(action.onClick()) },
    },
  })
}

export function notifyUpdateAvailable(onApply: () => void) {
  return toast('A new version of focuz is available', {
    id: 'pwa-update-available',
    description: 'Reload when you are ready. Unsaved text in an open editor would be lost.',
    duration: Infinity,
    action: { label: 'Reload', onClick: onApply },
  })
}
