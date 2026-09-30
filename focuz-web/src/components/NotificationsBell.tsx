import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { PersonAvatar } from './ui/avatar'
import { getKV } from '../lib/db'
import {
  acceptInvitation, declineInvitation, errorText, fetchNotifications, markNotificationsRead, NOTIFICATIONS_KV, type AppNotification,
} from '../lib/spaces-api'
import { formatAgo } from '../lib/time'
import { notify, notifyWithAction } from '../ui/notify'

function describe(n: AppNotification): { who: string; text: ReactNode } {
  const p = n.payload || {}
  const space = <b>{p.spaceName}</b>
  switch (n.type) {
    case 'space_invitation':
      return { who: p.inviterName, text: <><b>{p.inviterName}</b> invited you to {space}{p.role ? ` as ${p.role}` : ''}</> }
    case 'invitation_accepted':
      return { who: p.userName, text: <><b>{p.userName}</b> joined {space}</> }
    case 'role_changed':
      return { who: p.actorName, text: <><b>{p.actorName}</b> made you {p.role} in {space}</> }
    case 'removed_from_space':
      return { who: p.actorName, text: <><b>{p.actorName}</b> removed you from {space}</> }
    case 'space_deleted':
      return { who: p.actorName, text: <><b>{p.actorName}</b> deleted {space}</> }
    default:
      return { who: 'focuz', text: <>Something changed{p.spaceName ? <> in {space}</> : null}</> }
  }
}

const INVITATION_OUTCOME: Record<string, string> = {
  accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled by the sender', expired: 'Expired',
}

// Older servers don't report the status: an answered invitation is simply marked read there.
function isPendingInvite(n: AppNotification): boolean {
  if (n.type !== 'space_invitation') return false
  return n.invitationStatus ? n.invitationStatus === 'pending' : !n.isRead
}

/** Bell with the unread count; invitations can be accepted right in the list. */
export default function NotificationsBell({ onOpenSpace }: { onOpenSpace: (localSpaceId: number) => void }) {
  const data = useLiveQuery(() => getKV<{ items: AppNotification[]; unread: number }>(NOTIFICATIONS_KV), [])
  const items = data?.items ?? []
  const unread = data?.unread ?? 0
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const seen = useRef<Set<number> | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { fetchNotifications().catch(() => {}) }, 150)
    }
    refresh()
    const onEvent = () => refresh()
    window.addEventListener('focuz:server-event', onEvent)
    window.addEventListener('focus', onEvent)
    const every = setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focuz:server-event', onEvent)
      window.removeEventListener('focus', onEvent)
      clearInterval(every)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // A new invitation while the app is open deserves a toast; everything else just updates the badge.
  useEffect(() => {
    if (!data) return
    if (seen.current == null) { seen.current = new Set(items.map(n => n.id)); return }
    for (const n of items) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      if (n.type === 'space_invitation' && !n.isRead) {
        notifyWithAction(`${n.payload?.inviterName ?? 'Someone'} invited you to “${n.payload?.spaceName ?? 'a space'}”`, { label: 'View', onClick: () => setOpen(true) }, { id: `invitation-${n.id}` })
      }
    }
  }, [data, items])

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Closing marks what was seen as read; invitations stay until they are answered.
    if (!next) {
      const ids = items.filter(n => !n.isRead && n.type !== 'space_invitation').map(n => n.id)
      if (ids.length) markNotificationsRead(ids).catch(() => {})
    }
  }

  async function answer(n: AppNotification, accept: boolean) {
    setBusy(n.id)
    try {
      if (accept) {
        const localId = await acceptInvitation(Number(n.payload.invitationId))
        notify(`You joined “${n.payload.spaceName}”`, 'success')
        setOpen(false)
        if (localId) onOpenSpace(localId)
      } else {
        await declineInvitation(Number(n.payload.invitationId))
      }
      await fetchNotifications()
    } catch (e) {
      notify(errorText(e), 'error')
      fetchNotifications().catch(() => {})
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button className="icon-btn icon-35 relative" type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <NotificationsRoundedIcon fontSize="inherit" />
          {unread > 0 && <span className="bell-badge" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="bell-pop" aria-label="Notifications">
        <div className="bell-head">
          <span className="font-semibold">Notifications</span>
          {items.some(n => !n.isRead && n.type !== 'space_invitation') && (
            <button type="button" className="link-btn text-[13px]" onClick={() => { markNotificationsRead('all').catch(() => {}) }}>Mark all read</button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="bell-empty">Nothing yet. Invitations and changes in your shared spaces show up here.</div>
        ) : (
          <ul className="bell-list">
            {items.map(n => {
              const d = describe(n)
              const pendingInvite = isPendingInvite(n)
              const outcome = n.type === 'space_invitation' && !pendingInvite ? INVITATION_OUTCOME[n.invitationStatus ?? ''] : undefined
              return (
                <li key={n.id} className={`bell-item ${n.isRead ? '' : 'is-unread'}`}>
                  <PersonAvatar name={d.who || '?'} size={30} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="text-[13.5px] leading-snug">{d.text}</div>
                    <div className="text-[11.5px] text-secondary">{formatAgo(n.createdAt)}{outcome ? ` · ${outcome}` : ''}</div>
                    {pendingInvite && (
                      <div className="flex gap-2">
                        <button type="button" className="button !h-7 !px-3 text-[13px]" disabled={busy === n.id} onClick={() => { void answer(n, true) }}>Accept</button>
                        <button type="button" className="filter-btn !h-7" disabled={busy === n.id} onClick={() => { void answer(n, false) }}>Decline</button>
                      </div>
                    )}
                  </div>
                  {!n.isRead && !pendingInvite && <span className="bell-dot" aria-label="Unread" />}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
