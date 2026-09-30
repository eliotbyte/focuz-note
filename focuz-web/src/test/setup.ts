// fake-indexeddb clones values with Node's structuredClone, which does not know jsdom's
// Blob/File classes and turns them into {}. Real browsers store Blobs in IndexedDB, so keep
// Blob instances (immutable) by reference and deep-copy everything else.
const nodeClone = globalThis.structuredClone
function cloneKeepingBlobs(value: any): any {
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(cloneKeepingBlobs)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = cloneKeepingBlobs(v)
    return out
  }
  return nodeClone(value)
}
globalThis.structuredClone = cloneKeepingBlobs as typeof structuredClone

await import('fake-indexeddb/auto')
