import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { useAppState } from './app-state'
import type { AttachmentRecord } from './types'

// uploading: on its way to the server now; waiting: no connection, it goes when the server is back;
// failed: gave up, the sync status popover can retry it.
export type UploadState = 'uploading' | 'waiting' | 'failed'

const NO_STATES = new Map<number, UploadState>()

/** Upload state of the note images that are not on the server yet. */
export function useUploadStates(attachments: AttachmentRecord[]): Map<number, UploadState> {
  const online = useAppState(s => s.online && s.serverReachable && !s.authRequired)
  const ids = attachments.filter(a => !a.serverId && a.id != null).map(a => a.id!)
  const key = ids.join(',')
  const jobs = useLiveQuery(
    () => ids.length ? db.jobs.where('attachmentId').anyOf(ids).filter(j => j.kind === 'attachment-upload').toArray() : [],
    // `ids` is rebuilt every render; `key` is its value.
    [key],
  )
  if (!jobs || jobs.length === 0) return NO_STATES
  const out = new Map<number, UploadState>()
  for (const j of jobs) out.set(j.attachmentId, j.status === 'failed' ? 'failed' : online ? 'uploading' : 'waiting')
  return out
}
