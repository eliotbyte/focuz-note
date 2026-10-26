import { describe, expect, it } from 'vitest'
import { proseTail } from './note-tail'
import { renderNoteHtml } from './note-format/render'

function tail(markdown: string) {
  const div = document.createElement('div')
  div.innerHTML = renderNoteHtml(markdown)
  const { el, inline } = proseTail(div)
  return { tag: el === div ? 'TEXT' : el.tagName, text: el === div ? '' : el.textContent?.trim(), inline }
}

describe('proseTail', () => {
  it('joins the last line of a paragraph or a list', () => {
    expect(tail('Hello there')).toEqual({ tag: 'P', text: 'Hello there', inline: true })
    expect(tail('Plan\n\n- first\n- second')).toEqual({ tag: 'LI', text: 'second', inline: true })
    expect(tail('- a\n  - b\n  - c')).toEqual({ tag: 'LI', text: 'c', inline: true })
    expect(tail('- [ ] buy milk\n- [x] call mum')).toMatchObject({ tag: 'LI', inline: true })
    expect(tail('> quoted\n> line')).toMatchObject({ tag: 'P', inline: true })
    expect(tail('1. one\n\n2. two')).toMatchObject({ tag: 'P', text: 'two', inline: true })
  })
  it('keeps a line of its own after code or nothing', () => {
    expect(tail('Code\n\n```js\nx()\n```')).toEqual({ tag: 'TEXT', text: '', inline: false })
    expect(tail('- item\n\n  ```\n  code\n  ```')).toEqual({ tag: 'TEXT', text: '', inline: false })
    expect(tail('')).toEqual({ tag: 'TEXT', text: '', inline: false })
  })
})
