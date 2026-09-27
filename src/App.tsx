import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { NoteRecord, FilterRecord } from './lib/types'
import { ensureDefaultSpace, getCurrentSpaceId, runSync, scheduleAutoSync, isAuthenticated, logout, deleteNote, addLocalAttachment, teardownSync, purgeAndLogout, countUnsyncedChanges } from './lib/sync'
import { updateNoteLocal } from './lib/sync'
import { searchNotes, ensureNoteIndexForSpace, initSearch } from './lib/search'
import { activityTypes as activityTypesRepo, activities as activitiesRepo, filters as filtersRepo, kv, notes as notesRepo } from './data'
import { initAppState, useAppState } from './lib/app-state'
import { db } from './lib/db'
import { featureFlags } from './lib/feature-flags'
import { SystemStatusInline, SystemStatusLayer } from './components/SystemStatus'
import { notifyUndoable } from './ui/notify'
import { AppToaster } from './ui/toaster'
import NoteEditor, { type NoteEditorValue } from './components/NoteEditor'
import NoteCard from './components/NoteCard'
import FolderTree, { type FeedView } from './components/FolderTree'
import FolderHeader, { type FolderScope } from './components/FolderHeader'
import FilterBar from './components/FilterBar'
import { NoteFoldersDialog } from './components/FolderDialogs'
import AuthScreen, { ReauthDialog } from './components/AuthScreen'
import { useFolderIndex } from './lib/useFolderIndex'
import { directOnly, folderKind, type FolderIndex } from './lib/folders'
import { createFolder, saveFolderRule } from './lib/folder-actions'
import { hasOpenTasks } from './lib/note-format/render'
import {
  DEFAULT_QUICK, criteriaFromQuick, criteriaFromRule, mergeIntoRule, quickFromCriteria, ruleFromCriteria,
  type Criteria, type QuickState,
} from './lib/criteria'
import { applyStoredTheme } from './lib/theme'
import SettingsDialog from './components/SettingsDialog'
import NotificationsBell from './components/NotificationsBell'
import SpaceRail from './components/spaces/SpaceRail'
import SpaceHeader from './components/spaces/SpaceHeader'
import CreateSpaceDialog from './components/spaces/CreateSpaceDialog'
import SpaceSettingsDialog, { type SpaceSettingsTab } from './components/spaces/SpaceSettingsDialog'
import { SpaceContext, useSpaceView, type SpaceView } from './lib/space-context'
import { useMe, useSpace, useSpaces } from './lib/useSpaces'
import { canWrite, roleOf, ROLE_LABEL } from './lib/roles'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

function TopBar({
  onOpenSpaces,
  onOpenSettings,
  isThread,
  onBack,
  viewTitle,
  onOpenSpace,
}: {
  onOpenSpaces: () => void
  onOpenSettings: () => void
  isThread?: boolean
  onBack?: () => void
  /** Current folder, shown on phones where the folder list lives in the drawer. */
  viewTitle?: string
  onOpenSpace: (localSpaceId: number) => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[304px_minmax(0,620px)] xl:grid-cols-[324px_620px] md:justify-center gap-3 md:gap-6 items-center">
      <div className="flex items-center gap-3 min-w-0">
        {isThread ? (
          <button className="icon-btn icon-35" onClick={onBack} type="button" aria-label="Back">
            <ArrowBackRoundedIcon fontSize="inherit" />
          </button>
        ) : (
          <button className="icon-btn icon-35 topbar-menu" onClick={onOpenSpaces} type="button" aria-label="Open spaces">
            <MenuRoundedIcon fontSize="inherit" />
          </button>
        )}
        <h1 className="text-title text-primary hidden md:block">focuz</h1>
        {!isThread && viewTitle ? (
          <button type="button" className="topbar-view" onClick={onOpenSpaces} aria-label={`Folders. Current: ${viewTitle}`}>
            <span className="truncate">{viewTitle}</span>
            <span aria-hidden className="text-secondary">▾</span>
          </button>
        ) : <h1 className="text-title text-primary md:hidden">focuz</h1>}
      </div>
      <div className="flex items-center justify-end gap-2">
        <SystemStatusInline />
        <NotificationsBell onOpenSpace={onOpenSpace} />
        <button className="icon-btn icon-35" onClick={onOpenSettings} type="button" aria-label="Settings">
          <SettingsRoundedIcon fontSize="inherit" />
        </button>
      </div>
    </div>
  )
}

