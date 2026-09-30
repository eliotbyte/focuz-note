import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Pill({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn('pill', className)} {...props} />
}
