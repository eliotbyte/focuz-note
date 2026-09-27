import { describe, expect, it } from 'vitest'
import { describeAuthError, passwordChecks, validateAuthForm } from './auth-form'
import { ApiError, NetworkError } from './api'

describe('auth form', () => {
  it('only asks for non-empty fields when signing in', () => {
    expect(validateAuthForm('login', { username: 'bob', password: 'x', confirm: '' })).toEqual({})
    expect(validateAuthForm('login', { username: '', password: '', confirm: '' })).toEqual({ username: 'Enter your username', password: 'Enter your password' })
  })

  it('checks password rules and confirmation when registering', () => {
    expect(passwordChecks('Password1').every(c => c.ok)).toBe(true)
    expect(passwordChecks('password').filter(c => !c.ok).map(c => c.id)).toEqual(['upper', 'digit'])
    expect(validateAuthForm('register', { username: 'bob', password: 'weak', confirm: 'weak' }).password).toBeTruthy()
    expect(validateAuthForm('register', { username: 'bob', password: 'Password1', confirm: 'Password2' })).toEqual({ confirm: 'Passwords do not match' })
    expect(validateAuthForm('register', { username: 'b b', password: 'Password1', confirm: 'Password1' }).username).toBeTruthy()
  })

  it('asks for an email address on e-mail servers', () => {
    expect(validateAuthForm('register', { username: 'bob', password: 'Password1', confirm: 'Password1' }, 'email').username).toMatch(/valid email/)
    expect(validateAuthForm('register', { username: 'bob@example.org', password: 'Password1', confirm: 'Password1' }, 'email')).toEqual({})
    // Old username accounts still sign in on an e-mail server.
    expect(validateAuthForm('login', { username: 'bob', password: 'x', confirm: '' }, 'email')).toEqual({})
  })

  it('explains e-mail confirmation errors', () => {
    const err = (code: string, status = 400) => new ApiError(status, code, { success: false, error: { code, message: '' } })
    expect(describeAuthError(err('INVALID_CODE'), 'login').field).toBe('code')
    expect(describeAuthError(err('CODE_EXPIRED', 410), 'login').message).toMatch(/expired/)
    expect(describeAuthError(err('EMAIL_NOT_VERIFIED', 403), 'login').message).toMatch(/Confirm your email/)
    expect(describeAuthError(new ApiError(403, '403', {}), 'register').message).toMatch(/Registration is closed/)
  })

  it('explains server errors in user terms', () => {
    expect(describeAuthError(new ApiError(401, '401'), 'login')).toEqual({ message: 'Wrong username or password.', field: 'password' })
    expect(describeAuthError(new ApiError(401, '401'), 'login', 'email').message).toBe('Wrong email or password.')
    expect(describeAuthError(new ApiError(409, '409'), 'register').field).toBe('username')
    expect(describeAuthError(new ApiError(429, '429'), 'login').message).toMatch(/Too many attempts/)
    expect(describeAuthError(new NetworkError('Failed to fetch'), 'login').message).toMatch(/Cannot reach the server/)
  })
})
