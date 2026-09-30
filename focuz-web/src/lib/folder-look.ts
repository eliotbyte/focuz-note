// A folder's own icon and color. Kept in the folder's params next to its rule, so they sync with it
// and the server needs nothing new; unknown values (e.g. from a newer app) fall back to the default.

export const FOLDER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'gray'] as const
export type FolderColor = typeof FOLDER_COLORS[number]

// Every icon has a solid and an outline form that stay apart at 16px: the form tells the folder kind
// (solid: by tags, outline: a group of subfolders, solid with a funnel badge: a smart folder).
export const FOLDER_ICON_KEYS = [
  'folder', 'star', 'heart', 'bookmark', 'flag', 'label', 'idea', 'done',
  'work', 'home', 'school', 'people', 'chat', 'mail', 'docs', 'archive',
  'shopping', 'money', 'health', 'place', 'photo', 'games', 'cafe', 'nature',
] as const
export type FolderIconKey = typeof FOLDER_ICON_KEYS[number]

export interface FolderLook { icon?: FolderIconKey; color?: FolderColor }

const isIcon = (v: unknown): v is FolderIconKey => typeof v === 'string' && (FOLDER_ICON_KEYS as readonly string[]).includes(v)
const isColor = (v: unknown): v is FolderColor => typeof v === 'string' && (FOLDER_COLORS as readonly string[]).includes(v)

export function lookFromParams(params: unknown): FolderLook {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  return { icon: isIcon(p.icon) ? p.icon : undefined, color: isColor(p.color) ? p.color : undefined }
}

/** Params with the look written in; a missing icon or color removes the key (back to the default). */
export function paramsWithLook<P extends object>(params: P | null | undefined, look: FolderLook): P {
  const out = { ...(params || {}) } as Record<string, unknown>
  if (look.icon) out.icon = look.icon
  else delete out.icon
  if (look.color) out.color = look.color
  else delete out.color
  return out as P
}
