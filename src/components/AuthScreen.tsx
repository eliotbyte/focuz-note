import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ensureDefaultSpace, getLastUsername, login, register, resendVerification, runSync, verifyEmail } from '../lib/sync'
import { cachedServerConfig, customServerAllowed, DEFAULT_SERVER_CONFIG, defaultServer, getServer, isCustomServer, normalizeServerUrl, probeServer, rememberServerConfig, serverLabel, setServer, type ServerConfig } from '../lib/server'
import { describeAuthError, looksLikeEmail, passwordChecks, validateAuthForm, type AuthField, type AuthMode, type LoginKind } from '../lib/auth-form'
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
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded'

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
  const [server, setServerState] = useState<string | undefined>(() => getServer())
  const [config, setConfig] = useState<ServerConfig>(() => cachedServerConfig() ?? DEFAULT_SERVER_CONFIG)
  const [configError, setConfigError] = useState<string | null>(null)
  const canChooseServer = customServerAllowed()
  const [step, setStep] = useState<'form' | 'verify' | 'server'>(() => (getServer() || !canChooseServer ? 'form' : 'server'))
  const [verifyEmailAddr, setVerifyEmailAddr] = useState('')

  // Read how accounts work on the selected server (username or e-mail, registration open).
  useEffect(() => {
    if (!server) return
    let cancelled = false
    setConfigError(null)
    probeServer(server).then(r => {
      if (cancelled) return
      if (r.ok) { setConfig(r.config); rememberServerConfig(r.config) }
      else setConfigError(r.message)
    })
    return () => { cancelled = true }
  }, [server])

  if (!server && !canChooseServer) {
    return (
      <div className="auth-form-wrap">
        <header className="auth-heading">
          <h1>No server configured</h1>
          <p>This copy of focuz was built without a server address. Ask whoever hosts it to set VITE_API_BASE_URL.</p>
        </header>
      </div>
    )
  }
  if (step === 'server' && canChooseServer) {
    return (
      <ServerPanel
        current={server}
        onCancel={server ? () => setStep('form') : undefined}
        onSelected={(url, cfg) => { setServer(url); setServerState(getServer()); setConfig(cfg); rememberServerConfig(cfg); setStep('form') }}
      />
    )
  }
  if (step === 'verify') {
    return (
      <VerifyEmailStep
        email={verifyEmailAddr}
        onBack={() => setStep('form')}
        onDone={onDone}
      />
    )
  }
  return (
    <CredentialsForm
      key={server + config.mode}
      config={config}
      server={server}
      serverError={configError}
      onChangeServer={canChooseServer ? () => setStep('server') : undefined}
      onNeedsVerification={(email) => { setVerifyEmailAddr(email); setStep('verify') }}
      onDone={onDone}
    />
  )
}

