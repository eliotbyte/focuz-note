// Auth token storage and the cross-tab "session expired" signal.

const TOKEN_KV = 'authToken'
const USERNAME_LS = 'authUsername'
const AUTH_REQUIRED_LS = 'authRequired'

let authRequired = false
export let authBC: BroadcastChannel | null = null
try { authBC = new BroadcastChannel('focuz-auth') } catch {}

export function emitAuthRequired(next: boolean) {
  authRequired = next
  try { localStorage.setItem(AUTH_REQUIRED_LS, next ? '1' : '0') } catch {}
  try { window.dispatchEvent(new CustomEvent('focuz:auth-required', { detail: next })) } catch {}
  try { authBC?.postMessage({ type: 'auth-required', value: next }) } catch {}
}

export function isAuthRequired(): boolean {
  if (authRequired) return true
  try { return localStorage.getItem(AUTH_REQUIRED_LS) === '1' } catch { return false }
}

export function onAuthRequired(handler: (required: boolean) => void): () => void {
  const fn = (e: Event) => handler(!!(e as CustomEvent<boolean>).detail)
  const storageFn = (e: StorageEvent) => { if (e.key === AUTH_REQUIRED_LS) handler(e.newValue === '1') }
  const bcFn = (msg: MessageEvent) => { if (msg?.data?.type === 'auth-required') handler(!!msg.data.value) }
  window.addEventListener('focuz:auth-required', fn as EventListener)
  window.addEventListener('storage', storageFn)
  authBC?.addEventListener('message', bcFn)
  handler(isAuthRequired())
  return () => {
    window.removeEventListener('focuz:auth-required', fn as EventListener)
    window.removeEventListener('storage', storageFn)
    try { authBC?.removeEventListener('message', bcFn) } catch {}
  }
}

export function getAuthToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KV) ?? undefined } catch { return undefined }
}

export function setAuthTokenLS(token: string) {
  localStorage.setItem(TOKEN_KV, token)
}

export function clearAuthToken() {
  try { localStorage.removeItem(TOKEN_KV) } catch {}
}

export function getLastUsername(): string | undefined {
  try { return localStorage.getItem(USERNAME_LS) ?? undefined } catch { return undefined }
}

export function setLastUsername(username: string) {
  try { localStorage.setItem(USERNAME_LS, username) } catch {}
}
