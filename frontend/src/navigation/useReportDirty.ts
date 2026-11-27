import { useEffect, useRef } from 'react'
import { reportDirty, type DirtyReport, type UnsavedChange } from './unsaved-changes'

const NONE: readonly UnsavedChange[] = []

/**
 * Releases the navigation guard when an editor unmounts, and gives a replaced parent callback
 * the current state, with its named changes, rather than a premature clean. Changes are still
 * reported from input events.
 */
export function useReportDirty(
  dirty: boolean,
  onDirtyChange?: DirtyReport,
  changes: readonly UnsavedChange[] = NONE,
) {
  const current = useRef({ dirty, changes })
  const notify = useRef(onDirtyChange)
  useEffect(() => {
    current.current = { dirty, changes }
  }, [dirty, changes])
  useEffect(() => {
    notify.current = onDirtyChange
    reportDirty(onDirtyChange, current.current.dirty, current.current.changes)
  }, [onDirtyChange])
  useEffect(() => () => notify.current?.(false), [])
}
