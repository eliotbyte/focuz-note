import { describe, expect, it } from 'vitest'
import { buildFilterTree, collectDescendantIds, flattenVisible } from './filter-tree'
import type { FilterRecord } from './types'

let nextId = 1
function f(name: string, extra: Partial<FilterRecord> = {}): FilterRecord {
  const id = nextId++
  return { id, serverId: id + 100, clientId: `c${id}`, spaceId: 1, parentId: null, name, params: {}, createdAt: '2025-01-01', modifiedAt: '2025-01-01', isDirty: 0, ...extra }
}

describe('filter tree', () => {
  it('nests by server parent id and by pending client parent id, sorted by _order then name', () => {
    nextId = 1
    const work = f('Work', { params: { _order: 20 } as any })
    const home = f('Home', { params: { _order: 10 } as any })
    const proj = f('Projects', { parentId: work.serverId })
    const draft = f('Draft child', { serverId: null, params: { _parentClientId: proj.clientId } as any })
    const roots = buildFilterTree([work, home, proj, draft])
    expect(roots.map(r => r.rec.name)).toEqual(['Home', 'Work'])
    const w = roots[1]
    expect(w.descendantCount).toBe(2)
    expect(w.children[0].children[0].rec.name).toBe('Draft child')
    expect(w.children[0].children[0].ancestors).toEqual([work.id, proj.id])
    expect(w.children[0].children[0].depth).toBe(2)
  })

  it('shows only expanded branches (collapsed by default)', () => {
    nextId = 1
    const a = f('A')
    const b = f('B', { parentId: a.serverId })
    const c = f('C', { parentId: b.serverId })
    const roots = buildFilterTree([a, b, c])
    expect(flattenVisible(roots, new Set()).map(n => n.rec.name)).toEqual(['A'])
    expect(flattenVisible(roots, new Set([a.id!])).map(n => n.rec.name)).toEqual(['A', 'B'])
    // A collapsed parent hides grandchildren even if the child is expanded.
    expect(flattenVisible(roots, new Set([b.id!])).map(n => n.rec.name)).toEqual(['A'])
    expect(collectDescendantIds(roots[0])).toEqual([a.id, b.id, c.id])
  })

  it('does not loop forever on a parent cycle', () => {
    nextId = 1
    const a = f('A')
    const b = f('B', { parentId: a.serverId })
    a.parentId = b.serverId
    const roots = buildFilterTree([a, b])
    expect(roots.length).toBeGreaterThan(0)
  })
})
