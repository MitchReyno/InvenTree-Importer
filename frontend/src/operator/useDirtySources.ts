import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** A clean sibling cannot clear another mounted form's navigation protection. */
export function useDirtySources(onDirtyChange?: (dirty: boolean) => void) {
  const sources = useRef(new Set<string>())
  const [, setVersion] = useState(0)
  const report = useCallback(
    (source: string, value: boolean) => {
      const before = sources.current.has(source)
      if (value) {
        sources.current.add(source)
      } else {
        sources.current.delete(source)
      }
      const next = sources.current.size > 0
      if (before !== value) {
        setVersion((version) => version + 1)
      }
      onDirtyChange?.(next)
    },
    [onDirtyChange],
  )
  const callbacks = useMemo(() => new Map<string, (value: boolean) => void>(), [report])
  const forSource = useCallback(
    (source: string) => {
      let callback = callbacks.get(source)
      if (!callback) {
        callback = (value: boolean) => report(source, value)
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
    (...allowed: string[]) => [...sources.current].some((source) => !allowed.includes(source)),
    [],
  )

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  return { dirty: sources.current.size > 0, isDirty, forSource, hasOtherSources }
}
