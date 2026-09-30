import imageCompression, { type Options } from 'browser-image-compression'

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

export async function compressToWebP(file: File): Promise<CompressedImageResult> {
  if (!isSupportedImage(file)) throw new Error('Unsupported image type')
  const options: Options = {
    // Deterministic compression: fixed quality for all images
    // maxSizeMB removed to prevent adaptive quality degradation
    maxWidthOrHeight: 2048,
    initialQuality: 0.65, // Fixed quality level for consistent visual output
    fileType: 'image/webp',
    alwaysKeepResolution: false,
    useWebWorker: true,
  }
  const blob = await imageCompression(file, options)
  const out: CompressedImageResult = {
    blob,
    fileName: toWebPName(file.name),
    fileType: 'image/webp',
    fileSize: blob.size,
  }
  return out
}

function toWebPName(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return `${name}.webp`
  return `${name.slice(0, idx)}.webp`
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const dataUrl = await fileToDataURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to read image'))
    img.src = dataUrl
  })
}

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function validateImageGeometry(dim: { width: number; height: number }): { ok: boolean; reason?: string } {
  const minSide = Math.min(dim.width, dim.height)
  const maxSide = Math.max(dim.width, dim.height)
  if (minSide < 256) return { ok: false, reason: 'each side must be at least 256 px' }
  if (maxSide / minSide > 2) return { ok: false, reason: 'the long side can be at most twice the short side' }
  return { ok: true }
}


