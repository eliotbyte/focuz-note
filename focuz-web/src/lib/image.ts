import imageCompression, { type Options } from 'browser-image-compression'
import type { ImageWorkerRequest, ImageWorkerResponse } from './image-worker'

export interface CompressedImageResult {
  blob: Blob
  fileName: string
  fileType: string
  fileSize: number
}

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export function isSupportedImage(file: File): boolean {
  if (file.type && ACCEPTED_TYPES.has(file.type)) return true
  // fallback: allow generic image/*
  return file.type.startsWith('image/')
}

const MAX_SIDE = 2048
// Fixed quality for all images, so the same picture always looks the same.
const QUALITY = 0.65

export async function compressToWebP(file: File): Promise<CompressedImageResult> {
  if (!isSupportedImage(file)) throw new Error('Unsupported image type')
  let blob = await compressInWorker(file).catch(() => null)
  // Browsers that cannot encode WebP from a canvas (or decode this format) go through the library.
  if (!blob || blob.type !== 'image/webp') {
    const options: Options = {
      maxWidthOrHeight: MAX_SIDE,
      initialQuality: QUALITY,
      fileType: 'image/webp',
      alwaysKeepResolution: false,
      useWebWorker: true,
    }
    blob = await imageCompression(file, options)
  }
  return {
    blob,
    fileName: toWebPName(file.name),
    fileType: 'image/webp',
    fileSize: blob.size,
  }
}

let worker: Worker | null | undefined
let nextRequestId = 1
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function imageWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null
    const w = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<ImageWorkerResponse>) => {
      const req = pending.get(e.data.id)
      if (!req) return
      pending.delete(e.data.id)
      if (e.data.ok) req.resolve(e.data.blob)
      else req.reject(new Error(e.data.error))
    }
    w.onerror = () => {
      for (const req of pending.values()) req.reject(new Error('Image worker failed'))
      pending.clear()
      worker = null
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

function compressInWorker(file: File): Promise<Blob> {
  const w = imageWorker()
  if (!w) return Promise.reject(new Error('No image worker'))
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, file, maxSide: MAX_SIDE, quality: QUALITY } satisfies ImageWorkerRequest)
  })
}

function toWebPName(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return `${name}.webp`
  return `${name.slice(0, idx)}.webp`
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  // createImageBitmap decodes off the main thread; reading the file as a data URL did not.
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const out = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return out
    } catch {}
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Failed to read image'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Criteria for note pictures, agreed in the to-do list: not too small, not too narrow or too tall,
// not absurdly long. 16:9 (1.78) and 21:9 (2.33) pass; 1:3 banners and tiny thumbnails do not.
export const IMAGE_MIN_SHORT_SIDE = 480
export const IMAGE_MAX_RATIO = 2.4
export const IMAGE_MAX_LONG_SIDE = 8000

export function validateImageGeometry(dim: { width: number; height: number }): { ok: boolean; reason?: string } {
  const minSide = Math.min(dim.width, dim.height)
  const maxSide = Math.max(dim.width, dim.height)
  if (minSide < IMAGE_MIN_SHORT_SIDE) return { ok: false, reason: `the short side must be at least ${IMAGE_MIN_SHORT_SIDE} px` }
  if (maxSide / minSide > IMAGE_MAX_RATIO) return { ok: false, reason: `the long side can be at most ${IMAGE_MAX_RATIO} times the short side` }
  if (maxSide > IMAGE_MAX_LONG_SIDE) return { ok: false, reason: `the long side can be at most ${IMAGE_MAX_LONG_SIDE} px` }
  return { ok: true }
}


