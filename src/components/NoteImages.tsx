import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useObjectUrl } from '../lib/useObjectUrl'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AttachmentRecord } from '../lib/types'
import { attachments as attachmentsRepo } from '../data'
import { requestAttachmentPrefetch } from '../lib/sync'

export default function NoteImages({ noteId }: { noteId: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef<Array<HTMLDivElement | null>>([])
  const [containerWidth, setContainerWidth] = useState(0)
  const [dimensions, setDimensions] = useState<Record<number, { w: number; h: number } | undefined>>({})
  const [cellWidths, setCellWidths] = useState<number[]>([])
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const wheelAccumRef = useRef(0)
  const wheelCooldownRef = useRef<number | null>(null)

  const attachments = (useLiveQuery(async () => {
    return attachmentsRepo.listDisplayForNote(noteId)
  }, [noteId]) ?? []) as AttachmentRecord[]

  const hasAny = attachments.length > 0
  const layout = useMemo(() => computeLayout(attachments.length), [attachments.length])
  const rowHeights = useMemo(() => {
    if (!hasAny) return [] as number[]
    const style = containerRef.current ? getComputedStyle(containerRef.current) : undefined
    const gap = style ? (parseFloat(style.columnGap || '0') || 0) : 0
    return computeRowHeightsFromDims(layout, attachments, dimensions, cellWidths, containerWidth, gap)
  }, [hasAny, layout, attachments, dimensions, cellWidths, containerWidth])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const update = () => {
      setContainerWidth(el.clientWidth)
      const widths: number[] = []
      for (let i = 0; i < attachments.length; i++) {
        const ref = cellRefs.current[i]
        widths.push(ref ? ref.clientWidth : 0)
      }
      setCellWidths(widths)
    }
    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [attachments.length, layout.columns])

  // Re-measure cell widths after attachments/layout render
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const widths: number[] = []
      for (let i = 0; i < attachments.length; i++) {
        const ref = cellRefs.current[i]
        widths.push(ref ? ref.clientWidth : 0)
      }
      setCellWidths(widths)
    })
    return () => cancelAnimationFrame(id)
  }, [attachments.length, layout.columns])

  useEffect(() => {
    let cancelled = false
    const loaders: Array<() => void> = []
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i]
      if (!a.data || a.id == null) continue
      if (dimensions[a.id]) continue
      const url = URL.createObjectURL(a.data)
      const img = new Image()
      img.onload = () => {
        if (!cancelled) {
          setDimensions(prev => ({ ...prev, [a.id!]: { w: img.naturalWidth, h: img.naturalHeight } }))
        }
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
      }
      img.src = url
      loaders.push(() => {
        URL.revokeObjectURL(url)
      })
    }
    return () => {
      cancelled = true
      for (const revoke of loaders) revoke()
    }
  }, [attachments, dimensions])

  // When viewer is open, ensure the current image is prefetched and enable keyboard navigation
  useEffect(() => {
    if (viewerIndex == null) return
    const a = attachments[viewerIndex]
    if (a && !a.data && a.id != null) requestAttachmentPrefetch(a.id)
  }, [viewerIndex, attachments])

  useEffect(() => {
    if (viewerIndex == null) return
    // lock background scroll
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setViewerIndex(null)
      } else if (e.key === 'ArrowLeft') {
        setViewerIndex(i => (i != null && i > 0 ? i - 1 : i))
      } else if (e.key === 'ArrowRight') {
        setViewerIndex(i => (i != null && i < attachments.length - 1 ? i + 1 : i))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (wheelCooldownRef.current != null) {
        clearTimeout(wheelCooldownRef.current)
        wheelCooldownRef.current = null
      }
      wheelAccumRef.current = 0
    }
  }, [viewerIndex, attachments.length])
  
  if (!hasAny) return null

  return (
    <div>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: rowHeights.length ? rowHeights.map(h => `${Math.max(1, Math.round(h))}px`).join(' ') : undefined,
        }}
        ref={containerRef}
      >
        {attachments.map((att, idx) => (
          <Cell key={att.id ?? idx} span={layout.spans[idx]} att={att} refEl={(el) => { cellRefs.current[idx] = el }} onOpen={() => setViewerIndex(idx)} />
        ))}
      </div>

      {viewerIndex != null && (
        createPortal(
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setViewerIndex(null)}
            onWheel={(e) => {
              e.preventDefault()
              // Debounce to approximate one step per wheel turn
              if (wheelCooldownRef.current != null) return
              wheelAccumRef.current += e.deltaY
              const threshold = 80
              if (wheelAccumRef.current >= threshold) {
                setViewerIndex(i => (i != null && i < attachments.length - 1 ? i + 1 : i))
                wheelAccumRef.current = 0
                wheelCooldownRef.current = window.setTimeout(() => { wheelCooldownRef.current = null }, 200)
              } else if (wheelAccumRef.current <= -threshold) {
                setViewerIndex(i => (i != null && i > 0 ? i - 1 : i))
                wheelAccumRef.current = 0
                wheelCooldownRef.current = window.setTimeout(() => { wheelCooldownRef.current = null }, 200)
              }
            }}
          >
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 flex items-center justify-center p-4">
              {attachments[viewerIndex]?.data ? (
                <BlobImg
                  blob={attachments[viewerIndex]!.data as Blob}
                  alt={attachments[viewerIndex]?.fileName}
                  className="max-w-[95vw] max-h-[95vh] w-auto h-auto object-contain"
                  draggable={false}
                />
              ) : (
                <div className="text-neutral-400">Loading…</div>
              )}
            </div>

            {viewerIndex > 0 && (
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 text-3xl px-3 py-2 bg-black/40 hover:bg-black/60 rounded"
                type="button"
                onClick={(e) => { e.stopPropagation(); setViewerIndex(i => (i != null && i > 0 ? i - 1 : i)) }}
                aria-label="Previous image"
              >
                ←
              </button>
            )}
            {viewerIndex < attachments.length - 1 && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-3xl px-3 py-2 bg-black/40 hover:bg-black/60 rounded"
                type="button"
                onClick={(e) => { e.stopPropagation(); setViewerIndex(i => (i != null && i < attachments.length - 1 ? i + 1 : i)) }}
                aria-label="Next image"
              >
                →
              </button>
            )}
          </div>,
          document.body,
        )
      )}
    </div>
  )
}

