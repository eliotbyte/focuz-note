import { useEffect, useMemo } from 'react'

/**
 * Memoizes a Blob URL for the provided Blob/File and revokes it on change/unmount.
 */
export function useObjectUrl(obj?: Blob | MediaSource | null): string | undefined {
  const url = useMemo(() => (obj ? URL.createObjectURL(obj) : undefined), [obj])

  useEffect(() => {
    return () => {
      if (url) {
        try { URL.revokeObjectURL(url) } catch {}
      }
    }
  }, [url])

  return url
}



// Blob URLs of note images, shared by every view of the same image.
// IndexedDB hands out a new Blob object on every read, so keying URLs on the Blob would make each
// database change (an upload finishing, a sync) re-create the URL and re-decode every picture.
const RELEASE_DELAY_MS = 60_000
const shared = new Map<string, { url: string; refs: number; timer: ReturnType<typeof setTimeout> | null }>()

function scheduleRelease(key: string) {
  const entry = shared.get(key)
  if (!entry || entry.refs > 0 || entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = null
    if (entry.refs > 0) return
    shared.delete(key)
    try { URL.revokeObjectURL(entry.url) } catch {}
  }, RELEASE_DELAY_MS)
}

/** Blob URL for a stored image; stays the same while the record's image stays the same. */
export function useAttachmentUrl(att: { id?: number; data?: Blob | null }): string | undefined {
  const blob = att.data ?? null
  const key = blob && att.id != null ? `${att.id}:${blob.size}:${blob.type}` : null
  const url = useMemo(() => {
    if (!key || !blob) return undefined
    let entry = shared.get(key)
    if (!entry) {
      entry = { url: URL.createObjectURL(blob), refs: 0, timer: null }
      shared.set(key, entry)
      scheduleRelease(key)
    }
    return entry.url
    // The key identifies the image; a new Blob object with the same key is the same picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!key) return
    const entry = shared.get(key)
    if (!entry) return
    entry.refs++
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
    return () => {
      entry.refs--
      scheduleRelease(key)
    }
  }, [key])

  return url
}
