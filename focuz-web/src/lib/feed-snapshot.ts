/**
 * Frozen feed order. A feed keeps the notes it showed when it was opened, in that order:
 * editing a note (new tags, new modifiedAt) re-renders it in place instead of moving or
 * hiding it. Notes that appear later (written here or pulled by sync) slot in where the
 * live order puts them. The list is rebuilt only for a new history entry (opening a view,
 * reloading the page) or when the filters change.
 */

type Snapshot = { sig: string; ids: number[] }

const MAX_ENTRIES = 100
const snapshots = new Map<string, Snapshot>()

/** A key for a new history entry. Lives in history.state, so back/forward find its feed again. */
export function newEntryKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Ids for the frozen list `key` showing `sig`, or undefined when it has to be built afresh. */
export function getFrozen(key: string, sig: string): number[] | undefined {
  const s = snapshots.get(key)
  return s && s.sig === sig ? s.ids : undefined
}

export function setFrozen(key: string, sig: string, ids: number[]) {
  snapshots.delete(key)
  snapshots.set(key, { sig, ids })
  while (snapshots.size > MAX_ENTRIES) snapshots.delete(snapshots.keys().next().value!)
}

/**
 * Keeps `frozen` as is and adds the ids of `live` it does not have yet: each one goes right
 * before the frozen note that follows it in live order, or at the end.
 */
export function mergeFrozen(frozen: number[] | undefined, live: number[]): number[] {
  if (!frozen) return live.slice()
  const known = new Set(frozen)
  const before = new Map<number, number[]>()
  let pending: number[] = []
  for (const id of live) {
    if (!known.has(id)) pending.push(id)
    else if (pending.length) { before.set(id, pending); pending = [] }
  }
  if (before.size === 0 && pending.length === 0) return frozen
  const out: number[] = []
  for (const id of frozen) {
    const b = before.get(id)
    if (b) out.push(...b)
    out.push(id)
  }
  out.push(...pending)
  return out
}

export function _resetFrozenForTests() { snapshots.clear() }
