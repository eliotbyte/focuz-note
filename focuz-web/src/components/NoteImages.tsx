import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useObjectUrl } from '../lib/useObjectUrl'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AttachmentRecord } from '../lib/types'
import { attachments as attachmentsRepo } from '../data'
import { requestAttachmentPrefetch } from '../lib/sync'

// Images in the feed never grow past their own size and never get taller than this.
const MAX_MEDIA_HEIGHT = 360
// Past this many dots the indicator turns into a "3 / 12" counter.
const MAX_DOTS = 10
const NONE: AttachmentRecord[] = []
// Up to this many pictures are packed together; more go into the carousel.
const MAX_COLLAGE = 3
const COLLAGE_GAP = 4

export default function NoteImages({ noteId }: { noteId: number }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [slide, setSlide] = useState(0)
  const wheelAccumRef = useRef(0)
  const wheelCooldownRef = useRef<number | null>(null)

  const attachments = (useLiveQuery(async () => {
    return attachmentsRepo.listDisplayForNote(noteId)
  }, [noteId]) ?? NONE) as AttachmentRecord[]

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

  // The viewer and the carousel point at the same picture: leaving the viewer leaves the carousel where you were.
  useEffect(() => {
    if (viewerIndex != null) setSlide(viewerIndex)
  }, [viewerIndex])

  if (attachments.length === 0) return null

  return (
    <div>
      {attachments.length === 1
        ? <SingleImage att={attachments[0]} onOpen={() => setViewerIndex(0)} />
        : attachments.length <= MAX_COLLAGE
          ? <Collage attachments={attachments} onOpen={setViewerIndex} />
          : <Carousel attachments={attachments} index={slide} onIndexChange={setSlide} onOpen={setViewerIndex} />}

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

// One picture: shown at its own size, only ever scaled down to fit the card and the height cap. No cropping.
function SingleImage({ att, onOpen }: { att: AttachmentRecord; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  usePrefetchWhenVisible(ref, att.data ? [] : [att])

  if (!att.data) {
    return (
      <div ref={ref} className="rounded-[var(--radius)] media-frame h-[160px] flex items-center justify-center text-muted">
        Loading…
      </div>
    )
  }
  return (
    <div
      ref={ref}
      className="inline-block max-w-full align-top rounded-[var(--radius)] overflow-hidden media-frame cursor-pointer hover:opacity-95"
      onClick={onOpen}
      role="button"
      aria-label="Open image"
      tabIndex={-1}
    >
      <BlobImg
        blob={att.data}
        alt={att.fileName}
        className="block w-auto h-auto max-w-full"
        style={{ maxHeight: `min(${MAX_MEDIA_HEIGHT}px, 60vh)` }}
        draggable={false}
      />
    </div>
  )
}

// Two or three pictures packed together: two side by side, or one across the top with two under it.
// The collage always spans the note; each row is shared out by the pictures' own proportions and
// capped in height. A picture is never cropped or blown up past its size: whatever room is left
// around it is filled with the picture itself, blurred and dimmed.
function Collage({ attachments, onOpen }: { attachments: AttachmentRecord[]; onOpen: (i: number) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const dims = useImageDimensions(attachments)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  usePrefetchWhenVisible(rootRef, attachments.filter(a => !a.data))

  const sizeOf = (i: number) => {
    const a = attachments[i]
    const d = a.id != null ? dims[a.id] : undefined
    return d && d.w > 0 && d.h > 0 ? d : { w: 1, h: 1 }
  }
  const rows: Array<{ items: number[]; maxH: number }> = attachments.length === 2
    ? [{ items: [0, 1], maxH: 320 }]
    : [{ items: [0], maxH: 260 }, { items: [1, 2], maxH: 180 }]

  const W = width

  return (
    <div ref={rootRef} className="flex flex-col" style={{ gap: COLLAGE_GAP }}>
      {W > 0 && rows.map((row, r) => {
        const ratios = row.items.map(i => sizeOf(i).w / sizeOf(i).h)
        const free = W - COLLAGE_GAP * (row.items.length - 1)
        const fitted = free / ratios.reduce((s, x) => s + x, 0)
        // Small pictures get a row no taller than the tallest of them, not a big empty frame.
        const tallest = Math.max(...row.items.map(i => sizeOf(i).h))
        const h = Math.round(Math.max(Math.min(fitted, row.maxH, tallest), 72))
        return (
          <div key={r} className="flex" style={{ gap: COLLAGE_GAP, width: W, height: h }}>
            {row.items.map((i, k) => {
              const att = attachments[i]
              return (
                <div
                  key={att.id ?? i}
                  className={['media-cell min-w-0 media-frame', collageCorners(attachments.length, r, k), att.data ? 'cursor-pointer hover:opacity-95' : ''].join(' ')}
                  style={{ flex: `${ratios[k]} 1 0` }}
                  onClick={() => { if (att.data) onOpen(i) }}
                  role={att.data ? 'button' : undefined}
                  aria-label={att.data ? `Open image ${i + 1} of ${attachments.length}` : undefined}
                  tabIndex={-1}
                >
                  {att.data ? (
                    <>
                      <BlobImg blob={att.data} className="media-backdrop" draggable={false} />
                      <BlobImg blob={att.data} alt={att.fileName} className="media-fit" draggable={false} />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted">Loading…</div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// The collage reads as one rounded picture: only its outer corners are rounded.
function collageCorners(count: number, row: number, col: number): string {
  if (count === 2) return col === 0 ? 'rounded-l-[var(--radius)]' : 'rounded-r-[var(--radius)]'
  if (row === 0) return 'rounded-t-[var(--radius)]'
  return col === 0 ? 'rounded-bl-[var(--radius)]' : 'rounded-br-[var(--radius)]'
}

// Several pictures: a strip you flip through, one at a time, with arrows and a position indicator.
function Carousel({ attachments, index, onIndexChange, onOpen }: {
  attachments: AttachmentRecord[]
  index: number
  onIndexChange: (i: number) => void
  onOpen: (i: number) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const dims = useImageDimensions(attachments)
  const count = attachments.length
  const current = Math.min(Math.max(index, 0), count - 1)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Off-screen slides are clipped by the strip, so fetch what's around the current one instead of waiting to see it.
  const around = [current - 1, current, current + 1]
    .filter(i => i >= 0 && i < count)
    .map(i => attachments[i])
    .filter(a => !a.data)
  usePrefetchWhenVisible(rootRef, around)

  // Keep the strip in step when the index is changed from outside (arrows, dots, the viewer).
  // While the strip glides to a chosen slide, the slides it passes over must not become "current".
  const gliding = useRef<{ target: number; timer: number } | null>(null)
  useEffect(() => {
    const track = trackRef.current
    if (!track || !track.clientWidth) return
    const target = current * track.clientWidth
    if (Math.abs(track.scrollLeft - target) <= 1) return
    if (gliding.current) clearTimeout(gliding.current.timer)
    // Fallback in case the glide is interrupted (a finger on the strip) and never arrives.
    const timer = window.setTimeout(() => { gliding.current = null; onScroll() }, 700)
    gliding.current = { target, timer }
    track.scrollTo({ left: target, behavior: 'smooth' })
    // onScroll reads the latest props; it doesn't need to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, width])
  useEffect(() => () => { if (gliding.current) clearTimeout(gliding.current.timer) }, [])

  function onScroll() {
    const track = trackRef.current
    if (!track || !track.clientWidth) return
    const g = gliding.current
    if (g) {
      if (Math.abs(track.scrollLeft - g.target) > 1) return
      clearTimeout(g.timer)
      gliding.current = null
    }
    const i = Math.round(track.scrollLeft / track.clientWidth)
    if (i !== current && i >= 0 && i < count) onIndexChange(i)
  }

  // One height for the whole strip, so flipping doesn't make the card jump: the tallest picture as it
  // would sit in the strip without being enlarged, capped.
  const height = (() => {
    const cap = Math.min(MAX_MEDIA_HEIGHT, typeof window !== 'undefined' ? window.innerHeight * 0.6 : MAX_MEDIA_HEIGHT)
    let tallest = 0
    for (const a of attachments) {
      const d = a.id != null ? dims[a.id] : undefined
      if (!d || d.w <= 0) continue
      const scale = width > 0 ? Math.min(1, width / d.w) : 1
      tallest = Math.max(tallest, d.h * scale)
    }
    return Math.round(tallest > 0 ? Math.min(tallest, cap) : cap * 0.75)
  })()

  const go = (i: number) => onIndexChange(Math.min(Math.max(i, 0), count - 1))

  return (
    <div
      ref={rootRef}
      className="note-carousel group relative rounded-[var(--radius)] overflow-hidden media-frame"
      style={{ height }}
    >
      <div ref={trackRef} className="note-carousel-track" onScroll={onScroll}>
        {attachments.map((att, i) => (
          <div
            key={att.id ?? i}
            className={['note-carousel-slide', att.data ? 'cursor-pointer' : ''].join(' ')}
            onClick={() => { if (att.data) onOpen(i) }}
            role={att.data ? 'button' : undefined}
            aria-label={att.data ? `Open image ${i + 1} of ${count}` : undefined}
            tabIndex={-1}
          >
            {att.data ? (
              <>
                <BlobImg blob={att.data} className="media-backdrop" draggable={false} />
                <BlobImg blob={att.data} alt={att.fileName} className="media-fit" draggable={false} />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted">Loading…</div>
            )}
          </div>
        ))}
      </div>

      {current > 0 && (
        <button
          type="button"
          className="note-carousel-arrow left-2"
          onClick={(e) => { e.stopPropagation(); go(current - 1) }}
          aria-label="Previous image"
        >
          <ArrowIcon dir="left" />
        </button>
      )}
      {current < count - 1 && (
        <button
          type="button"
          className="note-carousel-arrow right-2"
          onClick={(e) => { e.stopPropagation(); go(current + 1) }}
          aria-label="Next image"
        >
          <ArrowIcon dir="right" />
        </button>
      )}

      {count <= MAX_DOTS ? (
        <div className="note-carousel-dots" role="tablist" aria-label="Images">
          {attachments.map((att, i) => (
            <button
              key={att.id ?? i}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`Image ${i + 1} of ${count}`}
              className={i === current ? 'is-current' : ''}
              onClick={(e) => { e.stopPropagation(); go(i) }}
            />
          ))}
        </div>
      ) : (
        <div className="note-carousel-counter" aria-live="polite">{current + 1} / {count}</div>
      )}
    </div>
  )
}

function ArrowIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left'
        ? <><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>
        : <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>}
    </svg>
  )
}

// Asks sync for the given images once the element comes near the screen.
function usePrefetchWhenVisible(ref: React.RefObject<HTMLElement | null>, pending: AttachmentRecord[]) {
  const key = pending.filter(a => a.serverId && a.id != null).map(a => a.id).join(',')
  useEffect(() => {
    const el = ref.current
    if (!el || !key) return
    const ids = key.split(',').map(Number)
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        for (const id of ids) requestAttachmentPrefetch(id)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, key])
}

function useImageDimensions(attachments: AttachmentRecord[]) {
  const [dims, setDims] = useState<Record<number, { w: number; h: number } | undefined>>({})
  const requestedRef = useRef(new Set<number>())
  useEffect(() => {
    const requested = requestedRef.current
    let cancelled = false
    const urls: string[] = []
    for (const a of attachments) {
      if (!a.data || a.id == null || requested.has(a.id)) continue
      const id = a.id
      requested.add(id)
      const url = URL.createObjectURL(a.data)
      urls.push(url)
      const img = new Image()
      img.onload = () => {
        if (!cancelled) setDims(prev => ({ ...prev, [id]: { w: img.naturalWidth, h: img.naturalHeight } }))
      }
      img.onerror = () => { requested.delete(id) }
      img.src = url
    }
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
      // Loads cut short here get another go on the next run.
      for (const a of attachments) if (a.id != null && !dimsRef.current[a.id]) requested.delete(a.id)
    }
  }, [attachments])
  const dimsRef = useRef(dims)
  dimsRef.current = dims
  return dims
}

function BlobImg({ blob, alt, className, style, draggable }: { blob: Blob; alt?: string; className?: string; style?: React.CSSProperties; draggable?: boolean }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return (
    <img
      src={url}
      alt={alt ?? ''}
      className={className}
      style={style}
      draggable={draggable}
    />
  )
}

// Pictures of a note in a grid tile. Tiles are all one size, so here pictures are cropped to fill
// their box: one fills it, two share it side by side, three are one big and two small, and four or
// more show the first four with "+N" on the last.
export function NoteTileImages({ attachments, className }: { attachments: AttachmentRecord[]; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const shown = attachments.slice(0, 4)
  usePrefetchWhenVisible(ref, shown.filter(a => !a.data))
  if (attachments.length === 0) return null
  const more = attachments.length - shown.length
  return (
    <div ref={ref} className={`tile-media tile-media-${shown.length} ${className ?? ''}`}>
      {shown.map((a, i) => (
        <div key={a.id ?? i} className="tile-media-cell">
          {a.data ? <BlobImg blob={a.data} alt={a.fileName} className="tile-media-img" draggable={false} /> : null}
          {more > 0 && i === shown.length - 1 && <span className="tile-media-more">+{more}</span>}
        </div>
      ))}
    </div>
  )
}
