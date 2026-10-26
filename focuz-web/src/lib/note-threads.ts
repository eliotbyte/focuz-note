// Moving a note to another thread (or out of one). The server checks the same rules (no loops, same space).
import type { NoteRecord } from './types'

type ThreadNote = Pick<NoteRecord, 'id' | 'parentId'>

/** The note and all its replies at any depth: none of them can become its parent. */
export function ownThread(notes: ThreadNote[], noteId: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const n of notes) {
    if (n.parentId == null || n.id == null) continue
    const list = children.get(n.parentId)
    if (list) list.push(n.id)
    else children.set(n.parentId, [n.id])
  }
  const out = new Set<number>([noteId])
  const stack = [noteId]
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (!out.has(c)) { out.add(c); stack.push(c) }
    }
  }
  return out
}

/** Whether replies below `noteId` are public: the nearest shared note at or above it shares its replies.
 *  `shares` maps the local id of each shared note to whether its replies are public too. */
export function repliesPublicBelow(byId: Map<number, ThreadNote>, noteId: number | null, shares: Map<number, boolean>): boolean {
  const seen = new Set<number>()
  let cur: number | null | undefined = noteId
  while (cur != null && !seen.has(cur)) {
    const s = shares.get(cur)
    if (s !== undefined) return s
    seen.add(cur)
    cur = byId.get(cur)?.parentId
  }
  return false
}
