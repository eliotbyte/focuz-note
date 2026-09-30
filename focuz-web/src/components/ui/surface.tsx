import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Surface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface', className)} {...props} />
}

export function SurfaceNoPad({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface-nopad', className)} {...props} />
}
