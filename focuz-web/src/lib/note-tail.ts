// Where a note card's footer can join the note text (see .note-body.is-foot-inline in index.css).

const BLOCK_IN_ITEM = /^(P|UL|OL|BLOCKQUOTE|PRE|TABLE|DIV|HR)$/

/**
 * The last line of rendered note text, where the footer can join it: a paragraph or a heading, or the
 * last item of a list (nested lists and quotes followed down). Code, tables and the like end in a box
 * the footer can't sit in: then it is the text block itself, and the footer keeps a line below.
 */
export function proseTail(prose: Element): { el: Element; inline: boolean } {
  let el = prose.lastElementChild
  for (let depth = 0; el && depth < 20; depth++) {
    const tag = el.tagName
    if (/^(P|H[1-6])$/.test(tag)) return { el, inline: true }
    if (tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE') { el = el.lastElementChild; continue }
    if (tag === 'LI') {
      const last = el.lastElementChild
      if (last && BLOCK_IN_ITEM.test(last.tagName)) { el = last; continue }
      return { el, inline: true }
    }
    break
  }
  return { el: prose, inline: false }
}
