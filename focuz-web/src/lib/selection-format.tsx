import type { ReactNode } from 'react'
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import StrikethroughSRoundedIcon from '@mui/icons-material/StrikethroughSRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'

export type InlineMark = 'bold' | 'italic' | 'strike' | 'code'

// A small bar over selected text, as phones do it. On touch screens it sits under the selection,
// so the system's copy/paste menu above it stays reachable.
export const touchScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export const INLINE_TOOLS: { mark: InlineMark; label: string; shortcut: string; icon: ReactNode }[] = [
  { mark: 'bold', label: 'Bold', shortcut: 'Mod-B', icon: <FormatBoldRoundedIcon fontSize="inherit" /> },
  { mark: 'italic', label: 'Italic', shortcut: 'Mod-I', icon: <FormatItalicRoundedIcon fontSize="inherit" /> },
  { mark: 'strike', label: 'Strikethrough', shortcut: 'Mod-Shift-S', icon: <StrikethroughSRoundedIcon fontSize="inherit" /> },
  { mark: 'code', label: 'Code', shortcut: 'Mod-E', icon: <CodeRoundedIcon fontSize="inherit" /> },
]
