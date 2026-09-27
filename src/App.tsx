import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord, FilterRecord, SpaceRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, isAuthenticated, logout, deleteNote, addLocalAttachment, teardownSync, purgeAndLogout, countUnsyncedChanges } from './lib/sync'
import { updateNoteLocal, createFilterLocal, updateFilterLocal } from './lib/sync'
import { searchNotes, ensureNoteIndexForSpace, initSearch } from './lib/search'
import { activityTypes as activityTypesRepo, activities as activitiesRepo, filters as filtersRepo, kv, notes as notesRepo, spaces as spacesRepo } from './data'
import { initAppState, useAppState } from './lib/app-state'
import { featureFlags } from './lib/feature-flags'
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { SystemStatusInline, SystemStatusLayer } from './components/SystemStatus'
import { notifyUndoable } from './ui/notify'
import { AppToaster } from './ui/toaster'
import NoteEditor, { type NoteEditorValue } from './components/NoteEditor'
import NoteCard from './components/NoteCard'
import TagsInput from './components/TagsInput'
import FiltersTree from './components/FiltersTree'
import AuthScreen, { ReauthDialog } from './components/AuthScreen'
import ActivitiesPicker from './components/ActivitiesPicker'
import { applyStoredTheme, setStoredTheme } from './lib/theme'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

