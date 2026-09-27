import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import type { SpaceRecord } from '../../lib/types'
import { canManage, roleOf, ROLE_LABEL } from '../../lib/roles'
import { useMembers, useShares } from '../../lib/useSpaces'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Avatar } from '../ui/avatar'
import type { SpaceSettingsTab } from './SpaceSettingsDialog'

/** Name of the open space with its menu, and who is in it. */
export default function SpaceHeader({ space, onOpen, onCreateShared }: {
  space: SpaceRecord
  onOpen: (tab: SpaceSettingsTab) => void
  onCreateShared: () => void
}) {
  const role = roleOf(space)
  const members = useMembers(space.serverId)
  const isPublic = useShares(space.serverId).some(s => s.noteId == null)
  const shown = members.slice(0, 4)
  return (
    <div className="space-head">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="space-head-btn" aria-label={`Space menu: ${space.name}`}>
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate font-semibold">{space.name}</span>
                {isPublic && <PublicRoundedIcon fontSize="inherit" className="icon-sm text-[rgb(var(--c-accent))] shrink-0" titleAccess="Public" />}
              </span>
              <span className="block text-[11.5px] text-secondary truncate">
                {space.isPersonal ? 'Personal · only you' : `${ROLE_LABEL[role]} · ${space.memberCount ?? members.length} member${(space.memberCount ?? members.length) === 1 ? '' : 's'}`}
              </span>
            </span>
            <ExpandMoreRoundedIcon fontSize="inherit" className="icon-sm text-secondary shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {!space.isPersonal && canManage(role) && <DropdownMenuItem onSelect={() => onOpen('members')}>Invite people</DropdownMenuItem>}
          {!space.isPersonal && <DropdownMenuItem onSelect={() => onOpen('members')}>Members</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => onOpen('public')}>Public links</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen('general')}>Space settings</DropdownMenuItem>
          {space.isPersonal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onCreateShared}>Create a shared space…</DropdownMenuItem>
            </>
          )}
          {!space.isPersonal && role !== 'owner' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="menu-danger" onSelect={() => onOpen('general')}>Leave space…</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!space.isPersonal && shown.length > 0 && (
        <button type="button" className="space-members" onClick={() => onOpen('members')} aria-label={`Members: ${members.map(m => m.username).join(', ')}`}>
          <span className="flex -space-x-1.5">
            {shown.map(m => <Avatar key={m.userId} name={m.username} size={22} className="ring-2 ring-[rgb(var(--c-surface))]" title={m.username} />)}
          </span>
          {members.length > shown.length && <span className="text-[11.5px] text-secondary">+{members.length - shown.length}</span>}
        </button>
      )}
    </div>
  )
}
