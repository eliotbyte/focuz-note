// What a role in a space allows (mirrors focuz-api pkg/access).
import type { SpaceRecord, SpaceRole } from './types'

const RANK: Record<SpaceRole, number> = { owner: 4, admin: 3, editor: 2, guest: 1 }

/** Spaces created on this device before their first sync have no role yet: they are ours. */
export function roleOf(space: SpaceRecord | undefined | null): SpaceRole {
  return space?.role ?? 'owner'
}

export const rank = (r: SpaceRole) => RANK[r] ?? 0
export const canWrite = (r: SpaceRole) => rank(r) >= 2
export const canEditNotes = (r: SpaceRole) => rank(r) >= 2
export const canManage = (r: SpaceRole) => rank(r) >= 3

/** authorId is the note author's server id; unsynced notes (no author yet) are our own. */
export function canDeleteNote(r: SpaceRole, authorId: number | null | undefined, meId: number | null | undefined): boolean {
  if (rank(r) >= 3) return true
  return rank(r) === 2 && (authorId == null || authorId === meId)
}
export const canPublishNote = canDeleteNote

/** Roles the actor may give to someone who currently has `target` (null = an invitation). */
export function assignableRoles(actor: SpaceRole, target: SpaceRole | null): SpaceRole[] {
  if (!canManage(actor) || target === 'owner') return []
  const all: SpaceRole[] = ['admin', 'editor', 'guest']
  if (actor === 'owner') return all
  if (target && rank(target) >= rank(actor)) return []
  return all.filter(x => rank(x) < rank(actor))
}

export function canRemoveMember(actor: SpaceRole, target: SpaceRole): boolean {
  if (!canManage(actor) || target === 'owner') return false
  return actor === 'owner' || rank(target) < rank(actor)
}

export const ROLE_LABEL: Record<SpaceRole, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', guest: 'Guest' }
export const ROLE_HINT: Record<SpaceRole, string> = {
  owner: 'Everything, including deleting the space',
  admin: 'Invites people, manages members and public links',
  editor: 'Writes notes and edits any note; deletes own notes',
  guest: 'Reads only',
}
