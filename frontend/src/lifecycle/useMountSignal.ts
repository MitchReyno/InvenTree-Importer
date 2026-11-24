import { useCallback, useEffect, useRef } from 'react'

/**
 * The signal of this component's mount, aborted when it unmounts, so a handler's awaited read
 * stops waiting once nothing is left to show its result. Before the mount (never, for a handler)
 * and after it, the signal is already aborted.
 */
export function useMountSignal() {
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const mounted = new AbortController()
    controller.current = mounted
    return () => mounted.abort()
  }, [])

  return useCallback(() => controller.current?.signal ?? AbortSignal.abort(), [])
}
