import { useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Avatar } from './ui/avatar'
import { useMe } from '../lib/useSpaces'
import { avatarPath, setMyAvatar, usePicture } from '../lib/pictures'
import PictureField from './PictureField'
import { changePassword, errorText, updateMe } from '../lib/spaces-api'
import { getThemePreference, setThemePreference, type ThemePreference } from '../lib/theme'
import { getServer, serverLabel } from '../lib/server'
import { useAppState } from '../lib/app-state'
import { notify } from '../ui/notify'

type Tab = 'account' | 'notifications' | 'appearance' | 'about'
const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'account', label: 'Account', icon: <PersonRoundedIcon fontSize="inherit" /> },
  { id: 'notifications', label: 'Notifications', icon: <NotificationsRoundedIcon fontSize="inherit" /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteRoundedIcon fontSize="inherit" /> },
  { id: 'about', label: 'Server', icon: <DnsRoundedIcon fontSize="inherit" /> },
]

export default function SettingsDialog({ open, onOpenChange, onLogout }: { open: boolean; onOpenChange: (o: boolean) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('account')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog settings-dialog-wide" aria-describedby={undefined}>
        <div className="settings-head">
          <DialogTitle className="!text-primary !text-[17px] font-semibold">Settings</DialogTitle>
          <button type="button" className="icon-btn !p-1" aria-label="Close" onClick={() => onOpenChange(false)}><CloseRoundedIcon fontSize="inherit" /></button>
        </div>
        <div className="settings-layout">
          <div className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            {TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="settings-nav-item" onClick={() => setTab(t.id)}>
                <span className="icon-sm">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div className="settings-body" role="tabpanel">
            {tab === 'account' && <AccountTab onLogout={onLogout} />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AccountTab({ onLogout }: { onLogout: () => void }) {
  const me = useMe()
  const avatar = usePicture(me ? avatarPath(me.id) : null, me?.avatarVersion)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mismatch = repeat.length > 0 && next !== repeat
  async function submit() {
    if (next.length < 8) { setError('Use at least 8 characters for the new password'); return }
    if (new TextEncoder().encode(next).length > 72) { setError('The new password is too long (at most 72 characters)'); return }
    if (next !== repeat) { setError('The new passwords do not match'); return }
    setBusy(true); setError(null)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setRepeat('')
      notify('Password changed', 'success')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={me?.username ?? '?'} size={44} src={avatar} />
        <div className="min-w-0">
          <div className="font-semibold truncate">{me?.username ?? '…'}</div>
          <div className="text-sm text-secondary truncate">{me?.email ?? 'Signed in with a username'}</div>
        </div>
      </div>
      {me && (
        <PictureField
          label="Your picture"
          name={me.username}
          round
          src={avatar}
          onSave={blob => setMyAvatar(blob)}
          onRemove={() => setMyAvatar(null)}
        />
      )}
      <form className="space-y-2 max-w-sm" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="settings-label">Change password</div>
        <input className="input" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={e => setCurrent(e.target.value)} />
        <input className="input" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" aria-label="New password" value={next} onChange={e => setNext(e.target.value)} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" aria-invalid={mismatch} value={repeat} onChange={e => setRepeat(e.target.value)} />
        {error && <p className="settings-error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={busy || !current || !next || !repeat}>Change password</button>
      </form>
      <div className="settings-danger">
        <div><b>Sign out</b><p>Signs you out on this device. Your notes stay on the server; if something is not synced yet, you will be asked first.</p></div>
        <button type="button" className="filter-btn" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}

function NotificationsTab() {
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const available = !!me?.emailNotificationsAvailable
  async function toggle(on: boolean) {
    setBusy(true)
    try { await updateMe({ notifyEmail: on }) } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <p className="settings-note">In the app you always see invitations and changes to your shared spaces under the bell in the top bar.</p>
      <label className={`settings-switch ${available ? '' : 'opacity-60'}`}>
        <input type="checkbox" role="switch" checked={available && !!me?.notifyEmail} disabled={!available || busy} onChange={e => { void toggle(e.target.checked) }} />
        <span>
          <b>Also send them by e-mail</b>
          <small>
            {available
              ? `To ${me?.email}. Invitations to spaces and when you are removed or your role changes.`
              : me?.authMode === 'email' ? 'Confirm your e-mail address first.' : 'This server uses usernames, so it has no e-mail addresses to write to.'}
          </small>
        </span>
      </label>
    </div>
  )
}

function AppearanceTab() {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference())
  const options: Array<{ id: ThemePreference; label: string; hint: string }> = [
    { id: 'system', label: 'System', hint: 'Follows your device' },
    { id: 'light', label: 'Light', hint: 'Bright background' },
    { id: 'dark', label: 'Dark', hint: 'Easy on the eyes at night' },
  ]
  return (
    <div className="space-y-2">
      <div className="settings-label" id="theme-label">Theme</div>
      <div className="theme-options" role="radiogroup" aria-labelledby="theme-label">
        {options.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={pref === o.id} className={`theme-option theme-option-${o.id}`}
            onClick={() => { setPref(o.id); setThemePreference(o.id) }}>
            <span className="theme-swatch" aria-hidden />
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function AboutTab() {
  const lastSyncAt = useAppState(s => s.lastSyncAt)
  const reachable = useAppState(s => s.serverReachable)
  const server = getServer()
  return (
    <div className="space-y-3 text-sm">
      <dl className="settings-dl">
        <dt>Server</dt><dd>{serverLabel(server)}<span className="block text-xs text-secondary break-all">{server}</span></dd>
        <dt>Status</dt><dd>{reachable ? 'Connected' : 'Unreachable right now'}{lastSyncAt ? <span className="block text-xs text-secondary">Last sync {new Date(lastSyncAt).toLocaleString()}</span> : null}</dd>
        <dt>App</dt><dd>focuz web</dd>
      </dl>
      <p className="settings-note">To use another server, sign out and choose it on the sign-in screen.</p>
    </div>
  )
}
