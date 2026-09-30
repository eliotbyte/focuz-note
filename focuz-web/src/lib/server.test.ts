import { afterEach, describe, expect, it, vi } from 'vitest'
import { customServerAllowed, getServer, normalizeServerUrl, serverLabel, setServer } from './server'

describe('server address', () => {
  it('accepts what people type', () => {
    expect(normalizeServerUrl('notes.example.com')).toBe('https://notes.example.com')
    expect(normalizeServerUrl(' https://notes.example.com/api/ ')).toBe('https://notes.example.com/api')
    expect(normalizeServerUrl('localhost:8080')).toBe('http://localhost:8080')
    expect(normalizeServerUrl('192.168.1.20:8080')).toBe('http://192.168.1.20:8080')
    expect(normalizeServerUrl('http://nas.local:8080/?x=1#y')).toBe('http://nas.local:8080')
  })
  it('rejects things that are not web addresses', () => {
    expect(normalizeServerUrl('')).toBeNull()
    expect(normalizeServerUrl('ftp://example.com')).toBeNull()
    expect(normalizeServerUrl('javascript:alert(1)')).toBeNull()
  })
  it('shows a short label', () => {
    expect(serverLabel('https://notes.example.com/api')).toBe('notes.example.com/api')
    expect(serverLabel('http://localhost:8080')).toBe('localhost:8080')
  })
})

describe('server choice switch', () => {
  afterEach(() => { vi.unstubAllEnvs(); localStorage.clear() })

  it('uses the chosen server when custom servers are allowed (default)', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://own.example.org')
    setServer('https://other.example.org')
    expect(customServerAllowed()).toBe(true)
    expect(getServer()).toBe('https://other.example.org')
  })

  it('ignores any stored server when the switch is off', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://own.example.org')
    setServer('https://other.example.org')
    vi.stubEnv('VITE_ALLOW_CUSTOM_SERVER', 'false')
    expect(customServerAllowed()).toBe(false)
    expect(getServer()).toBe('https://own.example.org')
  })
})
