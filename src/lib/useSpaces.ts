import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getKV } from './db'
import { getAuthToken } from './auth'
import { MEMBERS_KV, SHARES_KV } from './sync-pull'
import { fetchMe, ME_KV, type Me } from './spaces-api'
import type { NoteRecord, PublicShare, SpaceMember, SpaceRecord } from './types'

/** Spaces on this device: the personal one first, then by name. */
export function useSpaces(): SpaceRecord[] {
  return useLiveQuery(async () => {
    const list = await db.spaces.filter(s => !s.deletedAt).toArray()
    return list.sort((a, b) => Number(!!b.isPersonal) - Number(!!a.isPersonal) || (a.id! - b.id!))
  }, []) ?? []
}

export function useSpace(localId: number | null | undefined): SpaceRecord | undefined {
  return useLiveQuery(async () => (localId ? await db.spaces.get(localId) : undefined), [localId])
}

/** Members of a space, from the last sync. */
export function useMembers(serverSpaceId: number | null | undefined): SpaceMember[] {
  const all = useLiveQuery(() => getKV<SpaceMember[]>(MEMBERS_KV, []), []) ?? []
  return serverSpaceId ? all.filter(m => m.spaceId === serverSpaceId) : []
}

/** Active public links of a space (server id), from the last sync. */
export function useShares(serverSpaceId: number | null | undefined): PublicShare[] {
  const all = useLiveQuery(() => getKV<PublicShare[]>(SHARES_KV, []), []) ?? []
  return serverSpaceId ? all.filter(s => s.spaceId === serverSpaceId) : []
}

/** The signed-in account (cached; refreshed from the server when the app opens). */
export function useMe(refreshKey: unknown = true): Me | undefined {
  const me = useLiveQuery(() => getKV<Me>(ME_KV), [])
  useEffect(() => { if (refreshKey && getAuthToken()) fetchMe().catch(() => {}) }, [refreshKey])
  return me
}

/** Two letters for a space or person avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

/** A stable hue for a name (avatars). */
export function hueOf(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Link to a public page. The server is part of the link when it isn't this site's default. */
export function publicUrl(token: string, server: string | undefined, defaultServer: string | undefined): string {
  const base = `${location.origin}/p/${encodeURIComponent(token)}`
  return server && server !== defaultServer ? `${base}?server=${encodeURIComponent(server)}` : base
}

export interface NotePublicState {
  /** The note has its own public link. */
  direct?: PublicShare
  /** Public as part of a shared thread started by this ancestor (local id). */
  inherited?: { share: PublicShare; rootLocalId: number }
}

/** Whether a note is public, directly or through a shared thread above it. */
export function useNotePublicState(note: NoteRecord | undefined): NotePublicState {
  return useLiveQuery(async () => {
    if (!note) return {}
    const shares = (await getKV<PublicShare[]>(SHARES_KV, [])) ?? []
    const noteShares = shares.filter(s => s.noteId != null)
    if (!noteShares.length) return {}
    const direct = note.serverId ? noteShares.find(s => s.noteId === note.serverId) : undefined
    if (direct) return { direct }
    let parentId = note.parentId ?? null
    for (let depth = 0; parentId != null && depth < 50; depth++) {
      const p = await db.notes.get(parentId)
      if (!p) break
      const s = p.serverId ? noteShares.find(x => x.noteId === p.serverId) : undefined
      if (s) return s.includeReplies ? { inherited: { share: s, rootLocalId: p.id! } } : {}
      parentId = p.parentId ?? null
    }
    return {}
  }, [note?.id, note?.serverId, note?.parentId]) ?? {}
}
