// Which focuz server this web app talks to. The web app can be hosted anywhere; the user picks
// the server on the sign-in screen (like Bitwarden/Vaultwarden clients). The build-time
// VITE_API_BASE_URL is only the default.

const SERVER_LS = 'focuz:server'
const CONFIG_LS = 'focuz:server-config'

export type AccountMode = 'username' | 'email'

export interface ServerConfig {
  mode: AccountMode
  registration: 'open' | 'closed'
  version?: string
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = { mode: 'username', registration: 'open' }

export function defaultServer(): string | undefined {
  const v = import.meta.env.VITE_API_BASE_URL as string | undefined
  return v ? v.replace(/\/+$/, '') : undefined
}

/**
 * Whether people may point this web app at another server. Operators who host the app for their
 * own server only build it with VITE_ALLOW_CUSTOM_SERVER=false.
 */
export function customServerAllowed(): boolean {
  return String(import.meta.env.VITE_ALLOW_CUSTOM_SERVER ?? 'true').trim().toLowerCase() !== 'false'
}

export function getServer(): string | undefined {
  if (!customServerAllowed()) return defaultServer()
  try {
    const v = localStorage.getItem(SERVER_LS)
    if (v) return v
  } catch {}
  return defaultServer()
}

export function setServer(url: string | null) {
  try {
    if (!url || url === defaultServer()) localStorage.removeItem(SERVER_LS)
    else localStorage.setItem(SERVER_LS, url)
    localStorage.removeItem(CONFIG_LS)
  } catch {}
}

export function isCustomServer(): boolean {
  if (!customServerAllowed()) return false
  try { return !!localStorage.getItem(SERVER_LS) } catch { return false }
}

/** Accepts "notes.example.com", "https://notes.example.com/api/", "localhost:8080"... */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const host = s.split('/')[0].split(':')[0]
    const local = host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.local')
    s = `${local ? 'http' : 'https'}://${s}`
  }
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  u.hash = ''
  u.search = ''
  return u.toString().replace(/\/+$/, '')
}

export function serverLabel(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.host + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

export function cachedServerConfig(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_LS)
    return raw ? { ...DEFAULT_SERVER_CONFIG, ...JSON.parse(raw) } : null
  } catch {
    return null
  }
}

export type ProbeResult =
  | { ok: true; config: ServerConfig }
  | { ok: false; reason: 'unreachable' | 'not-focuz'; message: string }

/** Checks that `url` is a focuz server and reads how accounts work there. */
export async function probeServer(url: string, timeoutMs = 8000): Promise<ProbeResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(`${url}/auth/config`, { signal: ctrl.signal })
    } catch {
      return { ok: false, reason: 'unreachable', message: 'Cannot reach this server. Check the address, and that the server allows this web app (ALLOWED_ORIGINS).' }
    }
    if (res.ok) {
      const body = await res.json().catch(() => null)
      const d = body?.data
      if (d?.mode === 'username' || d?.mode === 'email') {
        const config: ServerConfig = { mode: d.mode, registration: d.registration === 'closed' ? 'closed' : 'open', version: d.version }
        return { ok: true, config }
      }
    }
    // Older focuz servers have no /auth/config: accept them if /health looks like focuz.
    const health = await fetch(`${url}/health`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (health && health.status === 'ok' && 'version' in health) {
      return { ok: true, config: { ...DEFAULT_SERVER_CONFIG, version: health.version } }
    }
    return { ok: false, reason: 'not-focuz', message: 'This address answers, but it is not a focuz server. For some setups the API lives under a path such as /api.' }
  } finally {
    clearTimeout(timer)
  }
}

export function rememberServerConfig(config: ServerConfig) {
  try { localStorage.setItem(CONFIG_LS, JSON.stringify(config)) } catch {}
}
