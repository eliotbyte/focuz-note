import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import type { SpaceRecord } from '../../lib/types'
import { Avatar } from '../ui/avatar'

/** Discord-like column of spaces: the personal one on top, shared spaces below, "+" to create. */
export default function SpaceRail({ spaces, currentId, onSelect, onCreate }: {
  spaces: SpaceRecord[]
  currentId: number | null
  onSelect: (localId: number) => void
  onCreate: () => void
}) {
  const personal = spaces.filter(s => s.isPersonal)
  const shared = spaces.filter(s => !s.isPersonal)
  const item = (s: SpaceRecord) => {
    const active = s.id === currentId
    const label = s.isPersonal ? `${s.name} (personal)` : s.name
    return (
      <li key={s.id} className="space-rail-item">
        <span aria-hidden className={`space-rail-pill ${active ? 'is-active' : ''}`} />
        <button
          type="button"
          className={`space-rail-btn ${active ? 'is-active' : ''}`}
          aria-label={label}
          aria-current={active ? 'true' : undefined}
          title={label}
          onClick={() => onSelect(s.id!)}
        >
          {s.isPersonal
            ? <span className="space-rail-personal"><PersonRoundedIcon fontSize="inherit" /></span>
            : <Avatar name={s.name} size={44} shape="square" className="space-rail-avatar" />}
        </button>
      </li>
    )
  }
  return (
    <nav className="space-rail" aria-label="Spaces">
      <ul className="flex flex-col items-center gap-2">
        {personal.map(item)}
        {shared.length > 0 && <li aria-hidden className="space-rail-sep" />}
        {shared.map(item)}
        <li className="space-rail-item">
          <span aria-hidden className="space-rail-pill" />
          <button type="button" className="space-rail-btn space-rail-add" aria-label="New space" title="New space" onClick={onCreate}>
            <AddRoundedIcon fontSize="inherit" />
          </button>
        </li>
      </ul>
    </nav>
  )
}
