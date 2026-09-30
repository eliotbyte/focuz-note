import * as AccordionPrimitive from '@radix-ui/react-accordion'
import * as React from 'react'
import { cn } from '../../lib/cn'

export const Accordion = AccordionPrimitive.Root
export const AccordionItem = AccordionPrimitive.Item
export const AccordionHeader = AccordionPrimitive.Header

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(function AccordionTrigger({ className, ...props }, ref) {
  return (
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn('w-full text-left outline-none', className)}
      {...props}
    />
  )
})

export const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(function AccordionContent({ className, ...props }, ref) {
  return (
    <AccordionPrimitive.Content
      ref={ref}
      className={cn('overflow-hidden', className)}
      {...props}
    />
  )
})

