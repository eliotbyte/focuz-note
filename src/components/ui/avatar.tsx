import { hueOf, initials } from '../../lib/useSpaces'
import { cn } from '../../lib/cn'

/** Initials on a colour picked from the name. shape: round for people, squircle for spaces. */
export function Avatar({ name, size = 28, shape = 'round', className, title }: { name: string; size?: number; shape?: 'round' | 'square'; className?: string; title?: string }) {
  const h = hueOf(name)
  return (
    <span
      aria-hidden
      title={title}
      className={cn('avatar', shape === 'square' ? 'avatar-square' : 'avatar-round', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), background: `hsl(${h} 55% 42%)` }}
    >
      {initials(name)}
    </span>
  )
}
