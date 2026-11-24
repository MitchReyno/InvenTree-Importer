import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reportDirty, type DirtyReport, type UnsavedChange } from '#/navigation/unsaved-changes'

/**
 * A clean sibling cannot clear another mounted form's navigation protection. Each source's named
 * changes are passed up with the report, so the batch can list them.
 */
export function useDirtySources(onDirtyChange?: DirtyReport) {
  // Each dirty source with the changes it names, which may be none.
  const sources = useRef(new Map<string, readonly UnsavedChange[]>())
  const [, setVersion] = useState(0)
  // A replaced parent callback hears the current state; only unmount reports clean.
  const notify = useRef(onDirtyChange)
  useEffect(() => {
    notify.current = onDirtyChange
    reportDirty(onDirtyChange, sources.current.size > 0, namedChanges(sources.current))
  }, [onDirtyChange])
  useEffect(() => () => notify.current?.(false), [])
  const report = useCallback(
    (source: string, value: boolean, changes: readonly UnsavedChange[] = []) => {
      const before = sources.current.has(source)
      if (value) {
        sources.current.set(source, changes)
      } else {
        sources.current.delete(source)
      }
      if (before !== value) {
        setVersion((version) => version + 1)
      }
      reportDirty(notify.current, sources.current.size > 0, namedChanges(sources.current))
    },
    [],
  )
  const callbacks = useMemo(() => new Map<string, DirtyReport>(), [])
  const forSource = useCallback(
    (source: string) => {
      let callback = callbacks.get(source)
      if (!callback) {
        callback = (value, changes) => report(source, value, changes)
        callbacks.set(source, callback)
      }
      return callback
    },
    [callbacks, report],
  )
  const isDirty = useCallback(
    (source?: string) =>
      source === undefined ? sources.current.size > 0 : sources.current.has(source),
    [],
  )

  const hasOtherSources = useCallback(
    (...allowed: string[]) =>
      [...sources.current.keys()].some((source) => !allowed.includes(source)),
    [],
  )

  return { dirty: sources.current.size > 0, isDirty, forSource, hasOtherSources }
}

function namedChanges(sources: Map<string, readonly UnsavedChange[]>) {
  return [...sources.values()].flat()
}
