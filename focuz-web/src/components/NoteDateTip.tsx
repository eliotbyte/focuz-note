import type { ReactNode } from 'react'
import { formatExactDateTime } from '../lib/time'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * Hover on a note's relative time ("5 minutes ago") to see its exact date. The date is the note's
 * date (defaults to the creation time); the creation time is listed too when it differs.
 */
export default function NoteDateTip({ note, extra, children }: { note: { date?: string; createdAt: string }; extra?: string; children: ReactNode }) {
  const date = note.date ?? note.createdAt
  const createdDiffers = Math.abs(new Date(date).getTime() - new Date(note.createdAt).getTime()) > 60_000
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          <div>Date: {formatExactDateTime(date)}</div>
          {createdDiffers && <div className="text-secondary">Created: {formatExactDateTime(note.createdAt)}</div>}
          {extra && <div className="text-secondary">{extra}</div>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
