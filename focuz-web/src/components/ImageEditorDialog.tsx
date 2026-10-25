import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded'
import FlipRoundedIcon from '@mui/icons-material/FlipRounded'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { loadImage, renderEdits, rotatedSize, type PixelArea } from '../lib/image-edit'
import { centeredCrop, flipCropH, flipCropV, moveCrop, resizeCrop, rotateCropLeft, type CropHandle } from '../lib/crop-box'

type AspectPreset = 'free' | 'square' | '4:3' | '16:9'
const PRESETS: Array<{ id: AspectPreset; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: 'square', label: 'Square' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
]
const ASPECT: Record<AspectPreset, number | null> = { free: null, square: 1, '4:3': 4 / 3, '16:9': 16 / 9 }
const CORNERS: CropHandle[] = ['nw', 'ne', 'sw', 'se']
const EDGES: CropHandle[] = ['n', 's', 'w', 'e']

/**
 * Crop, rotate and flip a picture. The whole picture stays in view and a frame with a 3×3 grid sits on
 * it: drag a corner (or, without a fixed shape, a side) to resize, drag inside to move. With `square`
 * the frame keeps a square (space pictures, avatars) and shows a circle when `round` is set.
 */
export default function ImageEditorDialog({
  image,
  title = 'Edit picture',
  square = false,
  round = false,
  maxSide = 2048,
  saveLabel = 'Save',
  onSave,
  onCancel,
}: {
  image: Blob
  title?: string
  square?: boolean
  round?: boolean
  maxSide?: number
  saveLabel?: string
  onSave: (result: Blob) => void | Promise<void>
  onCancel: () => void
}) {
  const url = useMemo(() => URL.createObjectURL(image), [image])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [preset, setPreset] = useState<AspectPreset>(square ? 'square' : 'free')
  // The crop in pixels of the picture as shown: rotated and flipped (what renderEdits takes).
  const [crop, setCrop] = useState<PixelArea | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A state, not a ref: the dialog mounts its content after the first render, and the size has to follow.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const drag = useRef<{ handle: CropHandle | 'move'; startX: number; startY: number; start: PixelArea } | null>(null)

  useEffect(() => { loadImage(url).then(setImg).catch(() => setError('Could not read the picture')) }, [url])

  useEffect(() => {
    if (!stageEl) return
    const update = () => setStage({ w: stageEl.clientWidth, h: stageEl.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(stageEl)
    return () => ro.disconnect()
  }, [stageEl])

  const aspect = ASPECT[preset]
  const box = img ? rotatedSize(img.naturalWidth, img.naturalHeight, rotation) : null
  const W = box ? Math.round(box.width) : 0
  const H = box ? Math.round(box.height) : 0
  // The picture fits the stage; `scale` turns its pixels into screen pixels.
  const pad = 14
  const scale = W && stage.w ? Math.min((stage.w - pad * 2) / W, (stage.h - pad * 2) / H) : 0
  const view = { w: W * scale, h: H * scale, x: (stage.w - W * scale) / 2, y: (stage.h - H * scale) / 2 }

  // The first frame: the whole picture, or the biggest centred square.
  useEffect(() => { if (W && !crop) setCrop(centeredCrop(W, H, aspect)) }, [W, H, aspect, crop])

  // The picture as shown, drawn rotated and flipped the same way the saved one is.
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !img || !scale) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(view.w * dpr)
    c.height = Math.round(view.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    const s = scale * dpr
    ctx.scale((flipH ? -1 : 1) * s, (flipV ? -1 : 1) * s)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  }, [img, rotation, flipH, flipV, scale, view.w, view.h])

  function rotateLeft() {
    if (!crop) return
    setCrop(rotateCropLeft(crop, W))
    setRotation(r => (r + 270) % 360)
  }

  // "Horizontally" means as you see it: after a quarter turn that is the picture's own vertical axis.
  const turned = rotation % 180 !== 0
  function flipSeen(horizontal: boolean) {
    if (!crop) return
    setCrop(horizontal ? flipCropH(crop, W) : flipCropV(crop, H))
    if (horizontal !== turned) setFlipH(v => !v)
    else setFlipV(v => !v)
  }

  function choosePreset(p: AspectPreset) {
    setPreset(p)
    if (W) setCrop(centeredCrop(W, H, ASPECT[p]))
  }

  function reset() {
    setRotation(0); setFlipH(false); setFlipV(false)
    const p: AspectPreset = square ? 'square' : 'free'
    setPreset(p)
    if (img) setCrop(centeredCrop(img.naturalWidth, img.naturalHeight, ASPECT[p]))
  }

  // Smallest frame: about 40 screen pixels, so the handles never pile up.
  const minSide = scale ? Math.min(W, H, 40 / scale) : 1

  function onPointerDown(e: PointerEvent<HTMLElement>, handle: CropHandle | 'move') {
    if (!crop || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    stageEl?.setPointerCapture(e.pointerId)
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: crop }
  }
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d || !scale) return
    const dx = (e.clientX - d.startX) / scale
    const dy = (e.clientY - d.startY) / scale
    setCrop(d.handle === 'move'
      ? moveCrop(d.start, dx, dy, W, H)
      : resizeCrop(d.start, d.handle, dx, dy, W, H, aspect, minSide))
  }
  function onPointerUp(e: PointerEvent<HTMLElement>) {
    if (!drag.current) return
    drag.current = null
    stageEl?.releasePointerCapture(e.pointerId)
  }

  // Arrows move the frame; with Shift they make it bigger or smaller.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!crop || !scale) return
    const step = (e.altKey ? 1 : 10) / scale
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    if (!dx && !dy) return
    e.preventDefault()
    setCrop(e.shiftKey ? resizeCrop(crop, 'se', dx, dy, W, H, aspect, minSide) : moveCrop(crop, dx, dy, W, H))
  }

  async function save() {
    if (!img || !crop) return
    setBusy(true)
    setError(null)
    try {
      const blob = await renderEdits(img, { area: roundArea(crop), rotation, flipH, flipV }, { maxSide })
      await onSave(blob)
    } catch (e: any) {
      setError(e?.message || 'Could not save the picture')
    } finally {
      setBusy(false)
    }
  }

  const frame = crop && scale
    ? { left: view.x + crop.x * scale, top: view.y + crop.y * scale, width: crop.width * scale, height: crop.height * scale }
    : null
  const handles = aspect == null ? [...CORNERS, ...EDGES] : CORNERS

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent stacked className="image-editor" aria-describedby="image-editor-desc" onPaste={e => e.stopPropagation()}>
        <div className="settings-head">
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription id="image-editor-desc" className="sr-only">
          Drag the corners of the frame to resize it and drag inside it to move it. Arrow keys move the frame, Shift with arrows resizes it.
        </DialogDescription>
        <div
          ref={setStageEl}
          className="image-editor-stage"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas
            ref={canvasRef}
            className="crop-picture"
            style={{ left: view.x, top: view.y, width: view.w, height: view.h }}
            aria-hidden
          />
          {frame && (
            <div
              className={`crop-frame ${round ? 'is-round' : ''}`}
              style={frame}
              tabIndex={0}
              role="group"
              aria-label="Crop frame"
              onPointerDown={e => onPointerDown(e, 'move')}
              onKeyDown={onKeyDown}
            >
              <div className="crop-shade" aria-hidden />
              <div className="crop-grid" aria-hidden><span /><span /><span /><span /></div>
              {handles.map(h => (
                <div key={h} className={`crop-handle crop-handle-${h}`} onPointerDown={e => onPointerDown(e, h)} aria-hidden />
              ))}
            </div>
          )}
        </div>
        <div className="image-editor-tools">
          {!square && (
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Shape">
              {PRESETS.map(p => (
                <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="filter-chip-select" onClick={() => choosePreset(p.id)}>{p.label}</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Rotate left" title="Rotate left" onClick={rotateLeft}>
              <RotateLeftRoundedIcon fontSize="inherit" className="icon-sm" />
            </button>
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Flip horizontally" title="Flip horizontally" onClick={() => flipSeen(true)}>
              <FlipRoundedIcon fontSize="inherit" className="icon-sm" />
            </button>
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Flip vertically" title="Flip vertically" onClick={() => flipSeen(false)}>
              <FlipRoundedIcon fontSize="inherit" className="icon-sm" style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button type="button" className="filter-btn filter-btn-ghost !h-8" onClick={reset}>Reset</button>
          </div>
        </div>
        {error && <p className="settings-error px-5" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="button" disabled={busy || !crop} onClick={() => { void save() }}>{saveLabel}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function roundArea(a: PixelArea): PixelArea {
  return { x: Math.round(a.x), y: Math.round(a.y), width: Math.max(1, Math.round(a.width)), height: Math.max(1, Math.round(a.height)) }
}
