import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import { useAppState } from '../lib/app-state'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * Marks a note that is not on the server yet. A note that is saved is shown without a mark.
 * The icon says why it waits: no connection, a send in progress, or just waiting for its turn.
 */
export default function SyncMark({ pending }: { pending: boolean }) {
  const online = useAppState(s => s.online)
  const reachable = useAppState(s => s.serverReachable)
  const syncing = useAppState(s => s.syncing)
  if (!pending) return null
  const offline = !online || !reachable
  const { icon, label } = offline
    ? { icon: <CloudOffRoundedIcon fontSize="inherit" />, label: 'Saved on this device. It will be sent when the server is reachable again.' }
    : syncing
      ? { icon: <SyncRoundedIcon fontSize="inherit" className="animate-spin" />, label: 'Sending to the server…' }
      : { icon: <ScheduleRoundedIcon fontSize="inherit" />, label: 'Saved on this device. Waiting to be sent.' }
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`icon-sm inline-flex self-center ${offline ? 'text-amber-500' : 'text-secondary'}`} aria-label={label}>{icon}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
