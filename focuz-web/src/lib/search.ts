import { db, getKV } from './db'
import type { AttachmentRecord, NoteRecord } from './types'
import { isSearchableText } from './attachment-files'
import { BACKGROUND_DOWNLOAD_PRIORITY } from './sync-pull'

// A note is found by its text, its tags, and the text of its small text files (Markdown, text, CSV),
// which sync keeps on the device for this. Files are indexed by word start ('forward'): 'full' indexes
// every substring, too much for files of up to 1 MB.
const MAX_FILE_TEXT = 200_000

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
        { field: 'files', tokenize: 'forward' },
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
    await fillIndex(idx, spaceId)
    void fetchMissingTextFiles(spaceId)
  } finally {
    building.delete(spaceId)
  }
}

async function fillIndex(idx: DocIndex, spaceId: number): Promise<void> {
  const notes = await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray()
  const files = await filesTextByNote(notes.map(n => n.id!))
  for (const n of notes) addOrUpdateDoc(idx, n, files.get(n.id!) ?? '')
}

function addOrUpdateDoc(idx: DocIndex, n: NoteRecord, files: string) {
  const doc = { id: n.id!, text: n.text, tags: (n.tags || []).join(' '), files }
  try { idx.remove(n.id!) } catch {}
  idx.add(doc)
}

// Text of a file by attachment id; a new version of a file is a new attachment, so the id is enough.
const fileTextCache = new Map<number, string>()

async function fileText(a: AttachmentRecord): Promise<string> {
  const cached = fileTextCache.get(a.id!)
  if (cached != null) return cached
  let text = ''
  try { text = (await a.data!.text()).slice(0, MAX_FILE_TEXT) } catch {}
  fileTextCache.set(a.id!, text)
  return text
}

/** The searchable text files of these notes that are on this device, joined per note. */
async function filesTextByNote(noteIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (noteIds.length === 0) return out
  const atts = await db.attachments.where('noteId').anyOf(noteIds).filter(a => !a.deletedAt && !!a.data && isSearchableText(a)).toArray()
  for (const a of atts) {
    const text = `${a.fileName}\n${await fileText(a)}`
    out.set(a.noteId, out.has(a.noteId) ? `${out.get(a.noteId)}\n${text}` : text)
  }
  return out
}

/**
 * Text files pulled before they were fetched in the background (older versions of the app) are
 * fetched now, once per space and session, so search can find them.
 */
const backfilled = new Set<number>()
async function fetchMissingTextFiles(spaceId: number): Promise<void> {
  if (backfilled.has(spaceId)) return
  backfilled.add(spaceId)
  const noteIds = await db.notes.where('spaceId').equals(spaceId).primaryKeys() as number[]
  const missing = await db.attachments.where('noteId').anyOf(noteIds).filter(a => !a.deletedAt && !a.data && !!a.serverId && isSearchableText(a)).toArray()
  if (missing.length === 0) return
  const { requestAttachmentPrefetch } = await import('./sync')
  for (const a of missing) await requestAttachmentPrefetch(a.id!, BACKGROUND_DOWNLOAD_PRIORITY)
}

/** Notes matching the query, best first. inFiles: also look inside their text files. */
export async function searchNotes(spaceId: number, query: string, opts: { inFiles?: boolean } = {}): Promise<number[]> {
  if (!query.trim()) return []
  await ensureNoteIndexForSpace(spaceId)
  const idx = indexes.get(spaceId)
  if (!idx) return []
  const fields = opts.inFiles ? ['text', 'tags', 'files'] : ['text', 'tags']
  const res = idx.search(query, { index: fields, enrich: true, suggest: true }) as Array<{ result: Array<{ id: number }> }>
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
    // A downloaded text file joins its note in the index. Downloads come in bursts: rebuild once after.
    let jobsTimer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener('focuz:jobs-changed', () => {
      if (jobsTimer) clearTimeout(jobsTimer)
      jobsTimer = setTimeout(async () => {
        jobsTimer = null
        const spaceId = await getKV<number>('currentSpaceId')
        if (spaceId && indexes.has(spaceId)) await rebuildSpaceIndex(spaceId)
      }, 800)
    })
  } catch {}
}

async function rebuildSpaceIndex(spaceId: number): Promise<void> {
  await loadFlexSearch()
  if (!FlexSearchLib) return
  const idx = indexes.get(spaceId) || createIndex()
  indexes.set(spaceId, idx)
  try { idx.clear() } catch {}
  await fillIndex(idx, spaceId)
}

listenEvents()

export async function initSearch(): Promise<void> {
  await loadFlexSearch()
} 