import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded'
import type { FolderKind } from '../lib/folders'

export function FolderIcon({ kind, className }: { kind: FolderKind; className?: string }) {
  const cls = `icon-sm ${className ?? ''}`
  if (kind === 'smart') return <FilterAltRoundedIcon fontSize="inherit" className={`${cls} folder-icon-smart`} aria-hidden />
  if (kind === 'group') return <FolderOutlinedIcon fontSize="inherit" className={cls} aria-hidden />
  return <FolderRoundedIcon fontSize="inherit" className={cls} aria-hidden />
}
