import { useRef, useState } from 'react'
import { downloadBlob, exportSpace, importIntoSpace } from '../lib/data-transfer'
import { notify } from '../ui/notify'

/** Settings → Data: export the open space to a file, or add the notes of a file to it. Works offline. */
export default function DataTab({ spaceId, spaceName, canWrite }: { spaceId: number | null; spaceName: string; canWrite: boolean }) {
  const [withPictures, setWithPictures] = useState(true)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const ready = spaceId != null && busy === null

  async function doExport() {
    if (spaceId == null) return
    setBusy('export'); setError(null); setReport(null); setProgress(null)
    try {
      const res = await exportSpace(spaceId, spaceName || 'space', withPictures, (done, total) => {
        if (total > 0) setProgress(`Downloading pictures ${done} of ${total}…`)
      })
      downloadBlob(res.blob, res.fileName)
      const parts = [`${res.noteCount} ${res.noteCount === 1 ? 'note' : 'notes'}`]
      if (withPictures) parts.push(`${res.pictureCount} ${res.pictureCount === 1 ? 'picture' : 'pictures'}`)
      let text = `Exported ${parts.join(' and ')}.`
      if (res.missingPictures > 0) text += ` ${res.missingPictures} ${res.missingPictures === 1 ? 'picture is' : 'pictures are'} not on this device and ${res.missingPictures === 1 ? 'is' : 'are'} not in the file.`
      setReport(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  async function doImport(file: File) {
    if (spaceId == null) return
    setBusy('import'); setError(null); setReport(null)
    try {
      const r = await importIntoSpace(spaceId, file)
      const lines = [`Imported ${r.notes} ${r.notes === 1 ? 'note' : 'notes'} and ${r.pictures} ${r.pictures === 1 ? 'picture' : 'pictures'}.`]
      if (r.skippedPictures > 0) lines.push(`${r.skippedPictures} ${r.skippedPictures === 1 ? 'picture was' : 'pictures were'} skipped (too large or unreadable).`)
      if (r.skippedActivities > 0) lines.push(`${r.skippedActivities} ${r.skippedActivities === 1 ? 'activity was' : 'activities were'} skipped (its type is not in this space).`)
      setReport(lines.join(' '))
      notify('Notes imported', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="settings-label">Export</div>
        <p className="settings-note">
          Saves the notes of {spaceName ? <b>{spaceName}</b> : 'this space'}: text, tags, dates, activities and, if you tick it, the pictures.
          With pictures, every picture is downloaded to this device first, so the export waits for all of them.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withPictures} onChange={e => setWithPictures(e.target.checked)} />
          Include pictures (saved as a zip)
        </label>
        <button type="button" className="button" disabled={!ready} onClick={() => { void doExport() }}>
          {busy === 'export' ? (progress ?? 'Exporting…') : 'Export notes'}
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
          {busy === 'import' ? 'Importing…' : 'Choose a file to import'}
        </button>
      </section>

      {report && <p className="settings-ok" role="status">{report}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
  )
}
