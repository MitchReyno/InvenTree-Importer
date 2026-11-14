import { useEffect, useRef } from 'react'

/** Whether the component is still mounted, for an async result that arrives after it leaves. */
export function useMountedRef() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}