function CredentialsForm({
  config, server, serverError: serverProbeError, onChangeServer, onNeedsVerification, onDone,
}: {
  config: ServerConfig
  server: string | undefined
  serverError: string | null
  onChangeServer?: () => void
  onNeedsVerification: (email: string) => void
  onDone: () => void
}) {
  const uid = useId()
  const kind: LoginKind = config.mode
  const registrationOpen = config.registration === 'open'
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
  const refs: Record<'username' | 'password' | 'confirm', React.RefObject<HTMLInputElement | null>> = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  }
  const focusField = (f: AuthField) => {
    const r = f === 'code' ? null : refs[f].current
    r?.focus()
    r?.select()
  }

  const errors = validateAuthForm(mode, { username, password, confirm }, kind)
  // Show a field's error after the user left it with something typed, or tried to submit; never
  // while typing, and never just for tabbing/clicking past an empty field (that shifted the layout
  // under the pointer and swallowed clicks).
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
    const firstInvalid = (['username', 'password', 'confirm'] as const).find(f => errors[f])
    if (firstInvalid) { refs[firstInvalid].current?.focus(); return }
    setLoading(true)
    const name = username.trim().toLowerCase()
    // On e-mail servers people may still sign in with an old username.
    const field = kind === 'email' && (mode === 'register' || looksLikeEmail(name)) ? 'email' : 'username'
    try {
      if (mode === 'register') {
        const r = await register(name, password, field)
        if (r.verificationRequired) { onNeedsVerification(r.email || name); return }
      }
      await login(name, password, field)
      await ensureDefaultSpace()
      await runSync()
      onDone()
    } catch (err) {
      if ((err as any)?.body?.error?.code === 'EMAIL_NOT_VERIFIED') {
        const email = (err as any)?.body?.error?.details?.email || name
        void resendVerification(email).catch(() => {})
        onNeedsVerification(email)
        return
      }
      if ((err as any)?.body?.error?.code === 'EMAIL_SEND_FAILED') {
        onNeedsVerification(name)
        return
      }
      const d = describeAuthError(err, mode, kind)
      setServerError(d)
      if (d.field) requestAnimationFrame(() => focusField(d.field!))
    } finally {
      setLoading(false)
    }
  }

  const ids = { username: `${uid}-username`, password: `${uid}-password`, confirm: `${uid}-confirm`, checklist: `${uid}-rules` }
  const formLevelError = serverError && !serverError.field ? serverError.message : null
  const isRegister = mode === 'register' && registrationOpen
  const loginLabel = kind === 'email' ? 'Email' : 'Username'

  return (
    <div className="auth-form-wrap">
      {registrationOpen ? (
        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={!isRegister} className="auth-tab" onClick={() => switchMode('login')}>Sign in</button>
          <button type="button" role="tab" aria-selected={isRegister} className="auth-tab" onClick={() => switchMode('register')}>Create account</button>
          <span className="auth-tab-thumb" data-pos={isRegister ? 'right' : 'left'} aria-hidden />
        </div>
      ) : null}

      <header className="auth-heading">
        <h1>{isRegister ? 'Create your account' : (lastUsername ? 'Welcome back' : 'Sign in to focuz')}</h1>
        <p>{isRegister
          ? (kind === 'email' ? 'We will send a code to confirm your email address.' : 'Your notes are stored on this device and synced to your server.')
          : 'Your notes stay on this device and sync when the server is reachable.'}</p>
      </header>

      {!online && (
        <div className="auth-banner" role="status">
          <WifiOffRoundedIcon fontSize="inherit" className="icon-sm" />
          You are offline. Connect to the internet to sign in.
        </div>
      )}
      {online && serverProbeError && (
        <div className="auth-banner is-error" role="status">
          <ErrorOutlineRoundedIcon fontSize="inherit" className="icon-sm" />
          <span>{serverProbeError}{onChangeServer ? <> <button type="button" className="link" onClick={onChangeServer}>Change server</button></> : null}</span>
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit} noValidate aria-describedby={formLevelError ? `${uid}-form-error` : undefined}>
        <Field
          id={ids.username}
          label={loginLabel}
          error={fieldError('username')}
          hint={isRegister ? (kind === 'email' ? undefined : '3 to 50 characters, not case-sensitive') : undefined}
        >
          <input
            id={ids.username}
            ref={refs.username}
            className="input auth-input"
            name={kind === 'email' ? 'email' : 'username'}
            type={kind === 'email' && isRegister ? 'email' : 'text'}
            inputMode={kind === 'email' ? 'email' : undefined}
            value={username}
            onChange={e => { setUsername(e.target.value); if (serverError?.field === 'username') setServerError(null) }}
            onBlur={() => { if (username) setTouched(t => ({ ...t, username: true })) }}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!lastUsername}
            aria-invalid={!!fieldError('username') || undefined}
            aria-describedby={fieldError('username') ? `${ids.username}-error` : (isRegister && kind !== 'email') ? `${ids.username}-hint` : undefined}
            required
          />
        </Field>

        <Field id={ids.password} label="Password" error={fieldError('password')}>
          <PasswordInput
            id={ids.password}
            inputRef={refs.password}
            value={password}
            onChange={v => { setPassword(v); if (serverError?.field === 'password') setServerError(null) }}
            onBlur={() => { if (password) setTouched(t => ({ ...t, password: true })) }}
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
              onBlur={() => { if (confirm) setTouched(t => ({ ...t, confirm: true })) }}
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

      {registrationOpen ? (
        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : 'New to focuz?'}{' '}
          <button type="button" className="link" onClick={() => switchMode(isRegister ? 'login' : 'register')}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      ) : (
        <p className="auth-switch">New accounts on this server are created by its owner.</p>
      )}
      <ServerNote server={server} onChange={onChangeServer} />
    </div>
  )
}

/** Self-hosted app: which server the account lives on, and a way to pick another. */
function ServerNote({ server, onChange }: { server: string | undefined; onChange?: () => void }) {
  return (
    <p className="auth-server">
      Server <span className="mono">{serverLabel(server) || 'not selected'}</span>
      {onChange ? <>{' · '}<button type="button" className="link" onClick={onChange}>Change</button></> : null}
    </p>
  )
}

