import { useRef, useState } from 'react'
import { importIntoSpace } from '../lib/data-transfer'
import { IMAGE_MIN_SHORT_SIDE } from '../lib/image'
import { isExportActive, openExportOptions, useExportState } from '../lib/export-job'
import { notify } from '../ui/notify'

/** Settings → Data: export the open space to a file, or add the notes of a file to it. Works offline. */
export default function DataTab({ spaceId, spaceName, canWrite }: { spaceId: number | null; spaceName: string; canWrite: boolean }) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const exporting = isExportActive(useExportState())
  const ready = spaceId != null && !busy

  async function doImport(file: File) {
    if (spaceId == null) return
    setBusy(true); setError(null); setReport(null)
    try {
      const r = await importIntoSpace(spaceId, file)
      const lines = [`Imported ${r.notes} ${r.notes === 1 ? 'note' : 'notes'} and ${r.pictures} ${r.pictures === 1 ? 'file' : 'files'}.`]
      if (r.skippedPictures > 0) lines.push(`${r.skippedPictures} ${r.skippedPictures === 1 ? 'file was' : 'files were'} skipped: too large, unreadable, or a picture smaller than notes take (${IMAGE_MIN_SHORT_SIDE} px on the short side).`)
      if (r.skippedActivities > 0) lines.push(`${r.skippedActivities} ${r.skippedActivities === 1 ? 'activity was' : 'activities were'} skipped (its type is not in this space).`)
      setReport(lines.join(' '))
      notify('Notes imported', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="settings-label">Export</div>
        <p className="settings-note">
          Saves the notes of {spaceName ? <b>{spaceName}</b> : 'this space'} to a file: text, tags, dates, activities and, if you tick it, the pictures and files.
          With pictures, every picture is downloaded to this device first, so keep this tab open until the export is complete.
        </p>
        <button type="button" className="button" disabled={spaceId == null} onClick={() => { if (spaceId != null) openExportOptions({ spaceId, spaceName }) }}>
          {exporting ? 'Show export progress' : 'Export notes…'}
        </button>
      </section>

      <section className="space-y-2">
        <div className="settings-label">Import</div>
        <p className="settings-note">
          Adds the notes of a Focuz export file to this space as new notes. Existing notes stay as they are.
          The notes are saved on this device and sent to the server when it is reachable.
        </p>
        {!canWrite && <p className="settings-note">Only editors and admins can add notes to this space.</p>}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f) }}
        />
        <button type="button" className="button button-secondary" disabled={!ready || !canWrite} onClick={() => fileInput.current?.click()}>
          {busy ? 'Importing…' : 'Choose a file to import'}
        </button>
      </section>

      {report && <p className="settings-ok" role="status">{report}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
  )
}
