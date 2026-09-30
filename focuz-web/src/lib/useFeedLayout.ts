import { useLiveQuery } from 'dexie-react-hooks'
import { kv } from '../data'
import { db } from './db'
import { updateFilterLocal } from './local-writes'
import { DEFAULT_LAYOUT, layoutFromParams, layoutFromValue, paramsWithLayout, type FeedLayout } from './feed-layout'
import type { FolderIndex } from './folders'

type View = { kind: 'all' } | { kind: 'unsorted' } | { kind: 'folder'; id: number }

/**
 * The layout of the feed being shown and a way to change it. A folder keeps it in its params (so it
 * follows the folder to other devices); other views, and folders you may not change, keep it here.
 */
export function useFeedLayout(spaceId: number | null, view: View, index: FolderIndex | undefined, mayChangeFolders: boolean): [FeedLayout, (next: FeedLayout) => void] {
  const node = view.kind === 'folder' ? index?.nodes.get(view.id) : undefined
  const inFolder = !!node && mayChangeFolders
  const localKey = spaceId == null ? null
    : view.kind === 'folder' ? (node ? `layout:space:${spaceId}:folder:${node.serverId ?? node.clientId ?? node.id}` : null)
    : `layout:space:${spaceId}:${view.kind}`
  const local = useLiveQuery(() => (localKey && !inFolder ? kv.get<unknown>(localKey) : undefined), [localKey, inFolder])

  const layout = inFolder ? layoutFromParams(node!.rec.params) : local != null ? layoutFromValue(local) : DEFAULT_LAYOUT

  const set = (next: FeedLayout) => {
    if (next.mode === layout.mode && next.cols === layout.cols) return
    if (inFolder) {
      const id = node!.id
      void db.filters.get(id).then(rec => rec && updateFilterLocal(id, { params: paramsWithLayout(rec.params, next) }))
    } else if (localKey) {
      void kv.set(localKey, next)
    }
  }
  return [layout, set]
}