function TopBar({
  onOpenSpaces,
  onOpenSettings,
  onLogout,
  isThread,
  onBack,
}: {
  onOpenSpaces: () => void
  onOpenSettings: () => void
  onLogout: () => void
  isThread?: boolean
  onBack?: () => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)_270px] xl:grid-cols-[270px_minmax(0,1fr)_290px] gap-6 items-center">
      <div className="flex items-center gap-3">
        {isThread ? (
          <button className="icon-btn icon-35" onClick={onBack} type="button" aria-label="Back">
            <ArrowBackRoundedIcon fontSize="inherit" />
          </button>
        ) : (
          <button className="icon-btn icon-35" onClick={onOpenSpaces} type="button" aria-label="Open spaces">
            <MenuRoundedIcon fontSize="inherit" />
          </button>
        )}
        <h1 className="text-title text-primary">focuz</h1>
      </div>
      <div className="hidden md:block" />
      <div className="flex items-center justify-end gap-2">
        <SystemStatusInline />
        <button className="icon-btn icon-35" onClick={onOpenSettings} type="button" aria-label="Settings">
          <SettingsRoundedIcon fontSize="inherit" />
        </button>
        <button className="icon-btn icon-35" onClick={onLogout} type="button" aria-label="Logout">
          <LogoutRoundedIcon fontSize="inherit" />
        </button>
      </div>
    </div>
  )
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme || 'dark')
  function save() {
    setStoredTheme(theme === 'light' ? 'light' : 'dark')
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden">
        <div className="space-y-4">
          <DialogTitle>Settings</DialogTitle>
          <div className="flex items-center justify-between gap-6">
            <label className="text-secondary">Theme</label>
            <select className="input w-[180px]" value={theme} onChange={e => setTheme(e.target.value)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button className="button" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="button" onClick={save}>Save</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SpaceDrawer({ open, onClose, currentId, onSelected, children }: { open: boolean; onClose: () => void; currentId?: number | null; onSelected?: (id: number) => void; children?: ReactNode }) {
  const spaces = useLiveQuery(() => spacesRepo.listAll(), []) ?? []
  async function selectSpace(id: number) {
    await kv.set('currentSpaceId', id)
    await runSync()
    if (onSelected) onSelected(id)
    else onClose()
  }
  return (
    <div className={`fixed inset-0 z-[80] transition ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/60 ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        className={`absolute left-0 top-0 h-full w-72 max-w-[85vw] flex flex-col ${open ? '' : '-translate-x-full'} transition-transform`}
        style={{
          background: 'rgb(var(--c-surface))',
          boxShadow: 'var(--shadow-surface)',
          borderTopRightRadius: 'var(--radius)',
          borderBottomRightRadius: 'var(--radius)',
        }}
      >
        <div className="p-4">
          <h2 className="text-title text-muted mb-3">Spaces</h2>
          <ul className="space-y-1">
            {spaces.map((s: SpaceRecord) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={[
                    'w-full text-left px-3 py-1.5 rounded-[var(--radius-control)] transition-colors',
                    (currentId === s.id ? 'text-primary' : 'text-secondary hover:text-primary'),
                  ].join(' ')}
                  style={currentId === s.id ? { background: 'rgba(var(--c-text) / 0.03)' } : undefined}
                  onClick={() => selectSpace(s.id!)}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {children ? <div className="md:hidden flex-1 min-h-0 px-2 pb-3">{children}</div> : null}
      </aside>
    </div>
  )
}

type SortField = 'date' | 'createdat' | 'modifiedat'

function hasActiveQuickFilters(quick: any) {
  const q = quick || {}
  const text = String(q.text || '').trim()
  const tags = Array.isArray(q.tags) ? q.tags : []
  const activities = featureFlags.quickFiltersActivities && Array.isArray(q.activities) ? q.activities : []
  const noParents = !!q.noParents
  return !!text || tags.length > 0 || activities.length > 0 || noParents
}

function QuickFiltersPanel({
  value,
  onChange,
  hideNoParents = false,
  spaceId,
}: {
  value: { text: string; tags: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }
  onChange: (v: { text: string; tags: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }) => void
  hideNoParents?: boolean
  spaceId?: number | null
}) {
  const [text, setText] = useState(value.text)
  const [tags, setTags] = useState<string[]>(Array.isArray((value as any).tags) ? (value as any).tags : [])
  const [activities, setActivities] = useState<string[]>(featureFlags.quickFiltersActivities && Array.isArray((value as any).activities) ? (value as any).activities : [])
  const [noParents, setNoParents] = useState(value.noParents)
  const [sortField, setSortField] = useState<SortField>(value.sort.split(',')[0] as SortField)
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>(value.sort.split(',')[1] as 'ASC' | 'DESC')

  useEffect(() => {
    setText(value.text)
    setTags(Array.isArray((value as any).tags) ? (value as any).tags : [])
    setActivities(featureFlags.quickFiltersActivities && Array.isArray((value as any).activities) ? (value as any).activities : [])
    setNoParents(value.noParents)
    setSortField(value.sort.split(',')[0] as SortField)
    setSortDir(value.sort.split(',')[1] as 'ASC' | 'DESC')
  }, [value])

  return (
    <div className="min-w-0">
      <div className="card h-full flex flex-col">
        <div className="text-title text-muted">Quick filters</div>
        {/* NOTE: padding is intentional to prevent child shadows from being clipped by the scroll container */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
          <input className="input" placeholder="Search" value={text} onChange={e => {
            const v = e.target.value
            setText(v)
            onChange({ text: v, tags, activities: featureFlags.quickFiltersActivities ? activities : undefined, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` })
          }} />
          <div>
            <TagsInput
              value={tags}
              onChange={(next) => { setTags(next); onChange({ text, tags: next, activities, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}
              placeholder="Tags"
              className="mt-1"
              spaceId={spaceId ?? undefined}
              invertible
            />
          </div>
          {featureFlags.quickFiltersActivities ? (
            <ActivitiesPicker
              value={activities}
              onChange={(next) => { setActivities(next); onChange({ text, tags, activities: next, noParents, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}
              spaceId={spaceId}
            />
          ) : null}
          {!hideNoParents && (
            <label className="flex items-center gap-3 text-secondary">
              <input type="checkbox" checked={noParents} onChange={e => { setNoParents(e.target.checked); onChange({ text, tags, noParents: e.target.checked, sort: `${sortField},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }} />
              No parents
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="input flex items-center justify-between">
                  <span className="truncate">{sortField === 'modifiedat' ? 'modified_at' : sortField === 'createdat' ? 'created_at' : 'date'}</span>
                  <span aria-hidden>▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => { const f: SortField = 'modifiedat'; setSortField(f); onChange({ text, tags, noParents, sort: `${f},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
                  modified_at
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { const f: SortField = 'createdat'; setSortField(f); onChange({ text, tags, noParents, sort: `${f},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
                  created_at
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { const f: SortField = 'date'; setSortField(f); onChange({ text, tags, noParents, sort: `${f},${sortDir}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
                  date
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="input flex items-center justify-between">
                  <span className="truncate">{sortDir === 'DESC' ? 'desc' : 'asc'}</span>
                  <span aria-hidden>▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => { const d: 'ASC' | 'DESC' = 'DESC'; setSortDir(d); onChange({ text, tags, noParents, sort: `${sortField},${d}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
                  desc
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { const d: 'ASC' | 'DESC' = 'ASC'; setSortDir(d); onChange({ text, tags, noParents, sort: `${sortField},${d}` as `${SortField},ASC` | `${SortField},DESC` }) }}>
                  asc
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!hideNoParents && spaceId && (
            <div className="flex justify-between pt-2">
              <button className="button" onClick={() => window.dispatchEvent(new CustomEvent('focuz:open-save-filter'))}>Save</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NoteComposer({ spaceId, positiveQuickTags = [] }: { spaceId: number; positiveQuickTags?: string[] }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])

  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    const noteId = await notesRepo.addDraft(payload)
    // Persist activities drafts (if any)
    if (featureFlags.noteCreateAddActivity && Array.isArray((value as any).activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of (value as any).activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }
    setValue({ text: '', tags: [] })
  }

  async function addNoteWithAttachments(extra: { attachments?: File[] }) {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const noteId = await notesRepo.addDraft({
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: null,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    } as NoteRecord)
    if (featureFlags.noteCreateAddActivity && Array.isArray((value as any).activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of (value as any).activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }

    const files = (extra.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try {
        await addLocalAttachment(noteId, f)
      } catch {}
    }

    setValue({ text: '', tags: [] })
  }

  return (
        <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onSubmitWithExtra={addNoteWithAttachments} onCancel={() => setValue({ text: '', tags: [] })} mode="create" spaceId={spaceId} />
  )
}

function NoteList({ spaceId, filter, quick, parentId, onOpenThread, onAddQuickTag, onAddQuickActivity }: { spaceId: number; filter: FilterRecord | null; quick: { text: string; tags?: string[]; activities?: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }; parentId?: number | null; onOpenThread?: (noteId: number) => void; onAddQuickTag?: (tag: string) => void; onAddQuickActivity?: (name: string) => void }) {
  const [idsBySearch, setIdsBySearch] = useState<number[] | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<{ text: string; tags: string[]; activities?: any[] }>({ text: '', tags: [], activities: [] })
  const [replyingForId, setReplyingForId] = useState<number | null>(null)

  useEffect(() => {
    ensureNoteIndexForSpace(spaceId).catch(() => {})
  }, [spaceId])

  useEffect(() => {
    let cancelled = false
    const q = (quick.text || '').trim()
    if (!q) { setIdsBySearch(null); return }
    searchNotes(spaceId, q).then(ids => { if (!cancelled) setIdsBySearch(ids) }).catch(() => { if (!cancelled) setIdsBySearch([]) })
    return () => { cancelled = true }
  }, [spaceId, quick.text])

  useEffect(() => {
    if (editingId != null) {
      const n = notes.find(x => x.id === editingId)
      if (n) setEditingValue({ text: n.text, tags: n.tags || [] })
    }
  }, [editingId])

  // Reset replying editor on filter/quick changes and when thread parent changes
  useEffect(() => {
    setReplyingForId(null)
  }, [JSON.stringify(quick), JSON.stringify(filter?.params ?? {}), parentId ?? null])

  const notes = useLiveQuery(async () => {
    const arr = await notesRepo.listActiveBySpace(spaceId)
    let result = arr

    if (idsBySearch) {
      const set = new Set(idsBySearch)
      result = result.filter(n => set.has(n.id!))
      // keep order by search ranking for equal sort later
      const rank = new Map(idsBySearch.map((id, i) => [id, i]))
      result.sort((a,b) => (rank.get(a.id!)! - rank.get(b.id!)!))
    } else if (filter?.params?.textContains) {
      const q = filter.params.textContains.toLowerCase()
      result = result.filter(n => n.text.toLowerCase().includes(q))
    }

    if (parentId != null) {
      result = result.filter(n => (n.parentId ?? null) === parentId)
    } else if (quick.noParents || filter?.params?.notReply) {
      result = result.filter(n => (n.parentId ?? null) === null)
    }
    if (filter?.params?.includeTags?.length) {
      result = result.filter(n => filter!.params!.includeTags!.every(t => n.tags.includes(t)))
    }
    // Activities filter: include notes that have ALL selected activity type names
    const quickActivities = featureFlags.quickFiltersActivities ? (((quick as any).activities as string[]) || []) : []
    const includeActivitiesNames = new Set<string>([...(((filter?.params as any)?.includeActivities as string[]) || []), ...quickActivities])
    if (includeActivitiesNames.size > 0) {
      // Build a map of noteId -> names present
      const acts = await activitiesRepo.listActiveForNotes(result.map(n => n.id!))
      const types = await activityTypesRepo.listAll()
      const nameByTypeId = new Map(types.map(t => [t.serverId!, t.name]))
      const byNote = new Map<number, Set<string>>()
      for (const a of acts) {
        if (a.deletedAt) continue
        const n = nameByTypeId.get(a.typeId)
        if (!n) continue
        const set = byNote.get(a.noteId) || new Set<string>()
        set.add(n)
        byNote.set(a.noteId, set)
      }
      result = result.filter(n => {
        const set = byNote.get(n.id!) || new Set<string>()
        for (const name of includeActivitiesNames) if (!set.has(name)) return false
        return true
      })
    }
    const quickTags = (quick as any).tags as string[] | undefined
    if (quickTags && quickTags.length > 0) {
      const includeTags = quickTags.filter(t => !t.startsWith('!'))
      const excludeTags = quickTags.filter(t => t.startsWith('!')).map(t => t.slice(1))
      if (includeTags.length > 0) {
        result = result.filter(n => (n.tags || []).length > 0 && includeTags.every(t => n.tags.includes(t)))
      }
      if (excludeTags.length > 0) {
        result = result.filter(n => !excludeTags.some(t => (n.tags || []).includes(t)))
      }
    }
    if (filter?.params?.excludeTags?.length) {
      result = result.filter(n => !filter!.params!.excludeTags!.some(t => n.tags.includes(t)))
    }

    const sort = quick.sort || filter?.params?.sort || 'modifiedat,DESC'
    result.sort((a, b) => {
      const field = (typeof sort === 'string' ? sort.split(',')[0] : 'modifiedat') as SortField
      const dir = (typeof sort === 'string' ? sort.split(',')[1] : 'DESC') as 'ASC' | 'DESC'
      const aKey = field === 'createdat' ? (a.createdAt) : field === 'modifiedat' ? (a.modifiedAt) : (a.date || a.createdAt)
      const bKey = field === 'createdat' ? (b.createdAt) : field === 'modifiedat' ? (b.modifiedAt) : (b.date || b.createdAt)
      const cmp = aKey.localeCompare(bKey)
      return dir === 'ASC' ? cmp : -cmp
    })

    return result
  }, [spaceId, JSON.stringify(filter?.params ?? {}), JSON.stringify(quick), JSON.stringify(idsBySearch), parentId ?? null]) ?? []

  // Parent previews no longer preloaded here; NoteCard handles parent preview on demand
  const repliesById = useLiveQuery(async () => {
    return notesRepo.getRepliesTallyBySpace(spaceId)
  }, [spaceId]) || new Map<number, number>()

  async function removeNote(id: number) {
    await deleteNote(id)
    window.dispatchEvent(new Event('focuz:local-write'))
    // Toast with undo
    notifyUndoable('Note deleted', { label: 'Undo', onClick: () => notesRepo.restoreDeleted(id) })
  }

  async function saveEdit(id: number, value: { text: string; tags: string[]; activities?: any[] }) {
    await updateNoteLocal(id, { text: value.text.trim(), tags: value.tags })
    // Persist activities edits locally: upsert new/edited and mark removed as deleted
    if (Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity, deleteLocalActivity } = await import('./lib/sync')
      const existing = await activitiesRepo.listForNote(id)
      const current = existing.filter(a => !a.deletedAt)
      const nextTypeIds = new Set<number>(value.activities.map(a => a?.typeId).filter((x: any) => typeof x === 'number'))
      // upsert current values
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(id, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
      // delete removed
      for (const a of current) {
        if (!nextTypeIds.has(a.typeId)) {
          try { await deleteLocalActivity(id, a.typeId) } catch {}
        }
      }
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditingId(null)
  }

  async function saveEditWithAttachments(id: number, value: { text: string; tags: string[]; activities?: any[] }, extra?: { attachments?: File[] }) {
    await updateNoteLocal(id, { text: value.text.trim(), tags: value.tags })
    if (Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity, deleteLocalActivity } = await import('./lib/sync')
      const existing = await activitiesRepo.listForNote(id)
      const current = existing.filter(a => !a.deletedAt)
      const nextTypeIds = new Set<number>(value.activities.map(a => a?.typeId).filter((x: any) => typeof x === 'number'))
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(id, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
      for (const a of current) {
        if (!nextTypeIds.has(a.typeId)) {
          try { await deleteLocalActivity(id, a.typeId) } catch {}
        }
      }
    }
    const files = (extra?.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try { await addLocalAttachment(id, f) } catch {}
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditingId(null)
  }

  const [replyValue, setReplyValue] = useState<{ text: string; tags: string[]; activities?: any[] }>({ text: '', tags: [] })

  async function addInlineReply(parent: NoteRecord, value: { text: string; tags: string[]; activities?: any[] }) {
    const canAdd = value.text.trim().length > 0
    if (!canAdd) return
    const now = new Date().toISOString()
    const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId: parent.id!,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    const newId = await notesRepo.addDraft(payload)
    if (featureFlags.noteCreateAddActivity && Array.isArray(value.activities)) {
      const { createOrUpdateLocalActivity } = await import('./lib/sync')
      for (const a of value.activities) {
        if (!a || typeof a.typeId !== 'number') continue
        try { await createOrUpdateLocalActivity(newId, a.typeId, String(a.valueRaw ?? '')) } catch {}
      }
    }
    setReplyingForId(null)
    setReplyValue({ text: '', tags: [] })
  }

  return (
    <ul className="space-y-3">
      {notes.flatMap((n: NoteRecord) => {
        const items: ReactNode[] = []
        const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
        const hiddenTagsSet = new Set(positiveQuickTags)
        // Note item (either editor replacing the note, or the note card)
        items.push(
          <li key={n.id} id={`feed-note-${n.id}`} data-feed-note-id={n.id}>
            {editingId === n.id ? (
              <NoteEditor
                value={editingValue}
                onChange={setEditingValue}
                onSubmit={() => saveEdit(n.id!, editingValue)}
                onSubmitWithExtra={(extra) => saveEditWithAttachments(n.id!, editingValue, extra)}
                onCancel={() => setEditingId(null)}
                mode="edit"
                autoCollapse={false}
                variant="card"
                spaceId={spaceId}
                noteId={n.id!}
              />
            ) : (
              <NoteCard
                note={n}
                onEdit={() => { setEditingId(n.id!); setEditingValue({ text: n.text, tags: n.tags || [] }) }}
                onDelete={() => { removeNote(n.id!) }}
                onOpenThread={onOpenThread}
                showParentPreview={parentId == null && (n.parentId ?? null) != null}
                hiddenTags={hiddenTagsSet}
                onTagClick={(tag) => { if (onAddQuickTag) onAddQuickTag(tag) }}
                onActivityClick={(name) => { if (onAddQuickActivity) onAddQuickActivity(name) }}
                repliesCount={repliesById.get(n.id!) || 0}
                onReplyClick={() => setReplyingForId(replyingForId === n.id ? null : n.id!)}
              />
            )}
          </li>
        )
        // Reply form as a separate full card item below the note
        if (replyingForId === n.id) {
          items.push(
            <li key={`reply-form-${n.id}`}>
              <NoteEditor
                value={replyValue}
                onChange={setReplyValue}
                onSubmit={() => addInlineReply(n, replyValue)}
                onSubmitWithExtra={async (extra) => {
                  const canAdd = replyValue.text.trim().length > 0
                  if (!canAdd) return
                  const now = new Date().toISOString()
                  const positiveQuickTags = ((quick as any).tags || []).filter((t: string) => !t.startsWith('!')) as string[]
                  const mergedTags = Array.from(new Set([...(replyValue.tags || []), ...positiveQuickTags]))
                  const noteId = await notesRepo.addDraft({
                    spaceId,
                    title: null,
                    text: replyValue.text.trim(),
                    tags: mergedTags,
                    createdAt: now,
                    modifiedAt: now,
                    date: now,
                    parentId: n.id!,
                    deletedAt: null,
                    isDirty: 1,
                    serverId: null,
                    clientId: crypto.randomUUID(),
                  } as NoteRecord)
                  if (featureFlags.noteCreateAddActivity && Array.isArray(replyValue.activities)) {
                    const { createOrUpdateLocalActivity } = await import('./lib/sync')
                    for (const a of replyValue.activities) {
                      if (!a || typeof a.typeId !== 'number') continue
                      try { await createOrUpdateLocalActivity(noteId, a.typeId, String(a.valueRaw ?? '')) } catch {}
                    }
                  }
                  const files = (extra?.attachments ?? []).slice(0, 10)
                  for (const f of files) { try { await addLocalAttachment(noteId, f) } catch {} }
                  setReplyingForId(null)
                  setReplyValue({ text: '', tags: [] })
                }}
                onCancel={() => setReplyingForId(null)}
                mode="reply"
                autoCollapse={false}
                variant="card"
                defaultExpanded
                spaceId={spaceId}
              />
            </li>
          )
        }
        return items
      })}
      {notes.length === 0 && <li className="text-secondary">No notes</li>}
    </ul>
  )
}

function App() {
  const topbarRef = useRef<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTopRef = useRef(0)
  const lastDirRef = useRef<'up' | 'down' | null>(null)
  const rafRef = useRef<number | null>(null)
  const currentSpaceIdRef = useRef<number | null>(null)
  const currentNoteIdRef = useRef<number | null>(null)
  type FeedScrollSnapshot = number | { top: number; anchorNoteId?: number; anchorOffset?: number }
  const feedScrollRef = useRef<Record<number, FeedScrollSnapshot>>({})
  const feedRestoreReqRef = useRef<{ token: number; spaceId: number; snapshot: FeedScrollSnapshot; tries: number } | null>(null)
  const [headerHidden, setHeaderHidden] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authed, setAuthed] = useState<boolean>(isAuthenticated())
  const [currentSpaceId, setCurrentSpaceId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<FilterRecord | null>(null)
  const [currentNoteId, setCurrentNoteId] = useState<number | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  // In-memory back trail within tab. Oldest -> newest. Excludes current page. null represents feed (space root)
  const historyTrailRef = useRef<Array<number | null>>([])
  const authRequired = useAppState(s => s.authRequired)

  const [quickFeed, setQuickFeed] = useState<{ text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' })
  const [quickThread, setQuickThread] = useState<{ text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }>({ text: '', tags: [], noParents: false, sort: 'modifiedat,DESC' })

  useEffect(() => {
    initAppState()
  }, [])

  useEffect(() => { currentSpaceIdRef.current = currentSpaceId }, [currentSpaceId])
  useEffect(() => { currentNoteIdRef.current = currentNoteId }, [currentNoteId])

  // Ensure header is visible after auth transitions (otherwise content can be rendered with --topbar-effective-h=0).
  useEffect(() => {
    setHeaderHidden(false)
    lastScrollTopRef.current = 0
    lastDirRef.current = null
    // When switching to authed UI, force scroll container to top so header logic starts from a clean state.
    if (authed) requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 })
  }, [authed])

  // Sync CSS var with actual topbar height so we can reuse it for spacers/layout.
  useLayoutEffect(() => {
    const el = topbarRef.current
    const root = document.documentElement
    if (!authed || !el) {
      // Default: no topbar in unauthenticated UI.
      root.style.setProperty('--topbar-h', '96px')
      root.style.setProperty('--topbar-effective-h', '0px')
      return
    }
    const update = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      root.style.setProperty('--topbar-h', `${h}px`)
      // keep effective height in sync when header is visible
      if (!headerHidden) root.style.setProperty('--topbar-effective-h', `${h}px`)
    }
    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [authed, headerHidden])

  // Hide on scroll down, show on scroll up. At scrollTop=0 always show.
  useEffect(() => {
    const root = document.documentElement
    const setEffective = (visible: boolean) => {
      const h = getComputedStyle(root).getPropertyValue('--topbar-h').trim() || '96px'
      root.style.setProperty('--topbar-effective-h', visible ? h : '0px')
    }
    setEffective(authed && !headerHidden)
  }, [authed, headerHidden])

  // URL helpers
  function parseQuery(): { space?: number; note?: number; filter?: number } {
    const p = new URLSearchParams(location.search)
    const space = p.get('space')
    const note = p.get('note')
    const filter = p.get('filter')
    return { space: space ? Number(space) : undefined, note: note ? Number(note) : undefined, filter: filter ? Number(filter) : undefined }
  }
  function pushQuery(next: { space: number; note?: number | null; filter?: number | null }, replace = false) {
    const params = new URLSearchParams()
    params.set('space', String(next.space))
    if (next.note != null) params.set('note', String(next.note))
    if (next.filter != null) params.set('filter', String(next.filter))
    const url = `${location.pathname}?${params.toString()}`
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
  }

  function getFeedScrollKey(spaceId: number) { return `ui:scroll:space:${spaceId}:feed` }

  function computeFeedSnapshot(): FeedScrollSnapshot {
    const el = scrollRef.current
    if (!el) return 0
    const top = el.scrollTop
    // Anchor-based restore is more robust than raw scrollTop when list height changes.
    try {
      const containerTop = el.getBoundingClientRect().top
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-feed-note-id]'))
      let best: { id: number; offset: number; score: number } | null = null
      for (const n of nodes) {
        const raw = n.getAttribute('data-feed-note-id')
        const id = raw ? Number(raw) : NaN
        if (!Number.isFinite(id)) continue
        const r = n.getBoundingClientRect()
        const relTop = r.top - containerTop
        const relBottom = r.bottom - containerTop
        if (relBottom <= 0) continue
        const score = relTop <= 0 ? Math.abs(relTop) : (100000 + relTop)
        if (!best || score < best.score) best = { id, offset: relTop, score }
      }
      if (best) return { top, anchorNoteId: best.id, anchorOffset: best.offset }
    } catch {}
    return { top }
  }

  function normalizeSnapshot(s: FeedScrollSnapshot): { top: number; anchorNoteId?: number; anchorOffset?: number } {
    if (typeof s === 'number') return { top: Number.isFinite(s) ? s : 0 }
    const top = (typeof (s as any)?.top === 'number' && Number.isFinite((s as any).top)) ? (s as any).top : 0
    const anchorNoteId = (typeof (s as any)?.anchorNoteId === 'number' && Number.isFinite((s as any).anchorNoteId)) ? (s as any).anchorNoteId : undefined
    const anchorOffset = (typeof (s as any)?.anchorOffset === 'number' && Number.isFinite((s as any).anchorOffset)) ? (s as any).anchorOffset : undefined
    return { top, anchorNoteId, anchorOffset }
  }

  async function saveFeedScroll(spaceId: number) {
    const snap = computeFeedSnapshot()
    feedScrollRef.current[spaceId] = snap
    try { await kv.set(getFeedScrollKey(spaceId), snap) } catch {}
  }

  async function loadFeedSnapshot(spaceId: number): Promise<FeedScrollSnapshot> {
    const cached = feedScrollRef.current[spaceId]
    if (cached != null) return cached
    const stored = await kv.get<FeedScrollSnapshot>(getFeedScrollKey(spaceId))
    return (stored ?? 0) as FeedScrollSnapshot
  }

  function isSnapshotInPlace(snapshot: FeedScrollSnapshot) {
    const el = scrollRef.current
    if (!el) return false
    const snap = normalizeSnapshot(snapshot)
    if (snap.anchorNoteId != null) {
      const anchorEl = document.getElementById(`feed-note-${snap.anchorNoteId}`)
      if (!anchorEl) return false
      const relTop = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top
      const desired = snap.anchorOffset ?? 0
      return Math.abs(relTop - desired) < 2
    }
    return Math.abs(el.scrollTop - snap.top) < 2 || snap.top <= 0
  }

  function applyFeedRestoreOnce(spaceId: number, snapshot: FeedScrollSnapshot) {
    if (currentSpaceIdRef.current !== spaceId) return
    if (currentNoteIdRef.current != null) return
    const el = scrollRef.current
    if (!el) return

    const snap = normalizeSnapshot(snapshot)
    let targetTop = snap.top
    if (snap.anchorNoteId != null) {
      const anchorEl = document.getElementById(`feed-note-${snap.anchorNoteId}`)
      if (anchorEl) {
        const relTop = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top
        const desired = snap.anchorOffset ?? 0
        targetTop = el.scrollTop + (relTop - desired)
      }
    }
    el.scrollTop = targetTop
  }

  function requestFeedRestore(spaceId: number, snapshot: FeedScrollSnapshot) {
    const token = Date.now() + Math.random()
    feedRestoreReqRef.current = { token, spaceId, snapshot, tries: 0 }

    const tick = () => {
      const req = feedRestoreReqRef.current
      if (!req || req.token !== token) return
      requestAnimationFrame(() => {
        const req2 = feedRestoreReqRef.current
        if (!req2 || req2.token !== token) return

        applyFeedRestoreOnce(spaceId, snapshot)

        const el = scrollRef.current
        if (!el) return
        const isScrollable = el.scrollHeight > el.clientHeight + 4
        const inPlace = isSnapshotInPlace(snapshot)
        const snap = normalizeSnapshot(snapshot)
        const shouldRetry = (snap.top > 0 || snap.anchorNoteId != null) && (!isScrollable || !inPlace)

        if (!shouldRetry) { feedRestoreReqRef.current = null; return }
        req2.tries++
        if (req2.tries > 25) { feedRestoreReqRef.current = null; return }
        setTimeout(tick, 50)
      })
    }

    tick()
  }

  async function restoreFeedScroll(spaceId: number) {
    const snapshot = await loadFeedSnapshot(spaceId)
    requestFeedRestore(spaceId, snapshot)
  }

  useEffect(() => {
    applyStoredTheme()
    initSearch().catch(() => {})
    if (!authed) return

    // initial from URL
    const { space, note, filter } = parseQuery()
    ensureDefaultSpace().then(async () => {
      const id = space || await getCurrentSpaceId()
      setCurrentSpaceId(id)
      setCurrentNoteId(note ?? null)
      historyTrailRef.current = note ? [null] : []
      if (filter) {
        const foundLocal = await filtersRepo.getByLocalId(filter)
        const foundServer = foundLocal ? null : await filtersRepo.getByServerId(filter)
        const found = foundLocal || foundServer
        if (found && found.spaceId === id) setSelectedFilter(found)
      }
      // load persisted quick filters
      if (note) {
        const saved = await kv.get<typeof quickThread>(`quick:space:${id}:note:${note}`)
        if (saved) {
          const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
          if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
          setQuickThread(normalized as any)
        }
      } else {
        const saved = await kv.get<typeof quickFeed>(`quick:space:${id}`)
        if (saved) {
          const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
          if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
          setQuickFeed(normalized as any)
        }
      }
      await ensureNoteIndexForSpace(id)
      await runSync()
      setTimeout(() => { runSync() }, 1000)
      // normalize URL
      pushQuery({ space: id, note: note ?? null, filter: (filter ?? null) }, true)
    })

    const onPop = () => {
      const prevSpaceId = currentSpaceIdRef.current
      const prevNoteId = currentNoteIdRef.current
      const { space: s, note: n, filter: f } = parseQuery()
      if (s) setCurrentSpaceId(s)
      setCurrentNoteId(n ?? null)
      if (f == null) setSelectedFilter(null)
      else {
        void (async () => {
          const byLocal = await filtersRepo.getByLocalId(f)
          const byServer = byLocal ? null : await filtersRepo.getByServerId(f)
          const rec = byLocal || byServer || null
          setSelectedFilter(rec)
        })()
      }
      // Feed -> thread: capture scroll. Thread -> feed: restore scroll.
      const effectiveSpaceId = s ?? prevSpaceId
      if (effectiveSpaceId) {
        if (prevNoteId == null && (n ?? null) != null) void saveFeedScroll(effectiveSpaceId)
        if (prevNoteId != null && (n ?? null) == null) void restoreFeedScroll(effectiveSpaceId)
      }
    }
    window.addEventListener('popstate', onPop)

    const { kick, cleanup } = scheduleAutoSync()
    const onLocalWrite = () => kick()
    window.addEventListener('focuz:local-write', onLocalWrite)
    return () => {
      window.removeEventListener('focuz:local-write', onLocalWrite)
      window.removeEventListener('popstate', onPop)
      try { cleanup() } catch {}
    }
  }, [authed])

  useEffect(() => {
    const onOpenSave = () => setSaveOpen(true)
    window.addEventListener('focuz:open-save-filter', onOpenSave as any)
    return () => { window.removeEventListener('focuz:open-save-filter', onOpenSave as any) }
  }, [])

  const currentQuick = currentNoteId ? quickThread : quickFeed

  async function handleSaveOrUpdate(kind: 'save' | 'update' | 'save-as-new') {
    if (!currentSpaceId) return
    const params: any = {
      textContains: (currentQuick.text || '').trim() || undefined,
      includeTags: (currentQuick.tags || []).filter(t => !t.startsWith('!')),
      excludeTags: (currentQuick.tags || []).filter(t => t.startsWith('!')).map(t => t.slice(1)),
      includeActivities: featureFlags.quickFiltersActivities ? ((currentQuick as any).activities || undefined) : undefined,
      notReply: currentQuick.noParents || undefined,
      sort: currentQuick.sort,
    }
    if (kind === 'update' && selectedFilter?.id) {
      await updateFilterLocal(selectedFilter.id, { name: (saveName.trim() ? saveName.trim() : undefined), params })
      const rec = await filtersRepo.getByLocalId(selectedFilter.id)
      setSelectedFilter(rec || null)
      setSaveOpen(false)
      setSaveName('')
      if (currentSpaceId) pushQuery({ space: currentSpaceId, note: currentNoteId, filter: rec?.id ?? null })
      return
    }
    const parentServerId = (kind === 'save-as-new' ? (selectedFilter?.serverId ?? null) : null) ?? null
    const localId = await createFilterLocal(currentSpaceId, (saveName.trim() || (selectedFilter?.name ?? '')), params, parentServerId)
    const rec = await filtersRepo.getByLocalId(localId)
    setSelectedFilter(rec || null)
    setSaveOpen(false)
    setSaveName('')
    if (currentSpaceId) pushQuery({ space: currentSpaceId, note: currentNoteId, filter: rec?.id ?? null })
  }

  // When a saved filter is selected on the feed, reflect it in Quick filters
  useEffect(() => {
    if (!currentSpaceId) return
    if (currentNoteId != null) return
    const applyFrom = async () => {
      if (selectedFilter) {
        const p: any = selectedFilter.params || {}
        const include = Array.isArray(p.includeTags) ? p.includeTags : []
        const exclude = Array.isArray(p.excludeTags) ? p.excludeTags.map((t: string) => `!${t}`) : []
        const text = typeof p.textContains === 'string' ? p.textContains : ''
        const noParents = !!p.notReply
        const sort = (typeof p.sort === 'string' ? p.sort : 'modifiedat,DESC') as `${SortField},ASC` | `${SortField},DESC`
        const next = { text, tags: [...include, ...exclude], noParents, sort }
        setQuickFeed(next)
        await kv.set(`quick:space:${currentSpaceId}` , next)
      }
    }
    applyFrom().catch(() => {})
  // Only update Quick when the selected filter changes, not on quick edits
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter, currentSpaceId, currentNoteId])

  function openThread(noteId: number) {
    if (!currentSpaceId) return
    // Save feed scroll position before leaving the feed.
    if (currentNoteId == null) void saveFeedScroll(currentSpaceId)
    // Update in-tab trail: collapse to before existing target, or push current
    {
      const prev = historyTrailRef.current
      const idx = prev.findIndex(x => x === noteId)
      if (idx !== -1) {
        historyTrailRef.current = prev.slice(0, idx)
      } else if (currentNoteId !== noteId) {
        historyTrailRef.current = [...prev, currentNoteId ?? null]
      }
    }
    setCurrentNoteId(noteId)
    pushQuery({ space: currentSpaceId, note: noteId, filter: selectedFilter?.id ?? null })
    // load thread quick
    void (async () => {
      const key = `quick:space:${currentSpaceId}:note:${noteId}`
      const saved = await kv.get<typeof quickThread>(key)
      if (saved) {
        const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
        if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
        setQuickThread(normalized as any)
      }
    })()
  }
  function openSpace(spaceId: number) {
    setCurrentSpaceId(spaceId)
    setCurrentNoteId(null)
    setSelectedFilter(null)
    historyTrailRef.current = []
    pushQuery({ space: spaceId, note: null })
    // load feed quick for space
    void (async () => {
      const key = `quick:space:${spaceId}`
      const saved = await kv.get<typeof quickFeed>(key)
      if (saved) {
        const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
        if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
        setQuickFeed(normalized as any)
      }
    })()
  }

  function goBack() {
    if (!currentSpaceId) return
    const prev = historyTrailRef.current
    if (prev.length === 0) {
      // back to feed
      setCurrentNoteId(null)
      pushQuery({ space: currentSpaceId, note: null, filter: selectedFilter?.id ?? null })
      void restoreFeedScroll(currentSpaceId)
      // load feed quick
      void (async () => {
        const saved = await kv.get<typeof quickFeed>(`quick:space:${currentSpaceId}`)
        if (saved) {
          const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
          if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
          setQuickFeed(normalized as any)
        }
      })()
      return
    }
    const next = prev.slice(0, -1)
    const target = prev[prev.length - 1]
    historyTrailRef.current = next
    setCurrentNoteId(target ?? null)
    pushQuery({ space: currentSpaceId, note: target ?? null, filter: selectedFilter?.id ?? null })
    if (target == null) void restoreFeedScroll(currentSpaceId)
    // load respective quick
    void (async () => {
      if (target == null) {
        const saved = await kv.get<typeof quickFeed>(`quick:space:${currentSpaceId}`)
        if (saved) {
          const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
          if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
          setQuickFeed(normalized as any)
        }
      } else {
        const saved = await kv.get<typeof quickThread>(`quick:space:${currentSpaceId}:note:${target}`)
        if (saved) {
          const normalized = (saved as any).tags ? saved : { ...(saved as any), tags: [] }
          if (!featureFlags.quickFiltersActivities && (normalized as any).activities) delete (normalized as any).activities
          setQuickThread(normalized as any)
        }
      }
    })()
  }

  async function handleLogout() {
    // Logging out drops the local database: warn before losing changes that never reached the server.
    const unsynced = await countUnsyncedChanges().catch(() => 0)
    if (unsynced > 0 && !window.confirm(`${unsynced} change(s) have not been synced to the server yet and will be lost. Log out anyway?`)) return
    setAuthed(false)
    purgeAndLogout().catch(() => { teardownSync(); logout() })
  }

  if (!authed) return <AuthScreen onDone={() => setAuthed(true)} />

  const isNoFiltersActive = !selectedFilter && !hasActiveQuickFilters(currentQuick)

  async function clearAllFilters() {
    if (!currentSpaceId) return
    // Reset quick filter criteria, but keep current sort (sorting isn't a filter).
    const base: any = (currentNoteId ? quickThread : quickFeed) || {}
    const next: any = { ...base, text: '', tags: [], noParents: false, activities: [] }
    setSelectedFilter(null)
    setCurrentNoteId(null)
    setQuickFeed(next)
    await kv.set(`quick:space:${currentSpaceId}`, next)
    pushQuery({ space: currentSpaceId, note: null, filter: null })
  }

  const left = currentSpaceId ? (
    <FiltersTree
      spaceId={currentSpaceId}
      selectedId={selectedFilter?.id ?? null}
      isNoFiltersActive={isNoFiltersActive}
      onSelect={(f) => {
        setSelectedFilter(f)
        const nextNote = currentNoteId ? null : currentNoteId
        if (currentNoteId) setCurrentNoteId(null)
        if (currentSpaceId) pushQuery({ space: currentSpaceId, note: nextNote, filter: f?.id ?? null })
      }}
      onClearAll={() => { void clearAllFilters() }}
    />
  ) : null
  let center: ReactNode = null
  if (currentSpaceId) {
    if (currentNoteId) {
      center = (
        <NoteThread
          spaceId={currentSpaceId}
          noteId={currentNoteId}
          onBack={goBack}
          onOpenThread={openThread}
          quick={quickThread}
          onAddQuickTag={(tag) => {
            const tags = quickThread.tags || []
            if (tags.includes(tag)) return
            const next = { ...quickThread, tags: [...tags, tag] }
            setQuickThread(next)
            if (currentSpaceId && currentNoteId) kv.set(`quick:space:${currentSpaceId}:note:${currentNoteId}`, next)
          }}
        />
      )
    } else {
      center = (
        <div className="min-w-0 space-y-3">
          <NoteComposer spaceId={currentSpaceId} positiveQuickTags={(quickFeed.tags || []).filter(t => !t.startsWith('!'))} />
          <NoteList
            spaceId={currentSpaceId}
            filter={null}
            quick={quickFeed}
            onOpenThread={openThread}
            onAddQuickTag={(tag) => {
              if (!currentSpaceId) return
              const tags = quickFeed.tags || []
              if (tags.includes(tag)) return
              const next = { ...quickFeed, tags: [...tags, tag] }
              setQuickFeed(next)
              kv.set(`quick:space:${currentSpaceId}`, next)
            }}
            onAddQuickActivity={featureFlags.quickFiltersActivities ? ((name) => {
              if (!currentSpaceId) return
              const acts = (quickFeed as any).activities || []
              if (acts.includes(name)) return
              const next = { ...quickFeed, activities: [...acts, name] }
              setQuickFeed(next as any)
              kv.set(`quick:space:${currentSpaceId}`, next)
            }) : undefined}
          />
        </div>
      )
    }
  }

  return (
    <div className="h-dvh">
      <header
        ref={topbarRef}
        className="fixed left-0 right-0 top-0 z-50"
        style={{
          transform: headerHidden ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform 180ms ease',
          willChange: 'transform',
        }}
      >
        {/* background fade (page bg -> transparent) */}
        <div
          className="absolute left-0 right-0 top-0 pointer-events-none"
          style={{
            height: 'var(--topbar-h, 64px)',
            background: 'linear-gradient(to bottom, rgb(var(--c-page)) 0%, rgb(var(--c-page)) 65%, rgb(var(--c-page) / 0) 100%)',
          }}
        />
        <div className="relative mx-auto max-w-[1440px] px-4 md:px-6 py-3">
          <TopBar
            onOpenSpaces={() => setDrawerOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={() => { void handleLogout() }}
            isThread={!!currentNoteId}
            onBack={goBack}
          />
        </div>
      </header>

      <SystemStatusLayer />

      {/* Global scroll container (scrollbar at viewport edge).
          Sidebars are sticky inside it, so they stay pinned to the screen while feed scrolls. */}
      <div
        ref={scrollRef}
        className="fixed inset-0 overflow-y-auto"
        style={{
          paddingTop: 'var(--topbar-effective-h, var(--topbar-h, 96px))',
          transition: 'padding-top 180ms ease',
        }}
        onScroll={(e) => {
          const el = e.currentTarget
          const st = el.scrollTop
          const last = lastScrollTopRef.current
          lastScrollTopRef.current = st
          if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
          rafRef.current = requestAnimationFrame(() => {
            if (st <= 0) { setHeaderHidden(false); lastDirRef.current = null; return }
            const delta = st - last
            if (Math.abs(delta) < 6) return
            if (delta > 0) {
              if (st > 80) setHeaderHidden(true)
              lastDirRef.current = 'down'
            } else {
              setHeaderHidden(false)
              lastDirRef.current = 'up'
            }
          })
        }}
      >
        <div className="mx-auto max-w-[1440px] px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)_270px] xl:grid-cols-[270px_minmax(0,1fr)_290px] gap-6">
            <aside
              className="hidden md:block py-4 self-start"
              style={{
                position: 'sticky',
                // The global scroll container already has padding-top = topbar height.
                // So sticky top should be 0 to avoid double offset.
                top: 0,
                height: 'calc(100vh - var(--topbar-effective-h, var(--topbar-h, 96px)))',
              }}
            >
              <div className="h-full">{left}</div>
            </aside>

            <main className="min-w-0 py-4">
              {center}
              {/* Spacer below feed equals topbar height */}
              <div style={{ height: 'var(--topbar-h, 96px)' }} />
            </main>

            <aside
              className="hidden lg:block py-4 self-start"
              style={{
                position: 'sticky',
                top: 0,
                height: 'calc(100vh - var(--topbar-effective-h, var(--topbar-h, 96px)))',
              }}
            >
              <div className="h-full">
                {currentNoteId
                  ? <QuickFiltersPanel
                      value={quickThread}
                      onChange={(v) => { setQuickThread(v); if (currentSpaceId && currentNoteId) kv.set(`quick:space:${currentSpaceId}:note:${currentNoteId}`, v) }}
                      hideNoParents
                      spaceId={currentSpaceId}
                    />
                  : <QuickFiltersPanel
                      value={quickFeed}
                      onChange={(v) => {
                        setQuickFeed(v)
                        if (currentSpaceId) kv.set(`quick:space:${currentSpaceId}` , v)
                        if (selectedFilter) {
                          setSelectedFilter(null)
                          pushQuery({ space: currentSpaceId!, note: null, filter: null })
                        }
                      }}
                      spaceId={currentSpaceId}
                    />
                }
              </div>
            </aside>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} currentId={currentSpaceId} onSelected={(id) => { openSpace(id) }}>
          {currentSpaceId ? (
            <FiltersTree
              spaceId={currentSpaceId}
              selectedId={selectedFilter?.id ?? null}
              isNoFiltersActive={isNoFiltersActive}
              onSelect={(f) => {
                setSelectedFilter(f)
                if (currentNoteId) setCurrentNoteId(null)
                pushQuery({ space: currentSpaceId, note: null, filter: f?.id ?? null })
                setDrawerOpen(false)
              }}
              onClearAll={() => { void clearAllFilters(); setDrawerOpen(false) }}
            />
          ) : null}
        </SpaceDrawer>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {authRequired && (
        <ReauthDialog
          onDone={() => { /* authRequired toggled by sync module */ }}
          onLogout={() => { void handleLogout() }}
        />
      )}
      {saveOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[110]">
          <div className="w-full sm:max-w-md surface space-y-4">
            <h2 className="text-title text-muted">Save filter</h2>
            <input
              className="input"
              placeholder={selectedFilter ? (selectedFilter.name || 'enter filter name') : 'enter filter name'}
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
            />
            <div className="flex justify-between">
              {selectedFilter?.id
                ? <button className="button" onClick={() => handleSaveOrUpdate('save-as-new')}>Create</button>
                : <div />
              }
              <div className="flex gap-2">
                <button className="button" onClick={() => { setSaveOpen(false); setSaveName('') }}>Cancel</button>
                <button className="button" onClick={() => handleSaveOrUpdate((selectedFilter?.id ? 'update' : 'save'))}>{selectedFilter?.id ? 'Update' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <AppToaster />
    </div>
  )
}

// Thread view components
function SingleNoteCard({ note, onEdit, onDelete, onOpenThread }: { note: NoteRecord; onEdit: () => void; onDelete: () => void; onOpenThread: (nid: number) => void }) {
  return (
    <NoteCard note={note} onEdit={onEdit} onDelete={onDelete} onOpenThread={onOpenThread} showParentPreview />
  )
}

function ReplyComposer({ spaceId, parentId, positiveQuickTags = [] }: { spaceId: number; parentId: number; positiveQuickTags?: string[] }) {
  const [value, setValue] = useState<NoteEditorValue>({ text: '', tags: [] })
  const canAdd = useMemo(() => value.text.trim().length > 0, [value.text])
  async function addNote() {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const payload: NoteRecord = {
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    }
    await notesRepo.addDraft(payload)
    setValue({ text: '', tags: [] })
  }
  async function addReplyWithAttachments(extra: { attachments?: File[] }) {
    if (!canAdd) return
    const now = new Date().toISOString()
    const mergedTags = Array.from(new Set([...(value.tags || []), ...positiveQuickTags]))
    const noteId = await notesRepo.addDraft({
      spaceId,
      title: null,
      text: value.text.trim(),
      tags: mergedTags,
      createdAt: now,
      modifiedAt: now,
      date: now,
      parentId,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    } as NoteRecord)
    const files = (extra.attachments ?? []).slice(0, 10)
    for (const f of files) {
      try { await addLocalAttachment(noteId, f) } catch {}
    }
    setValue({ text: '', tags: [] })
  }
  return (
    <NoteEditor value={value} onChange={setValue} onSubmit={addNote} onSubmitWithExtra={addReplyWithAttachments} onCancel={() => setValue({ text: '', tags: [] })} mode="reply" defaultExpanded={false} spaceId={spaceId} />
  )
}

function NoteThread({ spaceId, noteId, onBack, onOpenThread, quick, onAddQuickTag }: { spaceId: number; noteId: number; onBack: () => void; onOpenThread: (nid: number) => void; quick: { text: string; tags: string[]; noParents: boolean; sort: `${SortField},ASC` | `${SortField},DESC` }; onAddQuickTag?: (tag: string) => void }) {
  const mainNote = useLiveQuery(() => notesRepo.getByLocalId(noteId), [noteId]) as NoteRecord | undefined
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState<NoteEditorValue>({ text: '', tags: [] })

  useEffect(() => {
    if (mainNote) setEditValue({ text: mainNote.text, tags: mainNote.tags || [] })
  }, [mainNote])

  async function saveEdit(extra?: { attachments?: File[] }) {
    if (!mainNote?.id) return
    await updateNoteLocal(mainNote.id, { text: editValue.text.trim(), tags: editValue.tags })
    for (const f of (extra?.attachments ?? []).slice(0, 10)) {
      try { await addLocalAttachment(mainNote.id, f) } catch {}
    }
    window.dispatchEvent(new Event('focuz:local-write'))
    setEditing(false)
  }
  async function removeMain() {
    if (!mainNote?.id) return
    await deleteNote(mainNote.id)
    window.dispatchEvent(new Event('focuz:local-write'))
    onBack()
  }

  if (!mainNote || mainNote.spaceId !== spaceId || mainNote.deletedAt) {
    return (
      <div className="space-y-5">
        <div className="card p-4">
          <div className="mb-3">Note not found</div>
          <button className="button" onClick={onBack}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      {editing ? (
        <NoteEditor value={editValue} onChange={setEditValue} onSubmit={() => saveEdit()} onSubmitWithExtra={(extra) => saveEdit(extra)} onCancel={() => setEditing(false)} mode="edit" autoCollapse={false} spaceId={spaceId} noteId={noteId} />
      ) : (
        <SingleNoteCard note={mainNote} onEdit={() => setEditing(true)} onDelete={removeMain} onOpenThread={onOpenThread} />
      )}
      <ReplyComposer spaceId={spaceId} parentId={noteId} positiveQuickTags={quick.tags.filter(t => !t.startsWith('!'))} />
      <div className="min-w-0">
        <NoteList spaceId={spaceId} filter={null} quick={quick} parentId={noteId} onOpenThread={onOpenThread} onAddQuickTag={onAddQuickTag} />
      </div>
    </div>
  )
}

export default App
