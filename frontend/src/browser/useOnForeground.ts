import { useEffect, useRef } from 'react'

/** Runs `callback` when the visible page regains focus, reconnects or is shown again. */
export function useOnForeground(callback: () => void) {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  }, [callback])
  useEffect(() => {
    const returned = () => {
      if (document.visibilityState !== 'hidden') {
        latest.current()
      }
    }

    addEventListener('focus', returned)
    addEventListener('online', returned)
    document.addEventListener('visibilitychange', returned)
    return () => {
      removeEventListener('focus', returned)
      removeEventListener('online', returned)
      document.removeEventListener('visibilitychange', returned)
    }
  }, [])
}
