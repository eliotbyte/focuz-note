// "Search in files": whether the feed's search also looks inside a note's text files. A setting of
// this device, remembered between visits; off by default, so a search finds what the notes say.
import { useSyncExternalStore } from 'react'

const KEY = 'focuz:searchInFiles'
const listeners = new Set<() => void>()

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

let current = read()

export function setSearchInFiles(on: boolean): void {
  current = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
  for (const l of listeners) l()
}

export function useSearchInFiles(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => current,
  )
}
