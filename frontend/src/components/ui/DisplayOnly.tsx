import type { ReactNode } from 'react'
import { VisuallyHidden } from './VisuallyHidden'

/**
 * Restored content shown before its own reads land: inert, so nothing inside can be focused,
 * pressed or edited, and announced as updating.
 */
export function DisplayOnly({ children }: { children: ReactNode }) {
  return (
    <div inert aria-busy="true" data-display-only="true">
      <VisuallyHidden role="status">Showing saved data while it updates</VisuallyHidden>
      {children}
    </div>
  )
}
