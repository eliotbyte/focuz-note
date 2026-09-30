import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { activityTypes as activityTypesRepo, tags as tagsRepo } from '../data'
import { featureFlags } from '../lib/feature-flags'
import { EMPTY_CRITERIA, SORT_OPTIONS, isEmptyCriteria, sortLabel, type Criteria, type SortValue } from '../lib/criteria'

/**
 * Search, active filters as chips, "+ Filter", sort and "Save as folder", in one row above the feed.
 * The same bar edits a folder's rule (mode "rule"): then there is no sort and no saving from here.
 */
export default function FilterBar({
  spaceId,
  value,
  onChange,
  sort,
  onSortChange,
  mode = 'feed',
  saveTarget,
  onSaveAsFolder,
  trailing,
}: {
  spaceId: number
  value: Criteria
  onChange: (next: Criteria) => void
  sort?: SortValue
  onSortChange?: (next: SortValue) => void
  mode?: 'feed' | 'thread' | 'rule'
  /** Where "Save as folder" puts the new folder (current folder name), or null for the top level. */
  saveTarget?: string | null
  onSaveAsFolder?: (name: string) => void
  /** Extra controls at the end of the row (the list / tiles switch). */
  trailing?: ReactNode
}) {
  const [text, setText] = useState(value.text)
  // Keep typing smooth: the bar owns the text while focused and reports changes right away.
  useEffect(() => { setText(value.text) }, [value.text])
  const set = (patch: Partial<Criteria>) => onChange({ ...value, ...patch })
  const empty = isEmptyCriteria(value)
  const placeholder = mode === 'rule' ? 'Text contains…' : mode === 'thread' ? 'Search replies' : 'Search'

  return (
    <div className="filter-bar" role="search">
      <label className="filter-search">
        <SearchRoundedIcon fontSize="inherit" className="icon-sm text-secondary shrink-0" />
        <input
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={e => { setText(e.target.value); set({ text: e.target.value }) }}
          onKeyDown={e => { if (e.key === 'Escape' && text) { e.preventDefault(); setText(''); set({ text: '' }) } }}
        />
        {text && (
          <button type="button" className="filter-search-clear" aria-label="Clear search" onClick={() => { setText(''); set({ text: '' }) }}>
            <CloseRoundedIcon fontSize="inherit" />
          </button>
        )}
      </label>

      {value.include.map(t => (
        <Chip key={`i-${t}`} label={`#${t}`} onRemove={() => set({ include: value.include.filter(x => x !== t) })} />
      ))}
      {value.exclude.map(t => (
        <Chip key={`e-${t}`} tone="neg" label={`not #${t}`} onRemove={() => set({ exclude: value.exclude.filter(x => x !== t) })} />
      ))}
      {value.activities.map(a => (
        <Chip key={`a-${a}`} tone="flag" label={a} onRemove={() => set({ activities: value.activities.filter(x => x !== a) })} />
      ))}
      {value.openTasks && <Chip tone="flag" label="Open tasks" onRemove={() => set({ openTasks: false })} />}
      {value.hideReplies && <Chip tone="flag" label="Hide replies" onRemove={() => set({ hideReplies: false })} />}

      <AddFilter spaceId={spaceId} value={value} onChange={onChange} allowHideReplies={mode !== 'thread'} />

      {sort && onSortChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="filter-btn" aria-label={`Sort: ${sortLabel(sort)}`}>
              <SwapVertRoundedIcon fontSize="inherit" className="icon-sm" />
              <span className="hidden sm:inline">{sortLabel(sort)}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SORT_OPTIONS.map(o => (
              <DropdownMenuItem key={o.value} onSelect={() => onSortChange(o.value)} className={o.value === sort ? 'text-primary' : undefined}>
                {o.value === sort ? '✓ ' : ''}{o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {trailing}

      {!empty && mode !== 'rule' && (
        <button type="button" className="filter-btn filter-btn-ghost" onClick={() => { setText(''); onChange({ ...EMPTY_CRITERIA }) }}>Clear</button>
      )}
      {!empty && mode === 'feed' && onSaveAsFolder && <SaveAsFolder target={saveTarget ?? null} onSave={onSaveAsFolder} />}
    </div>
  )
}

function Chip({ label, onRemove, tone }: { label: string; onRemove: () => void; tone?: 'neg' | 'flag' }) {
  return (
    <span className={`filter-chip${tone ? ` filter-chip-${tone}` : ''}`}>
      <span className="truncate">{label}</span>
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}>
        <CloseRoundedIcon fontSize="inherit" />
      </button>
    </span>
  )
}

function AddFilter({ spaceId, value, onChange, allowHideReplies }: { spaceId: number; value: Criteria; onChange: (c: Criteria) => void; allowHideReplies: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const used = [...value.include, ...value.exclude]
  const tags = useLiveQuery(
    () => (open ? tagsRepo.suggest({ spaceId, selected: used, query: q, limit: 40 }) : Promise.resolve([] as string[])),
    [open, spaceId, q, used.join('\u0000')],
  ) ?? []
  const activityNames = useLiveQuery(
    async () => (open && featureFlags.quickFiltersActivities ? (await activityTypesRepo.listForSpace(spaceId)).map(t => t.name) : []),
    [open, spaceId],
  ) ?? []
  const add = (patch: Partial<Criteria>) => onChange({ ...value, ...patch })

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ('') }}>
      <PopoverTrigger asChild>
        <button type="button" className="filter-btn" aria-label="Add filter">
          <AddRoundedIcon fontSize="inherit" className="icon-sm" />
          <span>Filter</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="filter-pop" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement)?.querySelector('input')?.focus() }}>
        <input className="input !h-8 text-sm" placeholder="Find a tag" aria-label="Find a tag" value={q} onChange={e => setQ(e.target.value)} />
        <div className="filter-pop-list" role="list" aria-label="Tags">
          {tags.length === 0 && <div className="text-sm text-secondary px-2 py-1.5">{q ? 'No such tag' : 'No tags yet'}</div>}
          {tags.map(t => (
            <div key={t} className="filter-pop-row" role="listitem">
              <span className="truncate flex-1">#{t}</span>
              <button type="button" aria-label={`Only notes tagged ${t}`} title="With this tag" onClick={() => add({ include: [...value.include, t] })}>
                <AddRoundedIcon fontSize="inherit" />
              </button>
              <button type="button" aria-label={`Hide notes tagged ${t}`} title="Without this tag" onClick={() => add({ exclude: [...value.exclude, t] })}>
                <RemoveRoundedIcon fontSize="inherit" />
              </button>
            </div>
          ))}
        </div>
        <div className="filter-pop-sep" />
        <label className="filter-pop-check">
          <input type="checkbox" checked={value.openTasks} onChange={e => add({ openTasks: e.target.checked })} />
          <span>Open tasks <span className="text-secondary">· unticked checklist items</span></span>
        </label>
        {allowHideReplies && (
          <label className="filter-pop-check">
            <input type="checkbox" checked={value.hideReplies} onChange={e => add({ hideReplies: e.target.checked })} />
            <span>Hide replies</span>
          </label>
        )}
        {activityNames.length > 0 && (
          <>
            <div className="filter-pop-sep" />
            {activityNames.map(n => (
              <label key={n} className="filter-pop-check">
                <input
                  type="checkbox"
                  checked={value.activities.includes(n)}
                  onChange={e => add({ activities: e.target.checked ? [...value.activities, n] : value.activities.filter(x => x !== n) })}
                />
                <span>Has {n}</span>
              </label>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SaveAsFolder({ target, onSave }: { target: string | null; onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const submit = () => {
    const n = name.trim()
    if (!n) { inputRef.current?.focus(); return }
    onSave(n)
    setOpen(false)
    setName('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="filter-btn filter-btn-accent">
          <CreateNewFolderRoundedIcon fontSize="inherit" className="icon-sm" />
          <span>Save as folder</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="filter-pop">
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); submit() }}>
          <label className="block text-sm text-secondary" htmlFor="save-folder-name">
            {target ? <>New folder inside <span className="text-primary">{target}</span></> : 'New folder'}
          </label>
          <input ref={inputRef} id="save-folder-name" className="input !h-9" placeholder="Folder name" value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
          <div className="text-xs text-secondary">It will show every note that matches these filters, now and later.</div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="filter-btn filter-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="button !h-8 !px-3 text-sm">Save</button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
