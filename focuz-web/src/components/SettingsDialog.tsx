import { useCallback, useEffect, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import ImportExportRoundedIcon from '@mui/icons-material/ImportExportRounded'
import DataTab from './DataTab'
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
import { createApiToken, listApiTokens, revokeApiToken, type ApiTokenInfo, type ApiTokenScope } from '../lib/api-tokens'

type Tab = 'account' | 'agents' | 'data' | 'notifications' | 'appearance' | 'about'
const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'account', label: 'Account', icon: <PersonRoundedIcon fontSize="inherit" /> },
  { id: 'agents', label: 'Agents', icon: <SmartToyRoundedIcon fontSize="inherit" /> },
  { id: 'data', label: 'Data', icon: <ImportExportRoundedIcon fontSize="inherit" /> },
  { id: 'notifications', label: 'Notifications', icon: <NotificationsRoundedIcon fontSize="inherit" /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteRoundedIcon fontSize="inherit" /> },
  { id: 'about', label: 'Server', icon: <DnsRoundedIcon fontSize="inherit" /> },
]

export default function SettingsDialog({ open, onOpenChange, onLogout, spaceId, spaceName, canWrite }: { open: boolean; onOpenChange: (o: boolean) => void; onLogout: () => void; /** The space open in the app: export and import work on it. */ spaceId: number | null; spaceName: string; canWrite: boolean }) {
  const [tab, setTab] = useState<Tab>('account')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog settings-dialog-wide" aria-describedby={undefined}>
        <div className="settings-head">
          <DialogTitle>Settings</DialogTitle>
          <button type="button" className="icon-btn icon-btn-close !p-1" aria-label="Close" onClick={() => onOpenChange(false)}><CloseRoundedIcon fontSize="inherit" /></button>
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
            {tab === 'agents' && <AgentsTab />}
            {tab === 'data' && <DataTab spaceId={spaceId} spaceName={spaceName} canWrite={canWrite} />}
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
        <div>
          <label htmlFor="pw-current" className="auth-label block">Current password</label>
          <input id="pw-current" className="input w-full" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pw-new" className="auth-label block">New password</label>
          <input id="pw-new" className="input w-full" type="password" autoComplete="new-password" aria-describedby="pw-new-hint" value={next} onChange={e => setNext(e.target.value)} />
          <div id="pw-new-hint" className="auth-hint">8 characters or more.</div>
        </div>
        <div>
          <label htmlFor="pw-repeat" className="auth-label block">Repeat new password</label>
          <input id="pw-repeat" className="input w-full" type="password" autoComplete="new-password" aria-invalid={mismatch} value={repeat} onChange={e => setRepeat(e.target.value)} />
        </div>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={busy || !current || !next || !repeat}>Change password</button>
      </form>
      <div className="settings-danger">
        <div><b>Sign out</b><p>Signs you out on this device. Your notes stay on the server; if something is not synced yet, you will be asked first.</p></div>
        <button type="button" className="button button-secondary" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}

function AgentsTab() {
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiTokenScope>('write')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The secret of a token just created. It is not stored anywhere on the page and is gone after "Done".
  const [secret, setSecret] = useState<string | null>(null)
  // The token whose row asks "Revoke?" (in the dialog, not window.confirm, like the other destructive actions).
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const mcpUrl = `${getServer() ?? ''}/mcp`
  const command = secret ? `claude mcp add --transport http focuz ${mcpUrl} --header "Authorization: Bearer ${secret}"` : ''

  const load = useCallback(async () => {
    try { setTokens(await listApiTokens()) } catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Give the token a name'); return }
    setBusy(true); setError(null)
    try {
      const created = await createApiToken(trimmed, scope)
      setSecret(created.token)
      setName('')
      await load()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  async function revoke(t: ApiTokenInfo) {
    setBusy(true)
    try {
      await revokeApiToken(t.id)
      setConfirmId(null)
      notify('Token revoked', 'success')
      await load()
    } catch (e) { notify(errorText(e), 'error') } finally { setBusy(false) }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      notify('Command copied', 'success')
    } catch { notify('Could not copy: select the text and copy it yourself', 'error') }
  }

  return (
    <div className="space-y-6">
      <p className="settings-note">
        Let an agent such as Claude read or edit your notes. A token acts as you: the agent can do only what you
        can do in the spaces you share. Use a read-only token for an agent that should only look.
      </p>

      {secret && (
        <div className="space-y-2">
          <div className="settings-label">Token created</div>
          <p className="settings-note">Copy this command now. The token is shown only once; if you lose it, revoke it and make a new one.</p>
          <code className="code-block">{command}</code>
          <div className="flex gap-2">
            <button type="button" className="button" onClick={() => { void copyCommand() }}>Copy command</button>
            <button type="button" className="button button-secondary" onClick={() => setSecret(null)}>Done</button>
          </div>
        </div>
      )}

      <form className="space-y-2 max-w-sm" onSubmit={e => { e.preventDefault(); void create() }}>
        <div className="settings-label">New token</div>
        <input className="input" placeholder="Name, for example Claude" aria-label="Token name" maxLength={100} value={name} onChange={e => setName(e.target.value)} />
        <select className="input" aria-label="Access" value={scope} onChange={e => setScope(e.target.value as ApiTokenScope)}>
          <option value="write">Read and write notes</option>
          <option value="read">Read only</option>
        </select>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={busy || !name.trim()}>Create token</button>
      </form>

      <div className="space-y-2">
        <div className="settings-label">Active tokens</div>
        {tokens === null && !error && <p className="settings-note">Loading…</p>}
        {tokens?.length === 0 && <p className="settings-note">No tokens yet.</p>}
        {tokens?.map(t => (
          <div key={t.id} className="space-y-2">
            <div className="settings-danger">
              <div className="min-w-0">
                <b className="truncate block">{t.name} <span className="text-xs font-normal text-secondary">· {t.scope === 'read' ? 'read only' : 'read and write'}</span></b>
                <p className="font-mono text-xs">{t.prefix}…</p>
                <p>
                  Created {new Date(t.createdAt).toLocaleDateString()} · {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}
                </p>
              </div>
              <button type="button" className="button button-secondary" disabled={confirmId === t.id} onClick={() => setConfirmId(t.id)}>Revoke…</button>
            </div>
            {confirmId === t.id && (
              <div className="settings-confirm" role="alertdialog" aria-label={`Confirm revoking ${t.name}`}>
                <p>Revoke “{t.name}”? Agents that use it stop working at once.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="button button-secondary" onClick={() => setConfirmId(null)}>Cancel</button>
                  <button type="button" className="button button-danger" disabled={busy} onClick={() => { void revoke(t) }}>Revoke</button>
                </div>
              </div>
            )}
          </div>
        ))}
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
