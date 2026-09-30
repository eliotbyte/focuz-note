import CloudOffRounded from '@mui/icons-material/CloudOffRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import type { UploadState } from '../lib/useUploadStates'

export default function UploadBadge({ state }: { state?: UploadState }) {
  if (!state) return null
  const title = state === 'uploading' ? 'Uploading…' : state === 'waiting' ? 'Waiting for connection' : 'Upload failed'
  return (
    <span className={`upload-badge is-${state}`} title={title} aria-label={title} role="status">
      {state === 'uploading' ? <span className="upload-spinner" /> : state === 'waiting' ? <CloudOffRounded fontSize="inherit" /> : <ErrorOutlineRounded fontSize="inherit" />}
    </span>
  )
}
