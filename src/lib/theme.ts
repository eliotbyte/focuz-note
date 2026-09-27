import { useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark'

const THEME_LS_KEY = 'focuz:theme'

function readTheme(): ThemeMode {
  const v = document.documentElement.dataset.theme
  return v === 'light' ? 'light' : 'dark'
}

export function getStoredTheme(): ThemeMode | undefined {
  try {
    const v = localStorage.getItem(THEME_LS_KEY)
    if (v === 'light' || v === 'dark') return v
    return undefined
  } catch {
    return undefined
  }
}

export function setStoredTheme(theme: ThemeMode): void {
  try { localStorage.setItem(THEME_LS_KEY, theme) } catch {}
  document.documentElement.dataset.theme = theme
}

export type ThemePreference = ThemeMode | 'system'

const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null)
let systemListener: (() => void) | null = null

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_LS_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'dark'
}

/** Light, dark, or follow the device (and keep following it while the app is open). */
export function setThemePreference(p: ThemePreference): void {
  try { localStorage.setItem(THEME_LS_KEY, p) } catch {}
  applyStoredTheme()
}

export function applyStoredTheme(): ThemeMode {
  const pref = getThemePreference()
  const q = systemQuery()
  if (systemListener && q) { q.removeEventListener?.('change', systemListener); systemListener = null }
  let next: ThemeMode = pref === 'system' ? (q?.matches ? 'light' : 'dark') : pref
  if (pref === 'system' && q) {
    systemListener = () => { document.documentElement.dataset.theme = q.matches ? 'light' : 'dark' }
    q.addEventListener?.('change', systemListener)
  }
  if (!next) next = readTheme() || 'dark'
  document.documentElement.dataset.theme = next
  return next
}

function subscribeTheme(cb: () => void): () => void {
  const el = document.documentElement
  const mo = new MutationObserver(() => cb())
  mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, readTheme, () => 'dark')
}

