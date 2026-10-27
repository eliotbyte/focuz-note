import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import CloudOffRounded from '@mui/icons-material/CloudOffRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import type { UploadState } from '../lib/useUploadStates'
import { db } from '../lib/db'
import { deleteLocalAttachment, retryFailedAttachments } from '../lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export default function UploadBadge({ state, attachmentId }: { state?: UploadState; attachmentId?: number }) {
  if (!state) return null
  if (state === 'failed' && attachmentId != null) return <FailedBadge attachmentId={attachmentId} />
  const title = state === 'uploading' ? 'Uploading…' : state === 'waiting' ? 'Waiting for connection' : 'Upload failed'
  return (
    <span className={`upload-badge is-${state}`} title={title} aria-label={title} role="status">
      {state === 'uploading' ? <span className="upload-spinner" /> : state === 'waiting' ? <CloudOffRounded fontSize="inherit" /> : <ErrorOutlineRounded fontSize="inherit" />}
    </span>
  )
}

// The server refused the file: waiting will not help, so the badge says why and what can be done.
function FailedBadge({ attachmentId }: { attachmentId: number }) {
  const [open, setOpen] = useState(false)
  const reason = useLiveQuery(
    () => db.jobs.where('attachmentId').equals(attachmentId).filter(j => j.kind === 'attachment-upload').first().then(j => j?.lastError ?? null),
    [attachmentId],
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="upload-badge is-failed is-action" aria-label="Not uploaded. Show why"
          onClick={e => e.stopPropagation()}>
          <ErrorOutlineRounded fontSize="inherit" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-4 w-72 text-sm" onClick={e => e.stopPropagation()}>
        <div className="text-primary">Not uploaded: the server did not accept this file.</div>
        {reason && <div className="mt-1 text-secondary break-words">{reason}</div>}
        <div className="mt-1 text-secondary">It is only on this device.</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="button button-secondary" onClick={() => { setOpen(false); void deleteLocalAttachment(attachmentId) }}>
            Remove
          </button>
          <button type="button" className="button" onClick={() => { setOpen(false); void retryFailedAttachments(attachmentId) }}>
            Try again
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
