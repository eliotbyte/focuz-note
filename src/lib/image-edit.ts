// Applies crop / rotation / flips to an image and encodes the result.
export interface PixelArea { x: number; y: number; width: number; height: number }
export interface ImageEdits {
  /** Crop in pixels of the rotated and flipped image (react-easy-crop's croppedAreaPixels). */
  area: PixelArea
  /** Degrees, multiples of 90. */
  rotation: number
  flipH: boolean
  flipV: boolean
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = src
  })
}

/** Size of the image's bounding box after rotation. */
export function rotatedSize(width: number, height: number, rotation: number) {
  const r = (rotation * Math.PI) / 180
  return {
    width: Math.abs(Math.cos(r) * width) + Math.abs(Math.sin(r) * height),
    height: Math.abs(Math.sin(r) * width) + Math.abs(Math.cos(r) * height),
  }
}

/** Output size: the crop, scaled down so the longer side is at most maxSide. */
export function outputSize(area: PixelArea, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(area.width, area.height))
  return { width: Math.max(1, Math.round(area.width * scale)), height: Math.max(1, Math.round(area.height * scale)) }
}

export async function renderEdits(
  img: HTMLImageElement,
  edits: ImageEdits,
  opts: { maxSide: number; type?: string; quality?: number },
): Promise<Blob> {
  const { rotation, flipH, flipV, area } = edits
  const box = rotatedSize(img.naturalWidth, img.naturalHeight, rotation)
  // 1) Draw the whole image rotated and flipped.
  const full = document.createElement('canvas')
  full.width = Math.round(box.width)
  full.height = Math.round(box.height)
  const fctx = full.getContext('2d')!
  fctx.translate(full.width / 2, full.height / 2)
  fctx.rotate((rotation * Math.PI) / 180)
  fctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  fctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  // 2) Copy the crop into the output, scaled to the size limit.
  const size = outputSize(area, opts.maxSide)
  const out = document.createElement('canvas')
  out.width = size.width
  out.height = size.height
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height)
  return new Promise((resolve, reject) => {
    out.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), opts.type ?? 'image/webp', opts.quality ?? 0.86)
  })
}
