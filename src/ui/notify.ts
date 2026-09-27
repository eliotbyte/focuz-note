import { toast } from 'sonner'

export type NotifyKind = 'info' | 'success' | 'warning' | 'error'

export function notify(message: string, kind: NotifyKind = 'info', opts?: { id?: string; durationMs?: number }) {
  const duration = opts?.durationMs
  const id = opts?.id
  if (kind === 'success') return toast.success(message, { id, duration })
  if (kind === 'warning') return toast.warning(message, { id, duration })
  if (kind === 'error') return toast.error(message, { id, duration })
  return toast(message, { id, duration })
}

export function notifyUndoable(message: string, action: { label: string; onClick: () => void | Promise<void> }, opts?: { durationMs?: number }) {
  return toast(message, {
    duration: opts?.durationMs ?? 6000,
    action: {
      label: action.label,
      onClick: () => { void Promise.resolve(action.onClick()) },
    },
  })
}


export function notifyUpdateAvailable(onApply: () => void) {
  return toast('Доступно обновление', {
    id: 'pwa-update-available',
    description: 'Обновление будет применено автоматически.',
    duration: 3500,
    action: { label: 'Обновить', onClick: onApply },
  })
}
