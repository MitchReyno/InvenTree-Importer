import { createContext, useContext, type ReactNode } from 'react'

/**
 * The masthead's condensed status controls (agents status and menu), provided by the app so a
 * batch header's sticky phone row can show them once the masthead has scrolled away.
 */
export const CompactStatusContext = createContext<ReactNode>(null)

export function useCompactStatus() {
  return useContext(CompactStatusContext)
}
