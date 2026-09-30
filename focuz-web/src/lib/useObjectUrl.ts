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


