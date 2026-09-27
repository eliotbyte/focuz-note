// Validation and error wording for the sign-in / sign-up form.
import { isNetworkError } from './api'

export type AuthMode = 'login' | 'register'
export type AuthField = 'username' | 'password' | 'confirm' | 'code'
/** How accounts are identified on the selected server. */
export type LoginKind = 'username' | 'email'

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

export interface PasswordCheck { id: string; label: string; ok: boolean }

export function passwordChecks(p: string): PasswordCheck[] {
  return [
    { id: 'len', label: 'At least 8 characters', ok: p.length >= 8 },
    { id: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(p) },
    { id: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(p) },
    { id: 'digit', label: 'A number', ok: /[0-9]/.test(p) },
    { id: 'space', label: 'No spaces', ok: p.length > 0 && !/\s/.test(p) },
  ]
}

export function validateAuthForm(mode: AuthMode, v: { username: string; password: string; confirm: string }, kind: LoginKind = 'username'): Partial<Record<AuthField, string>> {
  const errors: Partial<Record<AuthField, string>> = {}
  const name = v.username.trim()
  if (kind === 'email') {
    if (!name) errors.username = 'Enter your email'
    // Existing username accounts can still sign in on an e-mail server.
    else if (mode === 'register' && !looksLikeEmail(name)) errors.username = 'Enter a valid email address, like name@example.com'
  } else {
    if (!name) errors.username = 'Enter your username'
    else if (name.length < 3 || name.length > 50) errors.username = 'Username must be 3 to 50 characters'
    else if (mode === 'register' && /\s/.test(name)) errors.username = 'Username cannot contain spaces'
  }
  if (!v.password) errors.password = 'Enter your password'
  else if (mode === 'register' && passwordChecks(v.password).some(c => !c.ok)) errors.password = 'Password does not meet the requirements'
  if (mode === 'register' && !errors.password) {
    if (!v.confirm) errors.confirm = 'Repeat the password'
    else if (v.confirm !== v.password) errors.confirm = 'Passwords do not match'
  }
  return errors
}

/** Turns an API failure into a message and, when it is about one field, which field. */
export function describeAuthError(e: unknown, mode: AuthMode, kind: LoginKind = 'username'): { message: string; field?: AuthField } {
  if (isNetworkError(e)) return { message: 'Cannot reach the server. Check your connection and try again.' }
  const status = (e as any)?.status
  const code = String((e as any)?.body?.error?.code || '')
  switch (code) {
    case 'EMAIL_NOT_VERIFIED': return { message: 'Confirm your email address first.' }
    case 'EMAIL_SEND_FAILED': return { message: 'Your account was created, but the confirmation email could not be sent. Try sending a new code in a minute.' }
    case 'INVALID_CODE': return { message: 'That code is not correct. Check the latest email from focuz.', field: 'code' }
    case 'CODE_EXPIRED': return { message: 'This code has expired. Send a new one.', field: 'code' }
    case 'TOO_MANY_ATTEMPTS': return { message: 'Too many wrong codes. Send a new one.', field: 'code' }
    case 'ALREADY_VERIFIED': return { message: 'This email is already confirmed. Sign in with your password.' }
  }
  if (status === 403 && mode === 'register') return { message: 'Registration is closed on this server. Ask its owner for an account.' }
  if (status === 401) return { message: kind === 'email' ? 'Wrong email or password.' : 'Wrong username or password.', field: 'password' }
  if (status === 409) return { message: /email/i.test(String((e as any)?.body?.error?.message || '')) ? 'An account with this email already exists. Sign in instead.' : 'This username is already taken.', field: 'username' }
  if (status === 429) return { message: 'Too many attempts. Wait a minute and try again.' }
  if (status === 400) {
    const msg = String((e as any)?.body?.error?.message || '')
    if (/username/i.test(msg)) return { message: msg, field: 'username' }
    if (/password/i.test(msg)) return { message: msg, field: 'password' }
    if (msg) return { message: msg }
  }
  if (typeof status === 'number' && status >= 500) return { message: 'The server had a problem. Try again in a moment.' }
  return { message: mode === 'register' ? 'Could not create the account. Try again.' : 'Could not sign in. Try again.' }
}
