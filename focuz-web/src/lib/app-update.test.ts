import { describe, expect, it } from 'vitest'
import { canReloadSilently, FRESH_MS, hasUnsavedInput } from './app-update'

describe('canReloadSilently', () => {
  it('reloads right after the app is opened or comes back to the screen', () => {
    expect(canReloadSilently({ hidden: false, sinceShownMs: 1000, unsavedInput: false })).toBe(true)
  })

  it('asks when the app has been on the screen for a while', () => {
    expect(canReloadSilently({ hidden: false, sinceShownMs: FRESH_MS + 1, unsavedInput: false })).toBe(false)
  })

  it('reloads in the background, however long the app was open', () => {
    expect(canReloadSilently({ hidden: true, sinceShownMs: 10 * FRESH_MS, unsavedInput: false })).toBe(true)
  })

  it('never drops typed text', () => {
    expect(canReloadSilently({ hidden: false, sinceShownMs: 0, unsavedInput: true })).toBe(false)
    expect(canReloadSilently({ hidden: true, sinceShownMs: 0, unsavedInput: true })).toBe(false)
  })
})

describe('hasUnsavedInput', () => {
  function root(html: string) {
    const div = document.createElement('div')
    div.innerHTML = html
    return div
  }

  it('is false for empty fields, buttons and checkboxes', () => {
    const r = root('<textarea></textarea><input value="  "><input type="checkbox" value="on"><input type="hidden" value="x"><button>Send</button>')
    expect(hasUnsavedInput(r)).toBe(false)
  })

  it('sees text in a textarea', () => {
    const r = root('<textarea></textarea>')
    r.querySelector('textarea')!.value = 'half a note'
    expect(hasUnsavedInput(r)).toBe(true)
  })

  it('sees text in text inputs, including ones without a type', () => {
    expect(hasUnsavedInput(root('<input value="tag">'))).toBe(true)
    expect(hasUnsavedInput(root('<input type="search" value="dune">'))).toBe(true)
  })

  it('sees text in an editable element', () => {
    const r = root('<div contenteditable="true">draft</div>')
    // jsdom does not implement isContentEditable
    Object.defineProperty(r.firstElementChild!, 'isContentEditable', { value: true })
    expect(hasUnsavedInput(r)).toBe(true)
  })
})
