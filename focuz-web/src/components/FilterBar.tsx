import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FindInPageRoundedIcon from '@mui/icons-material/FindInPageRounded'
import { setSearchInFiles, useSearchInFiles } from '../lib/search-prefs'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { activityTypes as activityTypesRepo, tags as tagsRepo } from '../data'
import { featureFlags } from '../lib/feature-flags'
import { EMPTY_CRITERIA, SORT_OPTIONS, isEmptyCriteria, sortLabel, type Criteria, type SortValue } from '../lib/criteria'
import { CLOSED_TASKS_TAG, IN_PROGRESS_TAG, OPEN_TASKS_TAG, REPLIES_TAG, tagLabel } from '../lib/reserved-tags'

const uniq = (xs: string[]) => [...new Set(xs)]

/** The computed filters offered in the picker, after the ordinary tags. */
const TASK_FILTERS = [OPEN_TASKS_TAG, IN_PROGRESS_TAG, CLOSED_TASKS_TAG]

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
  const inFiles = useSearchInFiles()
  const empty = isEmptyCriteria(value)
  const placeholder = mode === 'rule' ? 'Text contains…' : mode === 'thread' ? 'Search replies' : 'Search'

  return (
    <div className="filter-bar" role="search">
      {/* The controls keep their place: chips go to the row below, so adding one never moves "Filter". */}
      <div className="filter-bar-row">
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
          {/* Like "match case" in a code editor: a switch of the search itself, at the end of the field. */}
          {mode !== 'rule' && (
            <button
              type="button"
              className="filter-search-opt"
              aria-pressed={inFiles}
              aria-label="Search in file contents"
              title={inFiles ? 'Searching the notes and their text files (Markdown, text, CSV)' : 'Also search inside text files (Markdown, text, CSV)'}
              onClick={() => setSearchInFiles(!inFiles)}
            >
              <FindInPageRoundedIcon fontSize="inherit" />
            </button>
          )}
        </label>

        <AddFilter spaceId={spaceId} value={value} onChange={onChange} showReplies={mode !== 'thread'} />

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
                <DropdownMenuItem key={o.value} role="menuitemradio" aria-checked={o.value === sort} onSelect={() => onSortChange(o.value)}>
                  {o.label}
                  {o.value === sort && <CheckRoundedIcon aria-hidden fontSize="inherit" className="icon-sm dropdown-check" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {trailing}
      </div>

      {!empty && (
        <div className="filter-bar-row filter-chips-row">
          {/* A click on a chip flips it: green (must have the tag) <-> red (must not have it). The text never changes. */}
          {value.include.map(t => (
            <Chip
              key={`i-${t}`}
              label={tagLabel(t)}
              stateText="required"
              onRemove={() => set({ include: value.include.filter(x => x !== t) })}
              onToggle={() => set({ include: value.include.filter(x => x !== t), exclude: uniq([...value.exclude, t]) })}
              toggleTitle="Click to hide notes with this tag"
            />
          ))}
          {value.exclude.map(t => (
            <Chip
              key={`e-${t}`}
              tone="neg"
              label={tagLabel(t)}
              stateText="excluded"
              onRemove={() => set({ exclude: value.exclude.filter(x => x !== t) })}
              onToggle={() => set({ exclude: value.exclude.filter(x => x !== t), include: uniq([...value.include, t]) })}
              toggleTitle="Click to show only notes with this tag"
            />
          ))}
          {value.activities.map(a => (
            <Chip key={`a-${a}`} tone="flag" label={a} onRemove={() => set({ activities: value.activities.filter(x => x !== a) })} />
          ))}

          {!empty && mode !== 'rule' && (
            <button type="button" className="filter-btn filter-btn-ghost" onClick={() => { setText(''); onChange({ ...EMPTY_CRITERIA }) }}>Clear</button>
          )}
          {!empty && mode === 'feed' && onSaveAsFolder && <SaveAsFolder target={saveTarget ?? null} onSave={onSaveAsFolder} />}
        </div>
      )}
    </div>
  )
}

/** A filter chip. With onToggle, the whole chip flips on a click; only the × removes it. */
function Chip({ label, stateText, onRemove, onToggle, toggleTitle, tone }: { label: string; stateText?: string; onRemove: () => void; onToggle?: () => void; toggleTitle?: string; tone?: 'neg' | 'flag' }) {
  const className = `filter-chip${tone ? ` filter-chip-${tone}` : ''}`
  const remove = (
    <button type="button" aria-label={`Remove filter ${label}${stateText ? ` (${stateText})` : ''}`} onClick={e => { e.stopPropagation(); onRemove() }}>
      <CloseRoundedIcon fontSize="inherit" />
    </button>
  )
  if (!onToggle) return <span className={className}><span className="truncate">{label}</span>{remove}</span>
  return (
    <span
      className={`${className} cursor-pointer`}
      role="button"
      tabIndex={0}
      title={toggleTitle}
      aria-label={`${label}, ${stateText}. ${toggleTitle}`}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
    >
      <span className="truncate">{label}</span>
      {remove}
    </span>
  )
}

/** One line of the picker. A click adds it as a filter and it leaves the list; the chip does the rest. */
function FilterItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="filter-pop-item" aria-label={`Add filter ${label}`} onClick={onClick}>
      <span className="truncate">{label}</span>
    </button>
  )
}

function AddFilter({ spaceId, value, onChange, showReplies }: { spaceId: number; value: Criteria; onChange: (c: Criteria) => void; showReplies: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  // Whatever is already a chip is not offered again: the list holds only what can still be added.
  const used = [...value.include, ...value.exclude]
  // Ordinary tags come from the notes; the reserved filters are computed, so they are not tags.
  const tags = useLiveQuery(
    () => (open ? tagsRepo.suggest({ spaceId, selected: used, query: q, limit: 40 }) : Promise.resolve([] as string[])),
    [open, spaceId, q, used.join('\u0000')],
  ) ?? []
  const activityNames = useLiveQuery(
    async () => (open && featureFlags.quickFiltersActivities ? (await activityTypesRepo.listForSpace(spaceId)).map(t => t.name) : []),
    [open, spaceId],
  ) ?? []
  const add = (patch: Partial<Criteria>) => onChange({ ...value, ...patch })
  const offered = (tag: string) => !used.includes(tag) && (!needle || tagLabel(tag).includes(needle))
  const taskFilters = TASK_FILTERS.filter(offered)
  const replies = showReplies && offered(REPLIES_TAG)
  const include = (tag: string) => onChange({ ...value, include: [...value.include, tag] })

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
        <div className="filter-pop-list" aria-label="Tags">
          {tags.length === 0 && taskFilters.length === 0 && !replies && (
            <div className="text-sm text-secondary px-2 py-1.5">{q ? 'No such tag' : used.length ? 'Everything is in the filter' : 'No tags yet'}</div>
          )}
          {tags.map(t => <FilterItem key={t} label={`#${t}`} onClick={() => include(t)} />)}
        </div>
        {taskFilters.length > 0 && (
          <>
            {tags.length > 0 && <div className="filter-pop-sep" />}
            {taskFilters.map(t => <FilterItem key={t} label={tagLabel(t)} onClick={() => include(t)} />)}
          </>
        )}
        {replies && (
          <>
            {(tags.length > 0 || taskFilters.length > 0) && <div className="filter-pop-sep" />}
            <FilterItem label={tagLabel(REPLIES_TAG)} onClick={() => include(REPLIES_TAG)} />
          </>
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
