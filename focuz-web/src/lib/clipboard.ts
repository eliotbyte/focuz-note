// Files from paste / drag-and-drop events: pictures and documents.

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/')
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types || []).includes('Files')
}

/** Files from a paste/drop (clipboard screenshots arrive as items, not files, in some browsers). */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  if (out.length === 0) out.push(...Array.from(dt.files || []))
  // Pasted screenshots come without a name of their own.
  return out.map((f, i) => !isImageFile(f) || (f.name && f.name !== 'image.png') ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }))
}
