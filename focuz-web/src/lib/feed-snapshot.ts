/**
 * Frozen feed order. A feed keeps the notes it showed when it was opened, in that order:
 * editing a note (new tags, new modifiedAt) re-renders it in place instead of moving or
 * hiding it. Notes that appear later (written here or pulled by sync) slot in where the
 * live order puts them. The list is rebuilt only for a new history entry (opening a view,
 * reloading the page) or when the filters change.
 */

type Snapshot = { sig: string; ids: number[] }

/** Lists kept; the one used least recently goes first. */
const MAX_ENTRIES = 100
const snapshots = new Map<string, Snapshot>()

/** A key for a new history entry. Lives in history.state, so back/forward find its feed again. */
export function newEntryKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Ids for the frozen list `key` showing `sig`, or undefined when it has to be built afresh. */
export function getFrozen(key: string, sig: string): number[] | undefined {
  const s = snapshots.get(key)
  if (!s || s.sig !== sig) return undefined
  // Map keeps insertion order: moving a list to the end makes it the last to be evicted.
  snapshots.delete(key)
  snapshots.set(key, s)
  return s.ids
}

export function setFrozen(key: string, sig: string, ids: number[]) {
  snapshots.delete(key)
  snapshots.set(key, { sig, ids })
  while (snapshots.size > MAX_ENTRIES) snapshots.delete(snapshots.keys().next().value!)
}

/**
 * Keeps `frozen` as is and adds the ids of `live` it does not have yet: each one goes right
 * before the first frozen note (in frozen order) that the live order puts after it, or at
 * the end. Frozen notes that moved since (edited, restored) are no anchor: they sit ahead
 * of it in live order.
 */
export function mergeFrozen(frozen: number[] | undefined, live: number[]): number[] {
  if (!frozen) return live.slice()
  const known = new Set(frozen)
  if (live.every(id => known.has(id))) return frozen
  const pos = new Map(live.map((id, i) => [id, i]))
  const before = new Map<number, number[]>()
  const tail: number[] = []
  for (const id of live) {
    if (known.has(id)) continue
    const p = pos.get(id)!
    const at = frozen.find(f => (pos.get(f) ?? -1) > p)
    if (at == null) tail.push(id)
    else before.set(at, [...(before.get(at) ?? []), id])
  }
  const out: number[] = []
  for (const id of frozen) {
    const b = before.get(id)
    if (b) out.push(...b)
    out.push(id)
  }
  out.push(...tail)
  return out
}

export function _resetFrozenForTests() { snapshots.clear() }
