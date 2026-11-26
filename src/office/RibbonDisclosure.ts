import { createContext } from 'react'
import type { ReactNode } from 'react'

export const RibbonDisclosure = createContext<{
  collapsed: boolean
  setCollapsed: (value: boolean) => void
  fileBar: ReactNode
} | null>(null)
