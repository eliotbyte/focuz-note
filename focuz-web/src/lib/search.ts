import { db, getKV } from './db'
import type { NoteRecord } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FlexSearchLib: any | null = null

async function loadFlexSearch(): Promise<void> {
  if (FlexSearchLib) return
  try {
    // dynamic import for ESM
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = await import('flexsearch')
    FlexSearchLib = mod
  } catch {
    FlexSearchLib = (window as any)?.FlexSearch || null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocIndex = any
const indexes = new Map<number, DocIndex>()
const building = new Set<number>()

function createIndex(): DocIndex {
  const DocumentCtor = FlexSearchLib?.Document || (FlexSearchLib && FlexSearchLib['Document'])
  if (!DocumentCtor) throw new Error('FlexSearch Document not available')
  const idx = new DocumentCtor({
    preset: 'speed',
    tokenize: 'full',
    cache: true,
    document: {
      id: 'id',
      index: [
        { field: 'text', tokenize: 'full' },
        { field: 'tags', tokenize: 'full' },
      ],
      store: ['id'],
    },
  })
  return idx
}

export async function ensureNoteIndexForSpace(spaceId: number): Promise<void> {
  await loadFlexSearch()
  if (!FlexSearchLib) return
  if (indexes.has(spaceId) || building.has(spaceId)) return
  building.add(spaceId)
  try {
    const idx = createIndex()
    indexes.set(spaceId, idx)
    const notes = await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
    for (const n of notes) {
      addOrUpdateDoc(idx, n)
    }
  } finally {
    building.delete(spaceId)
  }
}

function addOrUpdateDoc(idx: DocIndex, n: NoteRecord) {
  const doc = { id: n.id!, text: n.text, tags: (n.tags || []).join(' ') }
  try { idx.remove(n.id!) } catch {}
  idx.add(doc)
}

export async function searchNotes(spaceId: number, query: string): Promise<number[]> {
  if (!query.trim()) return []
  await ensureNoteIndexForSpace(spaceId)
  const idx = indexes.get(spaceId)
  if (!idx) return []
  const res = idx.search(query, { enrich: true, suggest: true }) as Array<{ result: Array<{ id: number }> }>
  const order: number[] = []
  const seen = new Set<number>()
  for (const group of res || []) {
    for (const r of group.result || []) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        order.push(r.id)
      }
    }
  }
  return order
}

// Rebuild or update index on app events
function listenEvents() {
  try {
    window.addEventListener('focuz:local-write', async () => {
      const spaceId = await getKV<number>('currentSpaceId')
      if (!spaceId) return
      await rebuildSpaceIndex(spaceId)
    })
    window.addEventListener('focuz:sync-applied', async () => {
      const spaceId = await getKV<number>('currentSpaceId')
      if (!spaceId) return
      await rebuildSpaceIndex(spaceId)
    })
  } catch {}
}

async function rebuildSpaceIndex(spaceId: number): Promise<void> {
  await loadFlexSearch()
  if (!FlexSearchLib) return
  const idx = indexes.get(spaceId) || createIndex()
  indexes.set(spaceId, idx)
  try { idx.clear() } catch {}
  const notes = await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
  for (const n of notes) addOrUpdateDoc(idx, n)
}

listenEvents()

export async function initSearch(): Promise<void> {
  await loadFlexSearch()
} 