import { describe, expect, it } from 'vitest'
import { insertLink, isMarkActive, toggleMark, type TextEdit } from './markdown-wrap'

/** Runs a toggle on "[selected]" in the input and shows the result the same way. */
function apply(input: string, fn: (text: string, start: number, end: number) => TextEdit): string {
  const start = input.indexOf('[')
  const end = input.indexOf(']') - 1
  const text = input.replace('[', '').replace(']', '')
  const r = fn(text, start, end)
  return `${r.text.slice(0, r.start)}[${r.text.slice(r.start, r.end)}]${r.text.slice(r.end)}`
}
const t = (mark: Parameters<typeof toggleMark>[3]) => (text: string, s: number, e: number) => toggleMark(text, s, e, mark)

describe('toggleMark', () => {
  it('wraps the selection and keeps the words selected', () => {
    expect(apply('buy [milk] today', t('bold'))).toBe('buy **[milk]** today')
    expect(apply('buy [milk] today', t('italic'))).toBe('buy *[milk]* today')
    expect(apply('buy [milk] today', t('strike'))).toBe('buy ~~[milk]~~ today')
    expect(apply('run [npm ci]', t('code'))).toBe('run `[npm ci]`')
  })

  it('removes the mark when pressed again, with or without the markers selected', () => {
    expect(apply('buy **[milk]** today', t('bold'))).toBe('buy [milk] today')
    expect(apply('buy [**milk**] today', t('bold'))).toBe('buy [milk] today')
    expect(apply('buy ~~[milk]~~', t('strike'))).toBe('buy [milk]')
  })

  it('keeps spaces outside the markers', () => {
    expect(apply('buy[ milk ]today', t('bold'))).toBe('buy **[milk]** today')
  })

  it('tells bold and italic apart', () => {
    expect(apply('**[x]**', t('italic'))).toBe('***[x]***')
    expect(apply('***[x]***', t('italic'))).toBe('**[x]**')
    expect(apply('***[x]***', t('bold'))).toBe('*[x]*')
    expect(apply('*[x]*', t('bold'))).toBe('***[x]***')
    expect(isMarkActive('**x**', 2, 3, 'italic')).toBe(false)
    expect(isMarkActive('**x**', 2, 3, 'bold')).toBe(true)
    expect(isMarkActive('***x***', 3, 4, 'italic')).toBe(true)
  })

  it('formats each selected line, skipping blank ones', () => {
    expect(apply('[one\n\ntwo]', t('bold'))).toBe('**[one**\n\n**two]**')
    expect(apply('**[one**\n\n**two]**', t('bold'))).toBe('[one\n\ntwo]')
  })

  it('adds to the lines that miss the mark when only some have it', () => {
    expect(apply('**[one**\ntwo]', t('bold'))).toBe('**[one**\n**two]**')
  })

  it('leaves a whitespace-only selection alone', () => {
    expect(toggleMark('a   b', 1, 4, 'bold')).toEqual({ text: 'a   b', start: 1, end: 4 })
  })
})

describe('insertLink', () => {
  it('makes a link with the address selected for typing', () => {
    expect(apply('see [the docs] here', insertLink)).toBe('see [the docs]([https://]) here')
  })

  it('uses a selected address as the target and selects the label', () => {
    expect(apply('[https://focuz.app]', insertLink)).toBe('[[https://focuz.app]](https://focuz.app)')
  })
})
