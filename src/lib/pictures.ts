// Space pictures and avatars: fetched with the session token, kept in the Cache API by version so
// they show offline and are downloaded again only when they change.
import { useEffect, useState } from 'react'
import { api, getApiBase } from './api'
import { getAuthToken } from './auth'
import { db } from './db'
import { runSync } from './sync'

const CACHE = 'focuz-pictures-v1'
const memory = new Map<string, string>() // cache key -> object URL
const inflight = new Map<string, Promise<string | null>>()

function cacheKey(path: string, version: number) {
  return `${getApiBase() ?? ''}${path}?v=${version}`
}

async function load(path: string, version: number): Promise<string | null> {
  const key = cacheKey(path, version)
  const hit = memory.get(key)
  if (hit) return hit
  let blob: Blob | null = null
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null
  const cached = await cache?.match(key).catch(() => undefined)
  if (cached) blob = await cached.blob()
  if (!blob) {
    const token = getAuthToken()
    const base = getApiBase()
    if (!token || !base) return null
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res || !res.ok) return null
    blob = await res.blob()
    await cache?.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } })).catch(() => {})
  }
  const url = URL.createObjectURL(blob)
  memory.set(key, url)
  return url
}

/** Object URL of a picture, or undefined when there is none (version 0) or it is not loaded yet. */
export function usePicture(path: string | null, version: number | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (path && version ? memory.get(cacheKey(path, version)) : undefined))
  useEffect(() => {
    if (!path || !version) { setUrl(undefined); return }
    const key = cacheKey(path, version)
    const known = memory.get(key)
    if (known) { setUrl(known); return }
    let alive = true
    let p = inflight.get(key)
    if (!p) { p = load(path, version).finally(() => inflight.delete(key)); inflight.set(key, p) }
    p.then(u => { if (alive) setUrl(u ?? undefined) })
    return () => { alive = false }
  }, [path, version])
  return url
}

export const avatarPath = (userId: number) => `/users/${userId}/avatar`
export const spaceIconPath = (serverSpaceId: number) => `/spaces/${serverSpaceId}/icon`

async function putPicture(path: string, blob: Blob | null): Promise<any> {
  if (!blob) return api(path, { method: 'DELETE' })
  return api(path, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'image/webp' } })
}

export async function setMyAvatar(blob: Blob | null): Promise<void> {
  const { fetchMe } = await import('./spaces-api')
  await putPicture('/me/avatar', blob)
  await fetchMe()
  void runSync(true)
}

export async function setSpaceIcon(localSpaceId: number, blob: Blob | null): Promise<void> {
  const s = await db.spaces.get(localSpaceId)
  if (!s?.serverId) throw new Error('This space is not on the server yet')
  await putPicture(spaceIconPath(s.serverId), blob)
  await runSync(true)
}
