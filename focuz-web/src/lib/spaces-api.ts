// Online-only actions around spaces, members, invitations, notifications, account and sharing.
import { api, ApiError, isNetworkError } from './api'
import { setAuthTokenLS } from './auth'
import { db, getKV, setKV } from './db'
import { runSync } from './sync'
import type { SpaceRole } from './types'

/** A user-facing sentence for a failed request. */
export function errorText(e: unknown, fallback = 'Something went wrong, try again'): string {
  if (isNetworkError(e)) return 'You are offline or the server is unreachable. Try again when you are back online.'
  if (e instanceof ApiError) {
    const msg = (e.body as any)?.error?.message
    if (typeof msg === 'string' && msg) return msg
  }
  return fallback
}

async function serverSpaceId(localSpaceId: number): Promise<number> {
  const s = await db.spaces.get(localSpaceId)
  if (!s?.serverId) throw new ApiError(400, 'not synced', { error: { message: 'This space is not on the server yet. Try again after it syncs.' } })
  return s.serverId
}

// ---- account ----

export interface Me {
  id: number
  username: string
  email?: string | null
  notifyEmail: boolean
  emailNotificationsAvailable: boolean
  authMode: 'username' | 'email'
  avatarVersion?: number
}

export const ME_KV = 'me'

export async function fetchMe(): Promise<Me> {
  const me = (await api('/me'))?.data as Me
  await setKV(ME_KV, me)
  return me
}

export async function updateMe(patch: { notifyEmail?: boolean }): Promise<Me> {
  const me = (await api('/me', { method: 'PATCH', body: JSON.stringify(patch) }))?.data as Me
  await setKV(ME_KV, me)
  return me
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const resp = await api('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
  // The server signs out every session on a password change and hands this one a fresh token.
  const token = resp?.data?.token
  if (typeof token === 'string' && token) setAuthTokenLS(token)
}

// ---- spaces ----

/** Creates a shared space on the server and makes it available on this device. */
export async function createSpace(name: string): Promise<number> {
  const resp = await api('/spaces', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
  const serverId = Number(resp?.data?.id)
  const now = new Date().toISOString()
  const localId = await db.spaces.add({ serverId, name: name.trim(), role: 'owner', isPersonal: false, memberCount: 1, createdAt: now, modifiedAt: now, deletedAt: null, isDirty: 0 })
  void runSync(true)
  return localId
}

export async function renameSpace(localSpaceId: number, name: string): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) })
  await db.spaces.update(localSpaceId, { name: name.trim() })
}

export async function deleteSpace(localSpaceId: number): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}/delete`, { method: 'PATCH' })
  const { dropSpaceLocally } = await import('./sync-pull')
  await dropSpaceLocally(localSpaceId)
}

export async function leaveSpace(localSpaceId: number, myUserId: number): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}/members/${myUserId}`, { method: 'DELETE' })
  const { dropSpaceLocally } = await import('./sync-pull')
  await dropSpaceLocally(localSpaceId)
}

export async function setMemberRole(localSpaceId: number, userId: number, role: SpaceRole): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
  void runSync(true)
}

export async function removeMember(localSpaceId: number, userId: number): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}/members/${userId}`, { method: 'DELETE' })
  void runSync(true)
}

// ---- invitations ----

export interface SentInvitation { id: number; identifier: string; role: SpaceRole; inviterName: string; createdAt: string; expiresAt: string }
export interface ReceivedInvitation { id: number; spaceId: number; spaceName: string; inviterName: string; role: SpaceRole; createdAt: string }

export async function invite(localSpaceId: number, identifier: string, role: SpaceRole): Promise<string> {
  const sid = await serverSpaceId(localSpaceId)
  const resp = await api(`/spaces/${sid}/invitations`, { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), role }) })
  return resp?.data?.message ?? 'Invitation sent'
}

export async function listSentInvitations(localSpaceId: number): Promise<SentInvitation[]> {
  const sid = await serverSpaceId(localSpaceId)
  return ((await api(`/spaces/${sid}/invitations`))?.data ?? []) as SentInvitation[]
}

export async function cancelInvitation(localSpaceId: number, invitationId: number): Promise<void> {
  const sid = await serverSpaceId(localSpaceId)
  await api(`/spaces/${sid}/invitations/${invitationId}`, { method: 'DELETE' })
}

export async function listMyInvitations(): Promise<ReceivedInvitation[]> {
  return ((await api('/invitations'))?.data ?? []) as ReceivedInvitation[]
}

/** Accepts and waits until the space is on this device. Returns its local id. */
export async function acceptInvitation(invitationId: number): Promise<number | undefined> {
  const resp = await api(`/invitations/${invitationId}/accept`, { method: 'POST' })
  const sid = Number(resp?.data?.spaceId)
  await runSync(true)
  return (await db.spaces.where('serverId').equals(sid).first())?.id
}

export async function declineInvitation(invitationId: number): Promise<void> {
  await api(`/invitations/${invitationId}/decline`, { method: 'POST' })
}

// ---- notifications ----

export interface AppNotification {
  id: number
  type: 'space_invitation' | 'invitation_accepted' | 'role_changed' | 'removed_from_space' | 'space_deleted' | string
  payload: Record<string, any>
  isRead: boolean
  createdAt: string
  /** space_invitation only; older servers don't send it. */
  invitationStatus?: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | string
}

export const NOTIFICATIONS_KV = 'notifications'

export async function fetchNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
  const data = (await api('/notifications?limit=50'))?.data ?? { items: [], unread: 0 }
  await setKV(NOTIFICATIONS_KV, data)
  return data
}

export async function markNotificationsRead(ids: number[] | 'all'): Promise<void> {
  const cached = await getKV<{ items: AppNotification[]; unread: number }>(NOTIFICATIONS_KV)
  if (cached) {
    const items = cached.items.map(n => (ids === 'all' || ids.includes(n.id)) ? { ...n, isRead: true } : n)
    await setKV(NOTIFICATIONS_KV, { items, unread: items.filter(n => !n.isRead).length })
  }
  await api('/notifications/read', { method: 'POST', body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) })
}

// ---- history & sharing ----

export interface NoteHistory {
  createdBy: string
  createdAt: string
  modifiedBy: string
  modifiedAt: string
  edits: Array<{ username: string; action: 'created' | 'edited' | 'deleted' | 'restored'; at: string }>
}

export async function fetchNoteHistory(noteServerId: number): Promise<NoteHistory> {
  return (await api(`/notes/${noteServerId}/history`))?.data as NoteHistory
}

export async function shareNote(localSpaceId: number, noteServerId: number | null, includeReplies: boolean): Promise<string> {
  const sid = await serverSpaceId(localSpaceId)
  const resp = await api(`/spaces/${sid}/shares`, { method: 'POST', body: JSON.stringify({ noteId: noteServerId, includeReplies }) })
  void runSync(true)
  return resp?.data?.token as string
}

export async function setShareReplies(token: string, includeReplies: boolean): Promise<void> {
  await api(`/shares/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ includeReplies }) })
  void runSync(true)
}

export async function unshare(token: string): Promise<void> {
  await api(`/shares/${encodeURIComponent(token)}`, { method: 'DELETE' })
  void runSync(true)
}
