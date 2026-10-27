import { describe, expect, it } from 'vitest'
import { describeStatus } from '../lib/sync-status'

const base = { online: true, serverReachable: true, syncError: null, authRequired: false, unsent: 0 }

describe('sync status indicator', () => {
  it('shows nothing while notes reach the server', () => {
    expect(describeStatus(base)).toBeNull()
    expect(describeStatus({ ...base, unsent: 3 })).toBeNull()
  })

  it('shows why notes cannot reach the server, and what waits on this device', () => {
    expect(describeStatus({ ...base, online: false, serverReachable: false })?.label).toBe('Offline')
    expect(describeStatus({ ...base, online: false, unsent: 2 })?.detail).toMatch(/^2 changes are kept on this device/)
    expect(describeStatus({ ...base, serverReachable: false, syncError: 'Server unreachable' })?.label).toBe('No connection')
    expect(describeStatus({ ...base, authRequired: true, serverReachable: false })?.label).toBe('Signed out')
    expect(describeStatus({ ...base, syncError: 'Server error (500)' })).toMatchObject({ label: 'Not syncing', tone: 'warn', canRetry: true })
    expect(describeStatus({ ...base, online: false })?.canRetry).toBe(false)
  })
})
