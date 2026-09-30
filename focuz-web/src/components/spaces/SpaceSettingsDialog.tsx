import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { PersonAvatar } from '../ui/avatar'
import PictureField from '../PictureField'
import { setSpaceIcon, spaceIconPath, usePicture } from '../../lib/pictures'
import { db } from '../../lib/db'
import type { SpaceRecord, SpaceRole } from '../../lib/types'
import { assignableRoles, canManage, canRemoveMember, roleOf, ROLE_HINT, ROLE_LABEL } from '../../lib/roles'
import { useMe, useMembers, useShares, publicUrl } from '../../lib/useSpaces'
import {
  cancelInvitation, deleteSpace, errorText, invite, leaveSpace, listSentInvitations, removeMember, renameSpace,
  setMemberRole, shareNote, unshare, type SentInvitation,
} from '../../lib/spaces-api'
import { notify } from '../../ui/notify'
import { defaultServer, getServer } from '../../lib/server'
import { notePreviewText } from '../../lib/note-format/render'

export type SpaceSettingsTab = 'general' | 'members' | 'public'

export default function SpaceSettingsDialog({ space, tab, onTabChange, onClose, onGone }: {
  space: SpaceRecord
  tab: SpaceSettingsTab
  onTabChange: (t: SpaceSettingsTab) => void
  onClose: () => void
  /** The space was left or deleted: switch away from it. */
  onGone: () => void
}) {
  const role = roleOf(space)
  const tabs: Array<{ id: SpaceSettingsTab; label: string }> = [
    { id: 'general', label: 'General' },
    ...(!space.isPersonal ? [{ id: 'members' as const, label: 'Members' }] : []),
    { id: 'public', label: 'Public links' },
  ]
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="settings-dialog" aria-describedby={undefined}>
        <div className="settings-head">
          <DialogTitle className="!text-primary !text-[17px] font-semibold truncate">{space.name}</DialogTitle>
          <button type="button" className="icon-btn !p-1" aria-label="Close" onClick={onClose}><CloseRoundedIcon fontSize="inherit" /></button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="Space settings">
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="settings-tab" onClick={() => onTabChange(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="settings-body" role="tabpanel">
          {tab === 'general' && <GeneralTab space={space} role={role} onGone={onGone} />}
          {tab === 'members' && !space.isPersonal && <MembersTab space={space} role={role} />}
          {tab === 'public' && <PublicTab space={space} role={role} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GeneralTab({ space, role, onGone }: { space: SpaceRecord; role: SpaceRole; onGone: () => void }) {
  const me = useMe()
  const [name, setName] = useState(space.name)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null)
  const [typed, setTyped] = useState('')
  const editable = canManage(role)
  const icon = usePicture(space.serverId ? spaceIconPath(space.serverId) : null, space.iconVersion)

  async function save() {
    if (!name.trim() || name.trim() === space.name) return
    setBusy(true)
    try { await renameSpace(space.id!, name); notify('Space renamed', 'success') } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }
  async function leaveOrDelete() {
    setBusy(true)
    try {
      if (confirm === 'delete') await deleteSpace(space.id!)
      else if (me) await leaveSpace(space.id!, me.id)
      notify(confirm === 'delete' ? `“${space.name}” deleted` : `You left “${space.name}”`, 'success')
      onGone()
    } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save() }}>
        <label htmlFor="space-name" className="settings-label">Name</label>
        <div className="flex gap-2">
          <input id="space-name" className="input" value={name} disabled={!editable} maxLength={100} onChange={e => setName(e.target.value)} />
          {editable && <button type="submit" className="button" disabled={busy || !name.trim() || name.trim() === space.name}>Save</button>}
        </div>
      </form>
      {!space.isPersonal && editable && (
        <PictureField
          label="Space picture"
          name={space.name}
          src={icon}
          onSave={blob => setSpaceIcon(space.id!, blob)}
          onRemove={() => setSpaceIcon(space.id!, null)}
        />
      )}
      <div className="settings-note">
        {space.isPersonal
          ? 'Your personal space. Only you can see it, and it can’t be shared. To work with others, create a shared space with the “+” on the left. Single notes from here can still be published.'
          : <>Your role: <b>{ROLE_LABEL[role]}</b> · {ROLE_HINT[role]}</>}
      </div>
      {!space.isPersonal && (
        <div className="settings-danger">
          {role === 'owner' ? (
            <>
              <div><b>Delete space</b><p>Everyone loses access to its notes. Public links stop working.</p></div>
              <button type="button" className="button button-danger" onClick={() => { setConfirm('delete'); setTyped('') }}>Delete…</button>
            </>
          ) : (
            <>
              <div><b>Leave space</b><p>Its notes disappear from your devices. Someone has to invite you again to come back.</p></div>
              <button type="button" className="button button-danger" onClick={() => setConfirm('leave')}>Leave…</button>
            </>
          )}
        </div>
      )}
      {confirm && (
        <div className="settings-confirm" role="alertdialog" aria-label={confirm === 'delete' ? 'Confirm deleting the space' : 'Confirm leaving the space'}>
          {confirm === 'delete' ? (
            <>
              <p>Type <b>{space.name}</b> to delete it for everyone.</p>
              <input className="input" aria-label="Space name to confirm" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
            </>
          ) : <p>Leave “{space.name}”?</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="filter-btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="button button-danger" disabled={busy || (confirm === 'delete' && typed.trim() !== space.name)} onClick={() => { void leaveOrDelete() }}>
              {confirm === 'delete' ? 'Delete space' : 'Leave'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RoleSelect({ value, options, onChange, label }: { value: SpaceRole; options: SpaceRole[]; onChange: (r: SpaceRole) => void; label: string }) {
  return (
    <select className="role-select" aria-label={label} value={value} onChange={e => onChange(e.target.value as SpaceRole)}>
      {!options.includes(value) && <option value={value}>{ROLE_LABEL[value]}</option>}
      {options.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  )
}

function MembersTab({ space, role }: { space: SpaceRecord; role: SpaceRole }) {
  const me = useMe()
  const members = useMembers(space.serverId)
  const [pending, setPending] = useState<SentInvitation[] | null>(null)
  const inviteRoles = assignableRoles(role, null)
  const [who, setWho] = useState('')
  const [newRole, setNewRole] = useState<SpaceRole>('editor')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byEmail = me?.authMode === 'email'

  const reload = useCallback(() => {
    if (canManage(role)) listSentInvitations(space.id!).then(setPending).catch(() => setPending([]))
  }, [space.id, role])
  // Invitations are answered elsewhere: reload when someone joins, on server events and on return to the window.
  useEffect(reload, [reload, members.length])
  useEffect(() => {
    window.addEventListener('focuz:server-event', reload)
    window.addEventListener('focus', reload)
    return () => {
      window.removeEventListener('focuz:server-event', reload)
      window.removeEventListener('focus', reload)
    }
  }, [reload])

  async function submit() {
    if (!who.trim()) return
    setBusy(true); setError(null); setSent(null)
    try {
      await invite(space.id!, who, newRole)
      setSent(who.trim())
      setWho('')
      reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {inviteRoles.length > 0 && (
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label htmlFor="invite-who" className="settings-label">Invite people</label>
          <div className="flex flex-wrap gap-2">
            <input
              id="invite-who"
              className="input flex-1 min-w-[12rem]"
              type={byEmail ? 'email' : 'text'}
              autoComplete="off"
              placeholder={byEmail ? 'E-mail address' : 'Username'}
              value={who}
              onChange={e => { setWho(e.target.value); setSent(null); setError(null) }}
            />
            <RoleSelect label="Role for the invitation" value={newRole} options={inviteRoles} onChange={setNewRole} />
            <button type="submit" className="button" disabled={busy || !who.trim()}>Invite</button>
          </div>
          <p className="text-xs text-secondary">{ROLE_LABEL[newRole]}: {ROLE_HINT[newRole].toLowerCase()}.</p>
          {sent && <p className="settings-ok" role="status">Invitation for “{sent}” is sent. If there is an account with this {byEmail ? 'address' : 'name'}, they will see it in focuz{byEmail ? ' and by e-mail' : ''}.</p>}
          {error && <p className="settings-error" role="alert">{error}</p>}
        </form>
      )}

      <section className="space-y-1" aria-label="Members">
        <div className="settings-label">Members · {members.length}</div>
        <ul className="member-list">
          {members.map(m => {
            const isMe = m.userId === me?.id
            const options = isMe ? [] : assignableRoles(role, m.role)
            return (
              <li key={m.userId} className="member-row">
                <PersonAvatar userId={m.userId} name={m.username} size={30} />
                <span className="flex-1 min-w-0 truncate">{m.username}{isMe && <span className="text-secondary"> · you</span>}</span>
                {options.length > 0
                  ? <RoleSelect label={`Role of ${m.username}`} value={m.role} options={options} onChange={r => { setMemberRole(space.id!, m.userId, r).catch(e => notify(errorText(e), 'error')) }} />
                  : <span className="role-badge">{ROLE_LABEL[m.role]}</span>}
                {!isMe && canRemoveMember(role, m.role) && (
                  <button type="button" className="icon-btn !p-1" aria-label={`Remove ${m.username}`} title="Remove from space"
                    onClick={() => { removeMember(space.id!, m.userId).then(() => notify(`${m.username} removed`, 'success')).catch(e => notify(errorText(e), 'error')) }}>
                    <CloseRoundedIcon fontSize="inherit" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {canManage(role) && pending && pending.length > 0 && (
        <section className="space-y-1" aria-label="Pending invitations">
          <div className="settings-label">Waiting for an answer</div>
          <ul className="member-list">
            {pending.map(p => (
              <li key={p.id} className="member-row">
                <span className="avatar avatar-round avatar-pending" aria-hidden>?</span>
                <span className="flex-1 min-w-0 truncate">{p.identifier}</span>
                <span className="role-badge">{ROLE_LABEL[p.role]}</span>
                <button type="button" className="filter-btn filter-btn-ghost !h-7" onClick={() => { cancelInvitation(space.id!, p.id).then(reload).catch(e => notify(errorText(e), 'error')) }}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="copy-field">
      <input className="input !text-[13px]" readOnly value={value} aria-label={label} onFocus={e => e.currentTarget.select()} />
      <button type="button" className="filter-btn" onClick={() => {
        navigator.clipboard?.writeText(value).then(() => notify('Link copied', 'success')).catch(() => notify('Select the link and copy it', 'info'))
      }}><ContentCopyRoundedIcon fontSize="inherit" className="icon-sm" /> Copy</button>
    </div>
  )
}

function PublicTab({ space, role }: { space: SpaceRecord; role: SpaceRole }) {
  const shares = useShares(space.serverId)
  const spaceShare = shares.find(s => s.noteId == null)
  const noteShares = shares.filter(s => s.noteId != null)
  const notes = useLiveQuery(async () => {
    const ids = noteShares.map(s => s.noteId!)
    return ids.length ? db.notes.where('serverId').anyOf(ids).toArray() : []
  }, [noteShares.map(s => s.noteId).join(',')]) ?? []
  const [busy, setBusy] = useState(false)
  const server = getServer()

  async function toggleSpace(on: boolean) {
    setBusy(true)
    try {
      if (on) await shareNote(space.id!, null, true)
      else if (spaceShare) await unshare(spaceShare.token)
    } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="settings-label">Whole space</div>
        {space.isPersonal ? (
          <p className="settings-note">A personal space can’t be public as a whole. Publish single notes from their ⋮ menu.</p>
        ) : canManage(role) ? (
          <>
            <label className="settings-switch">
              <input type="checkbox" role="switch" checked={!!spaceShare} disabled={busy} onChange={e => { void toggleSpace(e.target.checked) }} />
              <span><b>Anyone with the link can read every note here</b><small>Read-only, no sign-in. Turning it off stops the link for good.</small></span>
            </label>
            {spaceShare && <CopyField value={publicUrl(spaceShare.token, server, defaultServer())} label="Public link to the space" />}
          </>
        ) : (
          <p className="settings-note">{spaceShare ? 'This space is public: anyone with its link can read it. Admins manage this.' : 'Admins can make the whole space public.'}</p>
        )}
      </section>
      <section className="space-y-2">
        <div className="settings-label">Public notes · {noteShares.length}</div>
        {noteShares.length === 0 && <p className="settings-note">No public notes. Use ⋮ → Share on a note.</p>}
        <ul className="member-list">
          {noteShares.map(s => {
            const n = notes.find(x => x.serverId === s.noteId)
            return (
              <li key={s.token} className="member-row">
                <PublicRoundedIcon fontSize="inherit" className="icon-sm text-[rgb(var(--c-accent))] shrink-0" />
                <span className="flex-1 min-w-0 truncate">{n ? notePreviewText(n.text).slice(0, 80) : 'Note'}</span>
                <span className="text-xs text-secondary shrink-0">{s.includeReplies ? 'with replies' : 'note only'}</span>
                <a className="filter-btn filter-btn-ghost !h-7" href={publicUrl(s.token, server, defaultServer())} target="_blank" rel="noreferrer">Open</a>
              </li>
            )
          })}
        </ul>
      </section>
      <DialogDescription className="sr-only">Public links of this space</DialogDescription>
    </div>
  )
}
