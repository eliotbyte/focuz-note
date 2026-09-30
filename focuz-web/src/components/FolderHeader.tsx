import EditRoundedIcon from '@mui/icons-material/EditRounded'
import type { FolderIndex, FolderRule, RuleChipKind } from '../lib/folders'
import { describeRule, folderKind, ruleChips } from '../lib/folders'
import { FolderIcon } from './FolderIcon'
import type { FeedView } from './FolderTree'

export type FolderScope = 'deep' | 'here'

/** Title, the rule as chips, "with subfolders / only this one" and the rule-editing banner. */
export default function FolderHeader({
  index,
  view,
  scope,
  onScopeChange,
  editingRule,
  onEditRule,
  onSaveRule,
  onCancelRule,
}: {
  index: FolderIndex | undefined
  view: FeedView
  scope: FolderScope
  onScopeChange: (s: FolderScope) => void
  /** The draft while the rule is being edited. */
  editingRule: FolderRule | null
  onEditRule: () => void
  onSaveRule: () => void
  onCancelRule: () => void
}) {
  if (view.kind === 'all') return null
  if (view.kind === 'unsorted') {
    return (
      <div className="folder-head">
        <h2 className="folder-title">Unsorted</h2>
        <p className="folder-rule">Notes that are in no folder yet. Put one away with ⋮ → Folders…</p>
      </div>
    )
  }
  const node = index?.nodes.get(view.id)
  if (!node || !index) return null
  const rule = editingRule ?? index.rules.get(view.id)!
  const kind = folderKind(rule)
  const crumbs = node.ancestors.map(id => index.nodes.get(id)?.rec.name).filter(Boolean) as string[]
  const hasChildren = node.children.length > 0

  return (
    <div className="folder-head">
      {crumbs.length > 0 && <div className="folder-crumbs">{crumbs.join(' › ')} ›</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="folder-title">
          <FolderIcon kind={kind} className="folder-icon text-secondary" />
          <span className="truncate">{node.rec.name}</span>
        </h2>
        {hasChildren && !editingRule && (
          <div className="seg" role="group" aria-label="Which notes">
            <button type="button" aria-pressed={scope === 'deep'} onClick={() => onScopeChange('deep')}>With subfolders</button>
            <button type="button" aria-pressed={scope === 'here'} onClick={() => onScopeChange('here')}>Only this folder</button>
          </div>
        )}
      </div>
      <RuleChips rule={rule} onEdit={editingRule ? undefined : onEditRule} />
      {editingRule && (
        <div className="folder-editing" role="region" aria-label="Editing folder rule">
          <span className="flex-1 min-w-[12rem]">Editing the rule. The list below shows what the folder will contain.</span>
          <button type="button" className="filter-btn" onClick={onCancelRule}>Cancel</button>
          <button type="button" className="button !h-8 !px-3 text-sm" onClick={onSaveRule}>Save rule</button>
        </div>
      )}
    </div>
  )
}

const CHIP_HINT: Record<RuleChipKind, string> = {
  tag: 'Notes with this tag. New notes here get it too',
  without: 'Notes with this tag are left out',
  text: 'Notes containing this text',
  activity: 'Notes with this activity',
  tasks: 'Notes with unticked checklist items',
  noreply: 'Replies are left out',
}

/** The rule at a glance: what gets in (green), what stays out (red). Edited with the pencil. */
function RuleChips({ rule, onEdit }: { rule: FolderRule; onEdit?: () => void }) {
  const chips = ruleChips(rule)
  return (
    <div className="folder-rule" role="group" aria-label={describeRule(rule)}>
      {chips.length === 0 && <span>Only subfolders</span>}
      {chips.map((c, i) => (
        <span key={`${c.kind}-${i}`} className={`rule-chip rule-chip-${c.kind}`} title={CHIP_HINT[c.kind]}>
          {c.kind === 'without' && <span className="sr-only">not </span>}
          {c.label}
        </span>
      ))}
      {onEdit && (
        <button type="button" className="icon-btn rule-edit" onClick={onEdit} aria-label="Edit rule" title="Edit rule">
          <EditRoundedIcon fontSize="inherit" />
        </button>
      )}
    </div>
  )
}
