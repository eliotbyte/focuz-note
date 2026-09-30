import type { registerSW as RegisterSW } from 'virtual:pwa-register'
import { notifyUpdateAvailable } from '../ui/notify'

// A new build must reach phones too: an installed app is rarely closed for real, so a new service
// worker that waits for "all tabs closed" (or for a toast to be tapped) can wait forever.
// So: look for updates when the app comes back to the screen, and switch to the new build on our own
// whenever nobody can lose anything by it. Otherwise the toast asks, as before.

/** Right after the app opens or comes back to the screen, a reload is not a surprise yet. */
export const FRESH_MS = 15_000
/** An app left open on a screen still checks now and then. */
export const CHECK_EVERY_MS = 30 * 60_000

export function canReloadSilently(s: { hidden: boolean; sinceShownMs: number; unsavedInput: boolean }): boolean {
  if (s.unsavedInput) return false
  return s.hidden || s.sinceShownMs < FRESH_MS
}

const TEXT_INPUTS = new Set(['', 'text', 'search', 'url', 'email', 'password', 'tel', 'number'])

/** Typed text lives only in the page until it is saved; a reload would drop it. */
export function hasUnsavedInput(root: ParentNode = document): boolean {
  for (const el of root.querySelectorAll<HTMLElement>('textarea, input, [contenteditable]')) {
    if (el instanceof HTMLInputElement) {
      if (TEXT_INPUTS.has(el.type) && el.value.trim()) return true
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.value.trim()) return true
    } else if (el.isContentEditable && el.textContent?.trim()) {
      return true
    }
  }
  return false
}

export function setupAppUpdates(registerSW: typeof RegisterSW) {
  let shownAt = Date.now()
  let waiting = false
  let registration: ServiceWorkerRegistration | undefined

  const apply = () => { void updateSW(true) }
  const applyIfSafe = () => {
    if (!waiting) return false
    const hidden = document.visibilityState === 'hidden'
    if (!canReloadSilently({ hidden, sinceShownMs: Date.now() - shownAt, unsavedInput: hasUnsavedInput() })) return false
    apply()
    return true
  }
  const check = () => {
    if (registration && navigator.onLine) registration.update().catch(() => {})
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      if (!applyIfSafe()) notifyUpdateAvailable(apply)
    },
    onRegisteredSW(_url, r) {
      registration = r
      if (r) setInterval(check, CHECK_EVERY_MS)
    },
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      applyIfSafe()
    } else {
      shownAt = Date.now()
      check()
    }
  })
  window.addEventListener('online', check)
}
