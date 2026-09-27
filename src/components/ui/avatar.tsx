import { useLiveQuery } from 'dexie-react-hooks'
import { hueOf, initials } from '../../lib/useSpaces'
import { cn } from '../../lib/cn'
import { getKV } from '../../lib/db'
import { MEMBERS_KV } from '../../lib/sync-pull'
import { ME_KV, type Me } from '../../lib/spaces-api'
import { avatarPath, usePicture } from '../../lib/pictures'
import type { SpaceMember } from '../../lib/types'

/** A picture when there is one, otherwise initials on a colour picked from the name. */
export function Avatar({ name, size = 28, shape = 'round', className, title, src }: { name: string; size?: number; shape?: 'round' | 'square'; className?: string; title?: string; src?: string }) {
  const h = hueOf(name)
  return (
    <span
      aria-hidden
      title={title}
      className={cn('avatar', shape === 'square' ? 'avatar-square' : 'avatar-round', src ? 'avatar-has-img' : '', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), ['--h' as string]: h }}
    >
      {src ? <img src={src} alt="" className="avatar-img" draggable={false} /> : initials(name)}
    </span>
  )
}

/** Who a person is and which picture version they have: mine from /me, others from shared-space members. */
function usePersonPicture(userId: number | null | undefined, name: string): { id: number | null; version: number } {
  return useLiveQuery(async () => {
    const me = await getKV<Me>(ME_KV)
    if (me && (userId != null ? me.id === userId : me.username === name)) return { id: me.id, version: me.avatarVersion ?? 0 }
    const members = (await getKV<SpaceMember[]>(MEMBERS_KV, [])) ?? []
    const m = members.find(x => (userId != null ? x.userId === userId : x.username === name))
    return { id: m?.userId ?? userId ?? null, version: m?.avatarVersion ?? 0 }
  }, [userId, name]) ?? { id: null, version: 0 }
}

/** A person's avatar (their picture if they set one). Found by id, or by username when the id is unknown. */
export function PersonAvatar({ userId, name, size = 28, className, title }: { userId?: number | null; name: string; size?: number; className?: string; title?: string }) {
  const p = usePersonPicture(userId, name)
  const src = usePicture(p.id != null ? avatarPath(p.id) : null, p.version)
  return <Avatar name={name} size={size} className={className} title={title} src={src} />
}
