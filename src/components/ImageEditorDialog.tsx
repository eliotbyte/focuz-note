import { useEffect, useMemo, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded'
import FlipRoundedIcon from '@mui/icons-material/FlipRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { loadImage, renderEdits } from '../lib/image-edit'

type AspectPreset = 'original' | 'square' | '4:3' | '16:9'
const PRESETS: Array<{ id: AspectPreset; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'square', label: 'Square' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
]

/**
 * Crop (drag, zoom), rotate and flip a picture. With `square` the crop is locked to a square
 * (space pictures, avatars) and shown as a circle when `round` is set.
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
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [preset, setPreset] = useState<AspectPreset>(square ? 'square' : 'original')
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadImage(url).then(img => setNatural({ w: img.naturalWidth, h: img.naturalHeight })).catch(() => setError('Could not read the picture')) }, [url])

  const turned = rotation % 180 !== 0
  const aspect = preset === 'square' ? 1 : preset === '4:3' ? 4 / 3 : preset === '16:9' ? 16 / 9
    : natural ? (turned ? natural.h / natural.w : natural.w / natural.h) : 1

  function reset() {
    setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setFlipH(false); setFlipV(false)
    setPreset(square ? 'square' : 'original')
  }

  async function save() {
    if (!area) return
    setBusy(true)
    setError(null)
    try {
      const img = await loadImage(url)
      const blob = await renderEdits(img, { area, rotation, flipH, flipV }, { maxSide })
      await onSave(blob)
    } catch (e: any) {
      setError(e?.message || 'Could not save the picture')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent stacked className="image-editor" aria-describedby="image-editor-desc" onPaste={e => e.stopPropagation()}>
        <div className="settings-head">
          <DialogTitle className="!text-primary !text-[17px] font-semibold">{title}</DialogTitle>
        </div>
        <DialogDescription id="image-editor-desc" className="sr-only">Drag to move, scroll or use the slider to zoom.</DialogDescription>
        <div className="image-editor-stage">
          <Cropper
            image={url}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            cropShape={round ? 'round' : 'rect'}
            showGrid={!round}
            minZoom={1}
            maxZoom={5}
            zoomSpeed={0.25}
            objectFit="contain"
            transform={`translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${zoom * (flipH ? -1 : 1)}, ${zoom * (flipV ? -1 : 1)})`}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, px) => setArea(px)}
          />
        </div>
        <div className="image-editor-tools">
          <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
            <ZoomOutRoundedIcon fontSize="inherit" className="icon-sm text-secondary" />
            <input
              type="range" min={1} max={5} step={0.01} value={zoom}
              aria-label="Zoom" className="image-editor-zoom flex-1"
              onChange={e => setZoom(Number(e.target.value))}
            />
            <ZoomInRoundedIcon fontSize="inherit" className="icon-sm text-secondary" />
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Rotate left" title="Rotate left" onClick={() => setRotation(r => (r + 270) % 360)}>
              <RotateLeftRoundedIcon fontSize="inherit" className="icon-sm" />
            </button>
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Flip horizontally" aria-pressed={flipH} title="Flip horizontally" onClick={() => setFlipH(v => !v)}>
              <FlipRoundedIcon fontSize="inherit" className="icon-sm" />
            </button>
            <button type="button" className="filter-btn !h-8 !px-2.5" aria-label="Flip vertically" aria-pressed={flipV} title="Flip vertically" onClick={() => setFlipV(v => !v)}>
              <FlipRoundedIcon fontSize="inherit" className="icon-sm" style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button type="button" className="filter-btn filter-btn-ghost !h-8" onClick={reset}>Reset</button>
          </div>
        </div>
        {!square && (
          <div className="image-editor-tools !pt-0" role="radiogroup" aria-label="Shape">
            {PRESETS.map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="filter-chip-select" onClick={() => setPreset(p.id)}>{p.label}</button>
            ))}
          </div>
        )}
        {error && <p className="settings-error px-5" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="button" disabled={busy || !area} onClick={() => { void save() }}>{saveLabel}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
