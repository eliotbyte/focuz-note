import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ensureDefaultSpace, getLastUsername, login, register, runSync } from '../lib/sync'
import { getApiBase } from '../lib/api'
import { describeAuthError, passwordChecks, validateAuthForm, type AuthField, type AuthMode } from '../lib/auth-form'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import KeyboardCapslockRoundedIcon from '@mui/icons-material/KeyboardCapslockRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import WifiOffRoundedIcon from '@mui/icons-material/WifiOffRounded'
import OfflineBoltRoundedIcon from '@mui/icons-material/OfflineBoltRounded'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'

// ---------------------------------------------------------------------------
// Fields

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-field">
      <label htmlFor={id} className="auth-label">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="auth-field-error" role="alert">
          <ErrorOutlineRoundedIcon fontSize="inherit" className="icon-sm" />{error}
        </p>
      ) : hint ? <div id={`${id}-hint`} className="auth-hint">{hint}</div> : null}
    </div>
  )
}

function PasswordInput({
  id, value, onChange, autoComplete, invalid, describedBy, inputRef, onBlur, autoFocus,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  invalid?: boolean
  describedBy?: string
  inputRef?: React.Ref<HTMLInputElement>
  onBlur?: () => void
  autoFocus?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'))
  }
  return (
    <>
      <div className="auth-input-wrap">
        <input
          id={id}
          ref={inputRef}
          className="input auth-input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKey}
          onKeyUp={onKey}
          onBlur={() => { setCapsLock(false); onBlur?.() }}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required
        />
        <button
          type="button"
          className="auth-reveal"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? <VisibilityOffRoundedIcon fontSize="inherit" className="icon-sm" /> : <VisibilityRoundedIcon fontSize="inherit" className="icon-sm" />}
        </button>
      </div>
      {capsLock && (
        <p className="auth-caps" role="status">
          <KeyboardCapslockRoundedIcon fontSize="inherit" className="icon-sm" /> Caps Lock is on
        </p>
      )}
    </>
  )
}

function PasswordChecklist({ password, id }: { password: string; id: string }) {
  const checks = passwordChecks(password)
  return (
    <ul id={id} className="auth-checklist" aria-label="Password requirements">
      {checks.map(c => (
        <li key={c.id} className={c.ok ? 'is-ok' : ''}>
          {c.ok ? <CheckRoundedIcon fontSize="inherit" className="icon-sm" /> : <RadioButtonUncheckedRoundedIcon fontSize="inherit" className="icon-sm" />}
          <span>{c.label}</span>
          <span className="sr-only">{c.ok ? '(done)' : '(missing)'}</span>
        </li>
      ))}
    </ul>
  )
}

