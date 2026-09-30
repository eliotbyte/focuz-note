// How a feed is laid out: the usual list of cards, or a grid of same-size tiles.
// A folder keeps its layout in params next to its rule and look, so it syncs like they do; a view
// that is not a folder (All notes, Unsorted) keeps it on this device.

export type FeedLayoutMode = 'list' | 'grid'
export interface FeedLayout { mode: FeedLayoutMode; cols: number }

export const DEFAULT_LAYOUT: FeedLayout = { mode: 'list', cols: 3 }

/** Tiles never get narrower than this; the width of the feed decides how many fit in a row. */
export const MIN_TILE_WIDTH = 96
export const TILE_GAP = 10
export const MIN_COLS = 2
export const MAX_COLS = 8

function cleanCols(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(v))) : undefined
}

export function layoutFromValue(v: unknown): FeedLayout {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    mode: o.mode === 'grid' ? 'grid' : 'list',
    cols: cleanCols(o.cols) ?? DEFAULT_LAYOUT.cols,
  }
}

export function layoutFromParams(params: unknown): FeedLayout {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  return layoutFromValue(p.layout)
}

/** Params with the layout written in; the default layout removes the key. */
export function paramsWithLayout<P extends object>(params: P | null | undefined, layout: FeedLayout): P {
  const out = { ...(params || {}) } as Record<string, unknown>
  if (layout.mode === DEFAULT_LAYOUT.mode && layout.cols === DEFAULT_LAYOUT.cols) delete out.layout
  else out.layout = { mode: layout.mode, cols: cleanCols(layout.cols) ?? DEFAULT_LAYOUT.cols }
  return out as P
}

/** Tiles per row that fit a feed this wide, fewest first. A phone gets a couple of steps, a wide screen more. */
export function colsOptions(width: number): number[] {
  const fit = Math.floor((width + TILE_GAP) / (MIN_TILE_WIDTH + TILE_GAP))
  const max = Math.min(MAX_COLS, Math.max(MIN_COLS, fit))
  const out: number[] = []
  for (let c = MIN_COLS; c <= max; c++) out.push(c)
  return out
}

/** The saved number of tiles per row, brought within what this screen can hold. */
export function fitCols(cols: number, width: number): number {
  const opts = colsOptions(width)
  return Math.min(Math.max(cols, opts[0]), opts[opts.length - 1])
}
