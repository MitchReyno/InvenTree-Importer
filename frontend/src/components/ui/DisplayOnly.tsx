import type { ReactNode } from 'react'
import { VisuallyHidden } from './VisuallyHidden'

/**
 * Restored content shown before its own reads land: inert, so nothing inside can be focused,
 * pressed or edited, and announced as updating.
 */
export function DisplayOnly({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Outside the inert subtree, so assistive technology can reach it. */}
      <VisuallyHidden role="status">Showing saved data while it updates</VisuallyHidden>
      <div inert aria-busy="true" data-display-only="true">
        {children}
      </div>
    </>
  )
}