function ServerPanel({ current, onSelected, onCancel }: {
  current: string | undefined
  onSelected: (url: string, config: ServerConfig) => void
  onCancel?: () => void
}) {
  const uid = useId()
  const [value, setValue] = useState(() => (isCustomServer() ? current : '') || '')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fallback = defaultServer()

  async function connect(raw: string) {
    const url = normalizeServerUrl(raw)
    if (!url) { setError('Enter a web address, like notes.example.com'); inputRef.current?.focus(); return }
    setChecking(true)
    setError(null)
    const r = await probeServer(url)
    setChecking(false)
    if (!r.ok) { setError(r.message); inputRef.current?.focus(); return }
    onSelected(url, r.config)
  }

  return (
    <div className="auth-form-wrap">
      <header className="auth-heading">
        <h1>Choose your server</h1>
        <p>focuz keeps your notes on a server you or someone you trust runs. Enter its address.</p>
      </header>
      <form className="auth-form" noValidate onSubmit={e => { e.preventDefault(); void connect(value) }}>
        <Field id={`${uid}-url`} label="Server address" error={error ?? undefined} hint="For example notes.example.com or http://192.168.1.10:8080">
          <input
            id={`${uid}-url`}
            ref={inputRef}
            className="input auth-input"
            type="url"
            inputMode="url"
            name="server"
            placeholder="notes.example.com"
            value={value}
            onChange={e => { setValue(e.target.value); setError(null) }}
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${uid}-url-error` : `${uid}-url-hint`}
          />
        </Field>
        <SubmitButton loading={checking} label="Connect" loadingLabel="Checking server…" />
      </form>
      <div className="auth-server-actions">
        {fallback && isCustomServer() && (
          <button type="button" className="link" onClick={() => void connect(fallback)}>Use {serverLabel(fallback)}</button>
        )}
        {onCancel && <button type="button" className="link" onClick={onCancel}>Back</button>}
      </div>
    </div>
  )
}

const RESEND_WAIT_S = 60

function VerifyEmailStep({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const uid = useId()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + RESEND_WAIT_S * 1000)
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedFor = useRef<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000))

  async function submit(value: string) {
    if (loading) return
    if (value.length !== 6) { setError('Enter the 6-digit code from the email'); inputRef.current?.focus(); return }
    submittedFor.current = value
    setLoading(true)
    setError(null)
    try {
      await verifyEmail(email, value)
      await ensureDefaultSpace()
      await runSync()
      onDone()
    } catch (err) {
      setError(describeAuthError(err, 'login').message)
      requestAnimationFrame(() => inputRef.current?.select())
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    setNotice(null)
    setError(null)
    try {
      const r = await resendVerification(email)
      setWaitUntil(Date.now() + r.retryAfterSeconds * 1000)
      setNotice('A new code is on its way. Codes from earlier emails no longer work.')
      setCode('')
      inputRef.current?.focus()
    } catch (err) {
      setError(describeAuthError(err, 'login').message)
    }
  }

  return (
    <div className="auth-form-wrap">
      <header className="auth-heading">
        <div className="auth-mail-icon" aria-hidden><MarkEmailUnreadRoundedIcon fontSize="inherit" /></div>
        <h1>Check your email</h1>
        <p>We sent a 6-digit code to <b className="auth-email">{email}</b>. Enter it below, or open the link in the email.</p>
      </header>
      <form className="auth-form" noValidate onSubmit={e => { e.preventDefault(); void submit(code) }}>
        <Field id={`${uid}-code`} label="Confirmation code" error={error ?? undefined}>
          <input
            id={`${uid}-code`}
            ref={inputRef}
            className="input auth-input auth-code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(digits)
              setError(null)
              // Submit as soon as a full code is typed or pasted.
              if (digits.length === 6 && submittedFor.current !== digits) void submit(digits)
            }}
            autoFocus
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${uid}-code-error` : undefined}
          />
        </Field>
        {notice && <div className="auth-banner is-info" role="status">{notice}</div>}
        <SubmitButton loading={loading} label="Confirm email" loadingLabel="Confirming…" />
      </form>
      <p className="auth-switch">
        {wait > 0
          ? <>Did not get it? You can send a new code in {wait}s.</>
          : <>Did not get it? Check spam, or <button type="button" className="link" onClick={() => void resend()}>send a new code</button>.</>}
      </p>
      <p className="auth-switch"><button type="button" className="link" onClick={onBack}>Use a different account</button></p>
    </div>
  )
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
