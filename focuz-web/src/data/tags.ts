import { db } from '../lib/db'

function normalizeBase(tagText: string): string {
  return tagText.startsWith('!') ? tagText.slice(1) : tagText
}

export async function suggest({
  spaceId,
  selected,
  query,
  invertible,
  limit = 10,
}: {
  spaceId: number
  selected: string[]
  query: string
  invertible?: boolean
  limit?: number
}): Promise<string[]> {
  // Exclude already selected tags (ignore invert flag when invertible)
  const selectedSet = new Set(
    selected.map(v => (invertible ? normalizeBase(v) : v).toLowerCase())
  )
  const rawQ = (query || '').trim()
  const baseQ = invertible && rawQ.startsWith('!') ? rawQ.slice(1) : rawQ
  const q = baseQ.toLowerCase()

  // Build last used map from recent notes for ordering
  const lastUsed = new Map<string, string>() // tagLower -> ISO modifiedAt
  const recentNotes = await db.notes.orderBy('modifiedAt').reverse().limit(500).toArray()
  for (const n of recentNotes) {
    if (n.spaceId !== spaceId || n.deletedAt) continue
    for (const t of (n.tags || [])) {
      const low = (t || '').toLowerCase()
      const prev = lastUsed.get(low)
      if (!prev || n.modifiedAt > prev) lastUsed.set(low, n.modifiedAt)
    }
  }

  let candidates: string[] = []
  if (q) {
    const all = await db.tags.where('spaceId').equals(spaceId).filter(t => !t.deletedAt && (t.name || '').toLowerCase().startsWith(q)).toArray()
    candidates = all.map(t => t.name).filter(Boolean) as string[]
  } else {
    candidates = Array.from(new Set(Array.from(lastUsed.keys())))
  }

  const unique: string[] = []
  for (const name of candidates) {
    const low = name.toLowerCase()
    if (!selectedSet.has(low) && !unique.some(x => x.toLowerCase() === low)) unique.push(name)
  }
  unique.sort((a, b) => {
    const ya = lastUsed.get(a.toLowerCase()) || ''
    const yb = lastUsed.get(b.toLowerCase()) || ''
    if (ya !== yb) return ya > yb ? -1 : 1
    return a.localeCompare(b)
  })
  return unique.slice(0, limit)
}