/** Phones: spaces on the left, the open space's folders on the right (like Discord). */
function MobileDrawer({ open, onClose, rail, children }: { open: boolean; onClose: () => void; rail: ReactNode; children?: ReactNode }) {
  return (
    <div className={`fixed inset-0 z-[80] transition md:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/60 ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        className={`absolute left-0 top-0 h-full w-[21rem] max-w-[92vw] flex ${open ? '' : '-translate-x-full'} transition-transform`}
        style={{ background: 'var(--glass-strong)', boxShadow: 'var(--shadow-surface)', backdropFilter: 'blur(18px)' }}
        aria-label="Spaces and folders"
      >
        <div className="py-3 pl-2">{rail}</div>
        <div className="flex-1 min-w-0 p-2">{children}</div>
      </aside>
    </div>
  )
}

type SortField = 'date' | 'createdat' | 'modifiedat'

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

function NoteList({ spaceId, filter, quick, parentId, onOpenThread, onAddQuickTag, onAddQuickActivity, scopeIds, folderIndex, emptyText }: { spaceId: number; filter: FilterRecord | null; quick: QuickState; parentId?: number | null; onOpenThread?: (noteId: number) => void; onAddQuickTag?: (tag: string) => void; onAddQuickActivity?: (name: string) => void; /** Only these notes (the open folder), or null for all. */ scopeIds?: Set<number> | null; folderIndex?: FolderIndex; emptyText?: string }) {
  const [foldersFor, setFoldersFor] = useState<NoteRecord | null>(null)
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

  const allNotes = useLiveQuery(async () => {
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
    if (quick.openTasks) result = result.filter(n => hasOpenTasks(n.text))

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
  const notes = useMemo(() => scopeIds ? allNotes.filter(n => scopeIds.has(n.id!)) : allNotes, [allNotes, scopeIds])

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
                onManageFolders={folderIndex ? () => setFoldersFor(n) : undefined}
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
      {notes.length === 0 && <li className="feed-empty">{emptyText ?? 'No notes'}</li>}
      {foldersFor && <NoteFoldersDialog index={folderIndex} note={foldersFor} onClose={() => setFoldersFor(null)} />}
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
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false)
  const [spaceSettings, setSpaceSettings] = useState<SpaceSettingsTab | null>(null)
  const [authed, setAuthed] = useState<boolean>(isAuthenticated())
  const [currentSpaceId, setCurrentSpaceId] = useState<number | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<FilterRecord | null>(null)
  const [currentNoteId, setCurrentNoteId] = useState<number | null>(null)
  const [unsortedView, setUnsortedView] = useState(false)
  const [scope, setScope] = useState<FolderScope>('deep')
  // Folder rule being edited: the filter bar edits it and the feed previews it.
  const [ruleDraft, setRuleDraft] = useState<{ id: number; criteria: Criteria } | null>(null)
  // In-memory back trail within tab. Oldest -> newest. Excludes current page. null represents feed (space root)
  const historyTrailRef = useRef<Array<number | null>>([])
  const authRequired = useAppState(s => s.authRequired)

  const [quickFeed, setQuickFeed] = useState<QuickState>(DEFAULT_QUICK)
  const [quickThread, setQuickThread] = useState<QuickState>(DEFAULT_QUICK)
  const folderIndex = useFolderIndex(currentSpaceId, ruleDraft ? { id: ruleDraft.id, rule: ruleFromCriteria(ruleDraft.criteria) } : null)
  const spaces = useSpaces()
  const currentSpace = useSpace(currentSpaceId)
  const me = useMe(authed)
  const spaceView: SpaceView = {
    space: currentSpace,
    role: roleOf(currentSpace),
    meId: me?.id,
    meName: me?.username,
    shared: !!currentSpace && !currentSpace.isPersonal && (currentSpace.memberCount ?? 1) > 1,
  }
  // The open space went away (left, removed, deleted elsewhere): go to the personal one.
  useEffect(() => {
    if (!currentSpaceId || spaces.length === 0 || spaces.some(x => x.id === currentSpaceId)) return
    const id = currentSpaceId
    void db.spaces.get(id).then(rec => {
      if (rec && !rec.deletedAt) return
      const next = spaces.find(x => x.isPersonal) ?? spaces[0]
      if (next && currentSpaceIdRef.current === id) { void kv.set('currentSpaceId', next.id!); openSpace(next.id!) }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, currentSpaceId])

  useEffect(() => {
    initAppState()
  }, [])

  useEffect(() => { currentSpaceIdRef.current = currentSpaceId }, [currentSpaceId])
  useEffect(() => { currentNoteIdRef.current = currentNoteId }, [currentNoteId])
  const unsortedViewRef = useRef(false)
  const selectedFilterIdRef = useRef<number | null>(null)
  useEffect(() => { selectedFilterIdRef.current = selectedFilter?.id ?? null }, [selectedFilter])
  useEffect(() => { unsortedViewRef.current = unsortedView }, [unsortedView])

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
  function parseQuery(): { space?: number; note?: number; filter?: number; unsorted: boolean } {
    const p = new URLSearchParams(location.search)
    const space = p.get('space')
    const note = p.get('note')
    const filter = p.get('filter')
    return { space: space ? Number(space) : undefined, note: note ? Number(note) : undefined, filter: filter ? Number(filter) : undefined, unsorted: p.get('view') === 'unsorted' }
  }
  function pushQuery(next: { space: number; note?: number | null; filter?: number | null; unsorted?: boolean }, replace = false) {
    const params = new URLSearchParams()
    params.set('space', String(next.space))
    if (next.note != null) params.set('note', String(next.note))
    if (next.filter != null) params.set('filter', String(next.filter))
    else if (next.unsorted ?? unsortedViewRef.current) params.set('view', 'unsorted')
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
    const { space, note, filter, unsorted } = parseQuery()
    if (unsorted && !filter) setUnsortedView(true)
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
          // Opening a folder: older versions copied its rule into the quick filters; start clean instead.
          setQuickFeed(filter ? { ...DEFAULT_QUICK, sort: (normalized as any).sort || DEFAULT_QUICK.sort } : normalized as any)
        }
      }
      await ensureNoteIndexForSpace(id)
      await runSync()
      setTimeout(() => { runSync() }, 1000)
      // normalize URL
      pushQuery({ space: id, note: note ?? null, filter: (filter ?? null), unsorted: unsorted && !filter }, true)
    })

    const onPop = () => {
      const prevSpaceId = currentSpaceIdRef.current
      const prevNoteId = currentNoteIdRef.current
      const { space: s, note: n, filter: f, unsorted: u } = parseQuery()
      if (s) setCurrentSpaceId(s)
      setCurrentNoteId(n ?? null)
      setUnsortedView(u && f == null)
      setRuleDraft(null)
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

  const feedView: FeedView = selectedFilter?.id != null ? { kind: 'folder', id: selectedFilter.id } : unsortedView ? { kind: 'unsorted' } : { kind: 'all' }
  const currentRule = feedView.kind === 'folder' ? folderIndex?.rules.get(feedView.id) : undefined

  function setFeedQuick(next: QuickState) {
    setQuickFeed(next)
    if (currentSpaceId) void kv.set(`quick:space:${currentSpaceId}`, next)
  }

  /** Opens All notes, Unsorted or a folder. Filters typed for the previous view are cleared; sort stays. */
  function selectView(v: FeedView, known?: FilterRecord) {
    if (!currentSpaceId) return
    const rec = v.kind === 'folder' ? known ?? folderIndex?.nodes.get(v.id)?.rec ?? null : null
    if (v.kind === 'folder' && !rec) {
      // Just created: the live index has not caught up yet.
      void filtersRepo.getByLocalId(v.id).then(r => { if (r && !r.deletedAt) selectView(v, r) })
      return
    }
    setSelectedFilter(rec)
    setUnsortedView(v.kind === 'unsorted')
    setScope('deep')
    setRuleDraft(null)
    setCurrentNoteId(null)
    const folderSort = (rec?.params as any)?.sort
    setFeedQuick({ ...DEFAULT_QUICK, sort: folderSort || quickFeed.sort || DEFAULT_QUICK.sort })
    pushQuery({ space: currentSpaceId, note: null, filter: rec?.id ?? null, unsorted: v.kind === 'unsorted' })
    setDrawerOpen(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  function startEditRule(folderId: number) {
    const rule = folderIndex?.rules.get(folderId)
    if (!rule) return
    if (feedView.kind !== 'folder' || feedView.id !== folderId) selectView({ kind: 'folder', id: folderId })
    setRuleDraft({ id: folderId, criteria: criteriaFromRule(rule) })
    setDrawerOpen(false)
  }

  async function commitRule() {
    if (!ruleDraft) return
    await saveFolderRule(ruleDraft.id, ruleFromCriteria(ruleDraft.criteria))
    setRuleDraft(null)
  }

  async function saveAsFolder(name: string) {
    if (!currentSpaceId || !folderIndex) return
    const base = currentRule && folderKind(currentRule) !== 'group' ? currentRule : null
    const rule = mergeIntoRule(base, criteriaFromQuick(quickFeed))
    const parent = feedView.kind === 'folder' ? feedView.id : null
    const id = await createFolder(currentSpaceId, folderIndex, name, rule, parent, { sort: quickFeed.sort })
    const rec = await filtersRepo.getByLocalId(id)
    if (!rec) return
    setSelectedFilter(rec)
    setUnsortedView(false)
    setScope('deep')
    setFeedQuick({ ...DEFAULT_QUICK, sort: quickFeed.sort })
    pushQuery({ space: currentSpaceId, note: null, filter: id })
  }

  // The open folder was deleted (here or on another device): fall back to All notes.
  useEffect(() => {
    if (feedView.kind !== 'folder' || !folderIndex || folderIndex.nodes.has(feedView.id)) return
    const id = feedView.id
    void filtersRepo.getByLocalId(id).then(r => { if ((!r || r.deletedAt) && selectedFilterIdRef.current === id) selectView({ kind: 'all' }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderIndex, feedView.kind, (feedView as any).id])

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

  /** Opens another space (rail, drawer, notifications). */
  function switchSpace(localId: number) {
    if (localId === currentSpaceId) return
    void kv.set('currentSpaceId', localId)
    openSpace(localId)
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

  const rail = (
    <SpaceRail spaces={spaces} currentId={currentSpaceId} onSelect={(id) => { switchSpace(id); setDrawerOpen(false) }} onCreate={() => { setDrawerOpen(false); setCreateSpaceOpen(true) }} />
  )
  const tree = currentSpaceId ? (
    <FolderTree
      spaceId={currentSpaceId}
      index={folderIndex}
      view={feedView}
      onSelect={selectView}
      onEditRule={startEditRule}
      header={currentSpace ? <SpaceHeader space={currentSpace} onOpen={(tab) => { setDrawerOpen(false); setSpaceSettings(tab) }} onCreateShared={() => { setDrawerOpen(false); setCreateSpaceOpen(true) }} /> : null}
    />
  ) : null
  const viewTitle = feedView.kind === 'folder'
    ? (folderIndex?.nodes.get(feedView.id)?.rec.name ?? selectedFilter?.name ?? 'Folder')
    : feedView.kind === 'unsorted' ? 'Unsorted' : 'All notes'

  // What the open view shows before quick filters: null = everything.
  let scopeIds: Set<number> | null = null
  if (feedView.kind !== 'all') {
    if (!folderIndex) scopeIds = new Set<number>()
    else if (feedView.kind === 'unsorted') scopeIds = folderIndex.unsorted
    else if (scope === 'here' && !ruleDraft) scopeIds = directOnly(folderIndex, feedView.id)
    else scopeIds = folderIndex.deep.get(feedView.id) ?? new Set<number>()
  }

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
          toolbar={
            <FilterBar
              spaceId={currentSpaceId}
              mode="thread"
              value={criteriaFromQuick(quickThread)}
              onChange={(c) => {
                const next = quickFromCriteria(c, quickThread)
                setQuickThread(next)
                if (currentNoteId) void kv.set(`quick:space:${currentSpaceId}:note:${currentNoteId}`, next)
              }}
              sort={quickThread.sort}
              onSortChange={(sort) => {
                const next = { ...quickThread, sort }
                setQuickThread(next)
                if (currentNoteId) void kv.set(`quick:space:${currentSpaceId}:note:${currentNoteId}`, next)
              }}
            />
          }
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
      const editing = ruleDraft && feedView.kind === 'folder' && ruleDraft.id === feedView.id ? ruleDraft : null
      // Notes created here get the folder's tags (and tags picked in the filter bar).
      const folderTags = currentRule && folderKind(currentRule) !== 'group' ? currentRule.includeTags : []
      const newNoteTags = Array.from(new Set([...folderTags, ...criteriaFromQuick(quickFeed).include]))
      const feedQuick: QuickState = editing ? { ...DEFAULT_QUICK, sort: quickFeed.sort } : quickFeed
      const emptyText = editing
        ? 'No notes match this rule yet.'
        : feedView.kind === 'unsorted' ? 'Everything is in a folder.'
        : feedView.kind === 'folder' && scope === 'here' ? 'Everything here is in a subfolder.'
        : feedView.kind === 'folder' && currentRule && folderKind(currentRule) === 'group' && !(folderIndex?.nodes.get(feedView.id)?.children.length)
          ? 'This folder has no rule yet. Add one with “Edit rule”, or create subfolders.'
        : 'No notes here yet.'
      center = (
        <div className="min-w-0 space-y-3">
          <FolderHeader
            index={folderIndex}
            view={feedView}
            scope={scope}
            onScopeChange={setScope}
            editingRule={editing ? ruleFromCriteria(editing.criteria) : null}
            onEditRule={() => { if (feedView.kind === 'folder') startEditRule(feedView.id) }}
            onSaveRule={() => { void commitRule() }}
            onCancelRule={() => setRuleDraft(null)}
            newNoteTags={folderTags}
          />
          {editing ? (
            <FilterBar
              spaceId={currentSpaceId}
              mode="rule"
              value={editing.criteria}
              onChange={(c) => setRuleDraft({ id: editing.id, criteria: c })}
            />
          ) : (
            <FilterBar
              spaceId={currentSpaceId}
              value={criteriaFromQuick(quickFeed)}
              onChange={(c) => setFeedQuick(quickFromCriteria(c, quickFeed))}
              sort={quickFeed.sort}
              onSortChange={(sort) => setFeedQuick({ ...quickFeed, sort })}
              saveTarget={feedView.kind === 'folder' ? viewTitle : null}
              onSaveAsFolder={(name) => { void saveAsFolder(name) }}
            />
          )}
          {!editing && canWrite(spaceView.role) && <NoteComposer spaceId={currentSpaceId} positiveQuickTags={newNoteTags} />}
          {!editing && !canWrite(spaceView.role) && (
            <div className="guest-banner" role="note">You are a {ROLE_LABEL[spaceView.role].toLowerCase()} here: you can read notes, but not write or change them.</div>
          )}
          <NoteList
            spaceId={currentSpaceId}
            filter={null}
            quick={feedQuick}
            scopeIds={scopeIds}
            folderIndex={folderIndex}
            emptyText={emptyText}
            onOpenThread={openThread}
            onAddQuickTag={(tag) => {
              if (editing) return
              const tags = quickFeed.tags || []
              if (tags.includes(tag)) return
              setFeedQuick({ ...quickFeed, tags: [...tags, tag] })
            }}
            onAddQuickActivity={featureFlags.quickFiltersActivities ? ((name) => {
              if (editing) return
              const acts = quickFeed.activities || []
              if (acts.includes(name)) return
              setFeedQuick({ ...quickFeed, activities: [...acts, name] })
            }) : undefined}
          />
        </div>
      )
    }
  }

  return (
    <SpaceContext.Provider value={spaceView}>
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
            background: 'linear-gradient(to bottom, rgb(var(--c-page-top)) 0%, rgb(var(--c-page-top) / 0.92) 55%, rgb(var(--c-page-top) / 0) 100%)',
          }}
        />
        <div className="relative mx-auto max-w-[1440px] px-4 md:px-6 py-3">
          <TopBar
            onOpenSpaces={() => setDrawerOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            isThread={!!currentNoteId}
            onBack={goBack}
            viewTitle={viewTitle}
            onOpenSpace={(id) => switchSpace(id)}
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
          <div className="grid grid-cols-1 md:grid-cols-[304px_minmax(0,620px)] xl:grid-cols-[324px_620px] md:justify-center gap-6">
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
              <div className="h-full flex gap-2">
                {rail}
                <div className="flex-1 min-w-0 h-full">{tree}</div>
              </div>
            </aside>

            <main className="min-w-0 py-4 w-full">
              {center}
              {/* Spacer below feed equals topbar height */}
              <div style={{ height: 'var(--topbar-h, 96px)' }} />
            </main>

          </div>
        </div>
      </div>

      {drawerOpen && (
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} rail={rail}>
          {tree}
        </MobileDrawer>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onLogout={() => { setSettingsOpen(false); void handleLogout() }} />
      {createSpaceOpen && (
        <CreateSpaceDialog
          onClose={() => setCreateSpaceOpen(false)}
          onCreated={(id) => { setCreateSpaceOpen(false); switchSpace(id); setSpaceSettings('members') }}
        />
      )}
      {spaceSettings && currentSpace && (
        <SpaceSettingsDialog
          space={currentSpace}
          tab={spaceSettings}
          onTabChange={setSpaceSettings}
          onClose={() => setSpaceSettings(null)}
          onGone={() => { setSpaceSettings(null); const p = spaces.find(x => x.isPersonal && x.id !== currentSpaceId) ?? spaces.find(x => x.id !== currentSpaceId); if (p) switchSpace(p.id!) }}
        />
      )}
      {authRequired && (
        <ReauthDialog
          onDone={() => { /* authRequired toggled by sync module */ }}
          onLogout={() => { void handleLogout() }}
        />
      )}
      <AppToaster />
    </div>
    </SpaceContext.Provider>
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

function NoteThread({ spaceId, noteId, onBack, onOpenThread, quick, onAddQuickTag, toolbar }: { spaceId: number; noteId: number; onBack: () => void; onOpenThread: (nid: number) => void; quick: QuickState; onAddQuickTag?: (tag: string) => void; toolbar?: ReactNode }) {
  const mainNote = useLiveQuery(() => notesRepo.getByLocalId(noteId), [noteId]) as NoteRecord | undefined
  const view = useSpaceView()
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
          <button className="button button-secondary" onClick={onBack}>Back</button>
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
      {canWrite(view.role) && <ReplyComposer spaceId={spaceId} parentId={noteId} positiveQuickTags={quick.tags.filter(t => !t.startsWith('!'))} />}
      {toolbar}
      <div className="min-w-0">
        <NoteList spaceId={spaceId} filter={null} quick={quick} parentId={noteId} onOpenThread={onOpenThread} onAddQuickTag={onAddQuickTag} />
      </div>
    </div>
  )
}

export default App