function Cell({ span, att, refEl, onOpen }: { span?: { col?: number; row?: number }; att: AttachmentRecord; refEl?: (el: HTMLDivElement | null) => void; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    if (refEl) refEl(ref.current)
    if (att.data || !att.serverId) return
    const el = ref.current
    const io = new IntersectionObserver((entries) => {
      const e = entries[0]
      if (e.isIntersecting) {
        requestAttachmentPrefetch(att.id!)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [att.data, att.serverId, att.id, refEl])

  const style: React.CSSProperties = {}
  if (span?.row && span.row > 1) style.gridRow = `span ${span.row} / span ${span.row}`
  if (span?.col && span.col > 1) style.gridColumn = `span ${span.col} / span ${span.col}`

  return (
    <div
      ref={ref}
      className={['relative rounded-[var(--radius)] overflow-hidden', (att.data ? 'cursor-pointer hover:opacity-95' : '')].join(' ')}
      style={{
        ...style,
        background: 'rgb(var(--c-surface))',
        boxShadow: 'var(--shadow-waterdrop)',
      }}
      onClick={() => { if (att.data && onOpen) onOpen() }}
      role={att.data ? 'button' : undefined}
      aria-label={att.data ? 'Open image' : undefined}
      tabIndex={-1}
    >
      {att.data ? (
        <BlobImg
          blob={att.data}
          alt={att.fileName}
          className="block w-full h-full object-cover object-center"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full min-h-[96px] flex items-center justify-center text-muted">Loading…</div>
      )}
    </div>
  )
}

function BlobImg({ blob, alt, className, draggable }: { blob: Blob; alt?: string; className?: string; draggable?: boolean }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      draggable={draggable}
    />
  )
}

function computeLayout(n: number): { columns: number; rows: number; spans: Array<{ col?: number; row?: number } | undefined> } {
  if (n <= 0) return { columns: 1, rows: 1, spans: [] }
  if (n === 1) return { columns: 1, rows: 1, spans: [undefined] }
  if (n === 2) return { columns: 2, rows: 1, spans: [undefined, undefined] }
  if (n === 3) {
    // Row1: 1 (full width), Row2: 2
    return { columns: 2, rows: 2, spans: [
      { col: 2 },
      undefined, undefined,
    ]}
  }
  if (n === 4) return { columns: 2, rows: 2, spans: [undefined, undefined, undefined, undefined] }
  if (n === 5) {
    // 2 on first row (each 1/2), 3 on second row (each 1/3)
    // Use 6 columns: top spans=3, bottom spans=2
    return { columns: 6, rows: 2, spans: [
      { col: 3 }, { col: 3 }, // row 1
      { col: 2 }, { col: 2 }, { col: 2 }, // row 2
    ]}
  }
  if (n === 6) return { columns: 3, rows: 2, spans: new Array(6).fill(undefined) }
  if (n === 7) {
    // 2, 2, 3
    // 6 columns: row1 spans=3, row2 spans=3, row3 spans=2
    return { columns: 6, rows: 3, spans: [
      { col: 3 }, { col: 3 }, // row 1: 2 images
      { col: 3 }, { col: 3 }, // row 2: 2 images  
      { col: 2 }, { col: 2 }, { col: 2 }, // row 3: 3 images
    ]}
  }
  if (n === 8) {
    // 2, then 3, then 3
    // 6 columns: row1 spans=3, row2 spans=2, row3 spans=2
    return { columns: 6, rows: 3, spans: [
      { col: 3 }, { col: 3 },
      { col: 2 }, { col: 2 }, { col: 2 },
      { col: 2 }, { col: 2 }, { col: 2 },
    ]}
  }
  if (n === 9) return { columns: 3, rows: 3, spans: new Array(9).fill(undefined) }
  if (n === 10) {
    // 4 rows: 2,2,3,3
    // 6 columns: rows with 2 use spans=3; rows with 3 use spans=2
    return { columns: 6, rows: 4, spans: [
      { col: 3 }, { col: 3 },
      { col: 3 }, { col: 3 },
      { col: 2 }, { col: 2 }, { col: 2 },
      { col: 2 }, { col: 2 }, { col: 2 },
    ]}
  }
  // Fallback for >10: three-column grid, rows auto
  return { columns: 3, rows: Math.ceil(n / 3), spans: new Array(n).fill(undefined) }
}

// Compute per-row heights using natural image dimensions with clamp: [1.0x, 1.25x] of width per image.
function computeRowHeightsFromDims(
  layout: { columns: number; rows: number; spans: Array<{ col?: number; row?: number } | undefined> },
  attachments: AttachmentRecord[],
  dims: Record<number, { w: number; h: number } | undefined>,
  cellWidths: number[],
  containerWidth: number,
  gap: number
): number[] {
  if (layout.rows <= 0) return []
  const heights: number[] = []

  // Simulate placement and compute row height by averaging capped heights
  let imgIndex = 0
  for (let row = 0; row < layout.rows; row++) {
    let c = 0
    const perImageHeights: number[] = []
    while (imgIndex < attachments.length && c < layout.columns) {
      const span = layout.spans[imgIndex]
      const colSpan = span?.col || 1
      let widthPx = cellWidths[imgIndex] ?? 0
      if (!widthPx && containerWidth) {
        // Fallback to container-based estimate including gaps when ref not measured yet
        const colWidth = (containerWidth - gap * (layout.columns - 1)) / layout.columns
        widthPx = colWidth * colSpan + gap * (colSpan - 1)
      }

      const att = attachments[imgIndex]
      const d = att.id != null ? dims[att.id] : undefined
      let naturalHeightAtWidth: number | undefined
      if (d && d.w > 0) {
        naturalHeightAtWidth = (d.h / d.w) * widthPx
      }
      const minCap = 1.0 * widthPx
      const maxCap = 1.25 * widthPx
      const target = naturalHeightAtWidth != null
        ? Math.min(Math.max(naturalHeightAtWidth, minCap), maxCap)
        : minCap
      perImageHeights.push(target)

      c += colSpan
      imgIndex++
    }
    if (perImageHeights.length) {
      // Row height is average of per-image targets (your "середина" логика)
      const sum = perImageHeights.reduce((a, b) => a + b, 0)
      heights.push(sum / perImageHeights.length)
    }
  }
  return heights
}


