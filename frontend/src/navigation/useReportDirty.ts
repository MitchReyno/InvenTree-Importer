import { useEffect, useRef } from 'react'

/**
 * Releases the navigation guard when an editor unmounts, and gives a replaced parent callback
 * the current state rather than a premature clean. Changes are still reported from input events.
 */
export function useReportDirty(dirty: boolean, onDirtyChange?: (dirty: boolean) => void) {
  const current = useRef(dirty)
  const notify = useRef(onDirtyChange)
  useEffect(() => {
    current.current = dirty
  }, [dirty])
  useEffect(() => {
    notify.current = onDirtyChange
    onDirtyChange?.(current.current)
  }, [onDirtyChange])
  useEffect(() => () => notify.current?.(false), [])
}
