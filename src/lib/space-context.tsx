import { createContext, useContext } from 'react'
import type { SpaceRecord, SpaceRole } from './types'

/** The open space as the feed sees it: my role and whether other people are in it. */
export interface SpaceView {
  space?: SpaceRecord
  role: SpaceRole
  meId?: number
  meName?: string
  /** More than one member: show authors, hide nothing else. */
  shared: boolean
}

export const SpaceContext = createContext<SpaceView>({ role: 'owner', shared: false })
export const useSpaceView = () => useContext(SpaceContext)
