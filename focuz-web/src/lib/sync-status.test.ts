import { describe, expect, it } from 'vitest'
import { describeStatus } from '../lib/sync-status'

const base = { online: true, syncing: false, serverReachable: true, syncError: null, authRequired: false, lastSyncAt: '2030-01-01T00:00:00Z', pendingChanges: 0, uploads: 0, failed: 0 }

describe('sync status indicator', () => {
  it('says synced only after a successful sync with nothing pending', () => {
    expect(describeStatus(base).label).toBe('Synced')
    expect(describeStatus({ ...base, lastSyncAt: null }).label).toBe('Connecting')
    expect(describeStatus({ ...base, pendingChanges: 2, uploads: 1 }).label).toBe('3 pending')
  })

  it('prioritises the reason the user cannot sync', () => {
    expect(describeStatus({ ...base, online: false, serverReachable: false }).label).toBe('Offline')
    expect(describeStatus({ ...base, serverReachable: false, syncError: 'Server unreachable', syncing: true }).label).toBe('Server unreachable')
    expect(describeStatus({ ...base, authRequired: true, serverReachable: false }).label).toBe('Sign in')
    expect(describeStatus({ ...base, syncError: 'Server error (500)' }).tone).toBe('error')
    expect(describeStatus({ ...base, failed: 1 }).label).toBe('1 failed')
  })
})
