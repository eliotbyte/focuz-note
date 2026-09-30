import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import * as React from 'react'
import { cn } from '../../lib/cn'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
export const ContextMenuPortal = ContextMenuPrimitive.Portal
export const ContextMenuGroup = ContextMenuPrimitive.Group

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn('dropdown-menu z-50 min-w-40', className)}
        {...props}
      />
    </ContextMenuPortal>
  )
})

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(function ContextMenuItem({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn('dropdown-item text-sm text-secondary outline-none', className)}
      {...props}
    />
  )
})

