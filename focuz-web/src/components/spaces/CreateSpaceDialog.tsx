import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { createSpace, errorText } from '../../lib/spaces-api'

/** Name a new shared space; afterwards the members tab opens to invite people. */
export default function CreateSpaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (localId: number) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try { onCreated(await createSpace(name)) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-5 space-y-4">
        <DialogTitle className="!text-primary !text-[17px] font-semibold">Create a space</DialogTitle>
        <DialogDescription className="text-sm">
          A space is a separate set of notes you can share: invite people, give them roles, publish it. Your personal space stays private.
        </DialogDescription>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label htmlFor="new-space-name" className="settings-label">Name</label>
          <input id="new-space-name" className="input" autoFocus maxLength={100} placeholder="For example “Family” or “Book club”" value={name} onChange={e => setName(e.target.value)} />
          {error && <p className="settings-error" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="filter-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="button" disabled={busy || !name.trim()}>Create</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
