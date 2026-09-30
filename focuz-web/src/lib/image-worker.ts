// Resizes and re-encodes a picture off the main thread, so attaching photos doesn't freeze the page.

export interface ImageWorkerRequest { id: number; file: Blob; maxSide: number; quality: number }
export type ImageWorkerResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ImageWorkerRequest>) => void) | null
  postMessage: (msg: ImageWorkerResponse) => void
}

scope.onmessage = async (e) => {
  const { id, file, maxSide, quality } = e.data
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = bitmap
    const scale = Math.min(1, maxSide / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2d context')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    scope.postMessage({ id, ok: true, blob, width, height })
  } catch (err) {
    scope.postMessage({ id, ok: false, error: String((err as Error)?.message || err) })
  }
}
