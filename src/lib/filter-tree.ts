// Pure helpers to turn flat filter records into the sidebar tree.
// Filter parents are referenced by server id (parentId) or, before the parent is synced,
// by its client id (params._parentClientId).
import type { FilterRecord } from './types'

export interface FilterTreeNode {
  rec: FilterRecord
  id: number
  serverId: number | null
  clientId: string | null
  depth: number
  /** Local ids of all ancestors, root first. */
  ancestors: number[]
  children: FilterTreeNode[]
  descendantCount: number
}

function orderOf(n: FilterTreeNode): number {
  const o = (n.rec.params as any)?._order
  return typeof o === 'number' ? o : 1e9
}

function compare(a: FilterTreeNode, b: FilterTreeNode): number {
  const d = orderOf(a) - orderOf(b)
  if (d !== 0) return d
  const an = a.rec.name.toLowerCase()
  const bn = b.rec.name.toLowerCase()
  if (an !== bn) return an < bn ? -1 : 1
  return a.rec.createdAt.localeCompare(b.rec.createdAt)
}

export function buildFilterTree(filters: FilterRecord[]): FilterTreeNode[] {
  const nodes = new Map<number, FilterTreeNode>()
  const byServer = new Map<number, FilterTreeNode>()
  const byClient = new Map<string, FilterTreeNode>()
  for (const f of filters) {
    if (f.id == null) continue
    const n: FilterTreeNode = { rec: f, id: f.id, serverId: f.serverId ?? null, clientId: f.clientId ?? null, depth: 0, ancestors: [], children: [], descendantCount: 0 }
    nodes.set(f.id, n)
    if (n.serverId != null) byServer.set(n.serverId, n)
    if (n.clientId) byClient.set(n.clientId, n)
  }
  const parentOf = (n: FilterTreeNode): FilterTreeNode | undefined => {
    if (n.rec.parentId != null) return byServer.get(n.rec.parentId)
    const pc = (n.rec.params as any)?._parentClientId
    return pc ? byClient.get(pc) : undefined
  }
  const roots: FilterTreeNode[] = []
  for (const n of nodes.values()) {
    // Guard against cycles (A->B->A) from concurrent edits: treat such nodes as roots.
    let p = parentOf(n)
    const seen = new Set<number>([n.id])
    let cyclic = false
    while (p) {
      if (seen.has(p.id)) { cyclic = true; break }
      seen.add(p.id)
      p = parentOf(p)
    }
    const parent = cyclic ? undefined : parentOf(n)
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const finish = (n: FilterTreeNode, depth: number, ancestors: number[]): number => {
    n.depth = depth
    n.ancestors = ancestors
    n.children.sort(compare)
    let count = 0
    for (const ch of n.children) count += 1 + finish(ch, depth + 1, [...ancestors, n.id])
    n.descendantCount = count
    return count
  }
  roots.sort(compare)
  for (const r of roots) finish(r, 0, [])
  return roots
}

/** Rows to render: a node is visible when all its ancestors are expanded. */
export function flattenVisible(roots: FilterTreeNode[], expanded: Set<number>): FilterTreeNode[] {
  const out: FilterTreeNode[] = []
  const walk = (n: FilterTreeNode) => {
    out.push(n)
    if (expanded.has(n.id)) n.children.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

export function collectDescendantIds(node: FilterTreeNode): number[] {
  const ids: number[] = []
  const walk = (n: FilterTreeNode) => { ids.push(n.id); n.children.forEach(walk) }
  walk(node)
  return ids
}
