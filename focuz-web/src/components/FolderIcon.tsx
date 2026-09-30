import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded'
import type { FolderKind } from '../lib/folders'
import type { FolderLook } from '../lib/folder-look'
import { FOLDER_ICONS } from '../lib/folder-icons'

/**
 * A folder's icon. The shape is the folder's own (a folder by default), the form tells its kind:
 * solid – notes by tags, outline – a group of subfolders, solid with a funnel – a smart folder.
 */
export function FolderIcon({ kind, look, className }: { kind: FolderKind; look?: FolderLook; className?: string }) {
  const { Solid, Outline } = FOLDER_ICONS[look?.icon ?? 'folder']
  const cls = `icon-sm ${className ?? ''} ${look?.color ? `folder-color folder-color-${look.color}` : ''}`
  if (kind === 'group') return <Outline fontSize="inherit" className={cls} aria-hidden />
  if (kind === 'folder') return <Solid fontSize="inherit" className={cls} aria-hidden />
  return (
    <span className={`folder-glyph ${cls}`} aria-hidden>
      <Solid fontSize="inherit" />
      <span className="folder-smart-badge"><FilterAltRoundedIcon fontSize="inherit" /></span>
    </span>
  )
}
