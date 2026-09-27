// HTTP layer: timeouts and a clear split between "server unreachable" and "server said no".
import { emitAuthRequired, getAuthToken } from './auth'

const DEFAULT_TIMEOUT_MS = 20000
const UPLOAD_TIMEOUT_MS = 120000

let apiBase: string | undefined = import.meta.env.VITE_API_BASE_URL as string | undefined

export function getApiBase(): string | undefined { return apiBase }
/** Test hook. */
export function setApiBase(base: string | undefined) { apiBase = base }

/** The request never got an HTTP response: server down, DNS, CORS, offline, timeout. */
export class NetworkError extends Error {
  readonly kind = 'network' as const
  constructor(message: string) { super(message); this.name = 'NetworkError' }
}

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  readonly kind = 'http' as const
  readonly status: number
  readonly body?: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError || (e as any)?.kind === 'network'
}

/** Errors worth retrying later without user action. */
export function isTransientError(e: unknown): boolean {
  if (isNetworkError(e)) return true
  const status = (e as any)?.status
  return typeof status === 'number' && (status >= 500 || status === 429 || status === 408)
}

async function send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!apiBase) throw new NetworkError('API base URL is not configured')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${apiBase}${path}`, { ...init, signal: ctrl.signal })
  } catch (e: any) {
    throw new NetworkError(ctrl.signal.aborted ? `Request timed out after ${Math.round(timeoutMs / 1000)}s` : (e?.message || 'Network request failed'))
  } finally {
    clearTimeout(timer)
  }
}

async function failFrom(res: Response, path: string): Promise<never> {
  let body: any = undefined
  try { body = await res.json() } catch {}
  const isAuthEndpoint = path.startsWith('/login') || path.startsWith('/register')
  if (res.status === 401 && !isAuthEndpoint) {
    emitAuthRequired(true)
    throw new ApiError(401, 'AUTH_REQUIRED', body)
  }
  const msg = body?.error?.message ? `${res.status} ${body.error.message}` : `${res.status} ${res.statusText}`
  throw new ApiError(res.status, msg, body)
}

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = { ...(extra as Record<string, string> | undefined || {}) }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export async function api(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<any> {
  const res = await send(path, { ...init, headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as any) }) }, init?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (!res.ok) await failFrom(res, path)
  return res.json()
}

export async function apiMultipart(path: string, form: FormData): Promise<any> {
  const res = await send(path, { method: 'POST', body: form, headers: authHeaders() }, UPLOAD_TIMEOUT_MS)
  if (!res.ok) await failFrom(res, path)
  return res.json()
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await send(path, { method: 'GET', headers: authHeaders() }, UPLOAD_TIMEOUT_MS)
  if (!res.ok) await failFrom(res, path)
  return res.blob()
}

/** Fetch an absolute URL (e.g. a presigned storage URL) with the same error classification. */
export async function fetchBlobUrl(url: string): Promise<Blob> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal })
  } catch (e: any) {
    throw new NetworkError(e?.message || 'Download failed')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`)
  return res.blob()
}
