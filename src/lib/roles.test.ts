import { describe, expect, it } from 'vitest'
import { assignableRoles, canDeleteNote, canManage, canRemoveMember, canWrite } from './roles'

describe('roles', () => {
  it('guests read, editors write, admins manage', () => {
    expect(canWrite('guest')).toBe(false)
    expect(canWrite('editor')).toBe(true)
    expect(canManage('editor')).toBe(false)
    expect(canManage('admin')).toBe(true)
  })

  it('editors delete only their own notes; unsynced notes are ours', () => {
    expect(canDeleteNote('editor', 7, 7)).toBe(true)
    expect(canDeleteNote('editor', 8, 7)).toBe(false)
    expect(canDeleteNote('editor', null, 7)).toBe(true)
    expect(canDeleteNote('admin', 8, 7)).toBe(true)
    expect(canDeleteNote('guest', 7, 7)).toBe(false)
  })

  it('only the owner hands out admin; nobody touches the owner', () => {
    expect(assignableRoles('owner', 'editor')).toEqual(['admin', 'editor', 'guest'])
    expect(assignableRoles('admin', 'editor')).toEqual(['editor', 'guest'])
    expect(assignableRoles('admin', 'admin')).toEqual([])
    expect(assignableRoles('owner', 'owner')).toEqual([])
    expect(assignableRoles('admin', null)).toEqual(['editor', 'guest'])
    expect(canRemoveMember('admin', 'guest')).toBe(true)
    expect(canRemoveMember('admin', 'admin')).toBe(false)
    expect(canRemoveMember('owner', 'admin')).toBe(true)
    expect(canRemoveMember('owner', 'owner')).toBe(false)
  })
})
