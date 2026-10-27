import { useEffect, useState } from 'react'

/** Notes the feed renders at first and adds per step: each card runs its own queries, so all of them at once freezes the page. */
export const FEED_PAGE = 40

// How many notes a feed had shown, by its key, so coming back (from a thread, say) restores the scroll position.
const shownByKey = new Map<string, number>()

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

/**
 * Shows the first part of a long list and more as the sentinel nears the bottom of the scroll area.
 * Returns how many to show and a callback ref for the sentinel element placed after the list (a state, so a new
 * element, after switching list and tiles, is observed again).
 */
export function useFeedWindow(total: number, key: string) {
  const [state, setState] = useState(() => ({ key, limit: shownByKey.get(key) ?? FEED_PAGE }))
  const limit = state.key === key ? state.limit : (shownByKey.get(key) ?? FEED_PAGE)
  if (state.key !== key) setState({ key, limit })

  const [sentinel, sentinelRef] = useState<HTMLElement | null>(null)
  const hasMore = total > limit
  useEffect(() => {
    const el = sentinel
    if (!el || !hasMore) return
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      const next = limit + FEED_PAGE
      shownByKey.set(key, next)
      setState({ key, limit: next })
    }, { root: scrollParent(el), rootMargin: '0px 0px 1500px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [sentinel, key, limit, hasMore])

  return { limit, hasMore, sentinelRef }
}
