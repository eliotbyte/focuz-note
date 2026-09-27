import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, serverLabel } from './server'

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