function SubmitButton({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button type="submit" className="button auth-submit" disabled={loading} aria-busy={loading || undefined}>
      {loading ? <span className="auth-spinner" aria-hidden /> : null}
      <span>{loading ? loadingLabel : label}</span>
      {!loading && <ArrowForwardRoundedIcon fontSize="inherit" className="icon-sm" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sign in / create account

export function AuthForm({ onDone }: { onDone: () => void }) {
  const uid = useId()
  const lastUsername = useMemo(() => getLastUsername() || '', [])
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState(lastUsername)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<AuthField, boolean>>>({})
  const [serverError, setServerError] = useState<{ message: string; field?: AuthField } | null>(null)
  const online = useOnline()
  const refs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  }

  const errors = validateAuthForm(mode, { username, password, confirm })
  // Show a field's error after the user left it or tried to submit, never while typing the first time.
  const shown = (f: AuthField) => (submitted || touched[f]) ? errors[f] : undefined
  const fieldError = (f: AuthField) => shown(f) ?? (serverError?.field === f ? serverError.message : undefined)

  function switchMode(next: AuthMode) {
    if (next === mode) return
    setMode(next)
    setPassword('')
    setConfirm('')
    setSubmitted(false)
    setTouched({})
    setServerError(null)
    requestAnimationFrame(() => (username.trim() ? refs.password : refs.username).current?.focus())
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setSubmitted(true)
    setServerError(null)
    const firstInvalid = (['username', 'password', 'confirm'] as AuthField[]).find(f => errors[f])
    if (firstInvalid) { refs[firstInvalid].current?.focus(); return }
    setLoading(true)
    try {
      const name = username.trim().toLowerCase()
      if (mode === 'register') await register(name, password)
      await login(name, password)
      await ensureDefaultSpace()
      await runSync()
      onDone()
    } catch (err) {
      const d = describeAuthError(err, mode)
      setServerError(d)
      if (d.field) requestAnimationFrame(() => { refs[d.field!].current?.focus(); refs[d.field!].current?.select() })
    } finally {
      setLoading(false)
    }
  }

  const ids = { username: `${uid}-username`, password: `${uid}-password`, confirm: `${uid}-confirm`, checklist: `${uid}-rules` }
  const formLevelError = serverError && !serverError.field ? serverError.message : null
  const isRegister = mode === 'register'

  return (
    <div className="auth-form-wrap">
      <div className="auth-tabs" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!isRegister} className="auth-tab" onClick={() => switchMode('login')}>Sign in</button>
        <button type="button" role="tab" aria-selected={isRegister} className="auth-tab" onClick={() => switchMode('register')}>Create account</button>
        <span className="auth-tab-thumb" data-pos={isRegister ? 'right' : 'left'} aria-hidden />
      </div>

      <header className="auth-heading">
        <h1>{isRegister ? 'Create your account' : (lastUsername ? 'Welcome back' : 'Sign in to focuz')}</h1>
        <p>{isRegister ? 'Your notes are stored on this device and synced to your server.' : 'Your notes stay on this device and sync when the server is reachable.'}</p>
      </header>

      {!online && (
        <div className="auth-banner" role="status">
          <WifiOffRoundedIcon fontSize="inherit" className="icon-sm" />
          You are offline. Connect to the internet to sign in.
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit} noValidate aria-describedby={formLevelError ? `${uid}-form-error` : undefined}>
        <Field id={ids.username} label="Username" error={fieldError('username')} hint={isRegister ? '3 to 50 characters, not case-sensitive' : undefined}>
          <input
            id={ids.username}
            ref={refs.username}
            className="input auth-input"
            name="username"
            value={username}
            onChange={e => { setUsername(e.target.value); if (serverError?.field === 'username') setServerError(null) }}
            onBlur={() => setTouched(t => ({ ...t, username: true }))}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!lastUsername}
            aria-invalid={!!fieldError('username') || undefined}
            aria-describedby={fieldError('username') ? `${ids.username}-error` : isRegister ? `${ids.username}-hint` : undefined}
            required
          />
        </Field>

        <Field id={ids.password} label="Password" error={fieldError('password')}>
          <PasswordInput
            id={ids.password}
            inputRef={refs.password}
            value={password}
            onChange={v => { setPassword(v); if (serverError?.field === 'password') setServerError(null) }}
            onBlur={() => setTouched(t => ({ ...t, password: true }))}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            autoFocus={!!lastUsername}
            invalid={!!fieldError('password')}
            describedBy={[fieldError('password') ? `${ids.password}-error` : '', isRegister ? ids.checklist : ''].filter(Boolean).join(' ') || undefined}
          />
          {isRegister && <PasswordChecklist password={password} id={ids.checklist} />}
        </Field>

        {isRegister && (
          <Field id={ids.confirm} label="Repeat password" error={fieldError('confirm')}>
            <PasswordInput
              id={ids.confirm}
              inputRef={refs.confirm}
              value={confirm}
              onChange={setConfirm}
              onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
              autoComplete="new-password"
              invalid={!!fieldError('confirm')}
              describedBy={fieldError('confirm') ? `${ids.confirm}-error` : undefined}
            />
          </Field>
        )}

        {formLevelError && (
          <div id={`${uid}-form-error`} className="auth-banner is-error" role="alert">
            <ErrorOutlineRoundedIcon fontSize="inherit" className="icon-sm" />{formLevelError}
          </div>
        )}

        <SubmitButton
          loading={loading}
          label={isRegister ? 'Create account' : 'Sign in'}
          loadingLabel={isRegister ? 'Creating account…' : 'Signing in…'}
        />
      </form>

      <p className="auth-switch">
        {isRegister ? 'Already have an account?' : 'New to focuz?'}{' '}
        <button type="button" className="link" onClick={() => switchMode(isRegister ? 'login' : 'register')}>
          {isRegister ? 'Sign in' : 'Create an account'}
        </button>
      </p>
      <ServerNote />
    </div>
  )
}

/** Self-hosted app: show which server the account lives on. */
function ServerNote() {
  const base = getApiBase()
  let host = ''
  try { host = base ? new URL(base).host : '' } catch { host = base || '' }
  if (!host) return null
  return <p className="auth-server">Server <span className="mono">{host}</span></p>
}

// ---------------------------------------------------------------------------
// Page

function NotePreview() {
  // Decorative stack of note cards: shows what the app is instead of describing it.
  return (
    <div className="auth-preview" aria-hidden>
      <div className="auth-note auth-note-back">
        <p>Buy: milk, bread, coffee beans</p>
        <div className="auth-note-tags"><span>home</span><span>shopping</span></div>
      </div>
      <div className="auth-note auth-note-front">
        <p>Written on the train, no signal. It will sync when I am back online.</p>
        <div className="auth-note-tags"><span>ideas</span><span>focuz</span></div>
        <div className="auth-note-meta"><span>just now</span><span className="auth-note-pending">waiting to sync</span></div>
      </div>
    </div>
  )
}

export default function AuthScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="auth-page">
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <div className="auth-logo">focuz</div>
          <h2 className="auth-tagline">Notes that keep working without a connection.</h2>
          <ul className="auth-features">
            <li><OfflineBoltRoundedIcon fontSize="inherit" className="icon-sm" /><span><b>Offline first.</b> Everything is saved on your device instantly.</span></li>
            <li><CloudSyncRoundedIcon fontSize="inherit" className="icon-sm" /><span><b>Synced.</b> Your server keeps every device up to date.</span></li>
            <li><AccountTreeRoundedIcon fontSize="inherit" className="icon-sm" /><span><b>Organised.</b> Threads, tags and saved filters.</span></li>
          </ul>
          <NotePreview />
        </div>
      </aside>
      <main className="auth-main">
        <AuthForm onDone={onDone} />
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session expired (shown over the app, keeps local data)

export function ReauthDialog({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const uid = useId()
  const username = useMemo(() => getLastUsername() || '', [])
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!password) { setError('Enter your password'); passwordRef.current?.focus(); return }
    setLoading(true)
    setError(null)
    try {
      await login(username, password)
      await runSync()
      onDone()
    } catch (err) {
      setError(describeAuthError(err, 'login').message)
      requestAnimationFrame(() => passwordRef.current?.select())
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <form className="relative w-full max-w-[380px] surface auth-dialog" onSubmit={onSubmit} noValidate>
        <header className="auth-heading">
          <h1 id={`${uid}-title`}>Session expired</h1>
          <p>Sign in again to continue syncing. Your notes on this device are safe.</p>
        </header>
        {/* Hidden username keeps password managers able to match the account. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <Field id={`${uid}-password`} label={username ? `Password for ${username}` : 'Password'} error={error ?? undefined}>
          <PasswordInput
            id={`${uid}-password`}
            inputRef={passwordRef}
            value={password}
            onChange={v => { setPassword(v); setError(null) }}
            autoComplete="current-password"
            autoFocus
            invalid={!!error}
            describedBy={error ? `${uid}-password-error` : undefined}
          />
        </Field>
        <SubmitButton loading={loading} label="Sign in" loadingLabel="Signing in…" />
        <p className="auth-switch">
          Not {username || 'you'}? <button type="button" className="link" onClick={onLogout} disabled={loading}>Log out</button>
        </p>
      </form>
    </div>
  )
}
