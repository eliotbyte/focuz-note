// The crop frame of the picture editor: pure geometry in the picture's pixels (as shown, after rotation).
import type { PixelArea } from './image-edit'

/** A corner or a side of the frame. */
export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** The whole picture, or the biggest centred frame of the given shape (width / height). */
export function centeredCrop(W: number, H: number, aspect: number | null): PixelArea {
  if (aspect == null) return { x: 0, y: 0, width: W, height: H }
  const width = Math.min(W, H * aspect)
  const height = width / aspect
  return { x: (W - width) / 2, y: (H - height) / 2, width, height }
}

/** The frame moved by (dx, dy), kept inside the picture. */
export function moveCrop(c: PixelArea, dx: number, dy: number, W: number, H: number): PixelArea {
  return { ...c, x: clamp(c.x + dx, 0, W - c.width), y: clamp(c.y + dy, 0, H - c.height) }
}

/**
 * The frame after dragging one handle by (dx, dy). Without a shape each side moves on its own; with a
 * shape only corners are dragged, the opposite corner stays put and the frame keeps its shape.
 */
export function resizeCrop(
  c: PixelArea, handle: CropHandle, dx: number, dy: number, W: number, H: number, aspect: number | null, minSide: number,
): PixelArea {
  let l = c.x, t = c.y, r = c.x + c.width, b = c.y + c.height
  if (aspect == null) {
    if (handle.includes('w')) l = clamp(l + dx, 0, r - minSide)
    if (handle.includes('e')) r = clamp(r + dx, l + minSide, W)
    if (handle.includes('n')) t = clamp(t + dy, 0, b - minSide)
    if (handle.includes('s')) b = clamp(b + dy, t + minSide, H)
    return { x: l, y: t, width: r - l, height: b - t }
  }
  const sx = handle.includes('e') ? 1 : -1
  const sy = handle.includes('s') ? 1 : -1
  const ax = sx > 0 ? l : r
  const ay = sy > 0 ? t : b
  // Follow whichever way the pointer pulls harder.
  const wFromX = ((sx > 0 ? r : l) + dx - ax) * sx
  const wFromY = ((sy > 0 ? b : t) + dy - ay) * sy * aspect
  const maxW = Math.min(sx > 0 ? W - ax : ax, (sy > 0 ? H - ay : ay) * aspect)
  const minW = Math.min(maxW, Math.max(minSide, minSide * aspect))
  const width = clamp(Math.max(wFromX, wFromY), minW, maxW)
  const height = width / aspect
  return { x: sx > 0 ? ax : ax - width, y: sy > 0 ? ay : ay - height, width, height }
}

/** The frame on the picture turned a quarter to the left (W: the width before turning). */
export function rotateCropLeft(c: PixelArea, W: number): PixelArea {
  return { x: c.y, y: W - c.x - c.width, width: c.height, height: c.width }
}

export function flipCropH(c: PixelArea, W: number): PixelArea {
  return { ...c, x: W - c.x - c.width }
}

export function flipCropV(c: PixelArea, H: number): PixelArea {
  return { ...c, y: H - c.y - c.height }
}
