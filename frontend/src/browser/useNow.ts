import { useEffect, useState } from 'react'

/**
 * The current time for freshness checks. Besides the interval it advances at once when the page
 * returns to the foreground, so a resumed tab sees an expired observation without waiting a tick.
 */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())

    const clock = setInterval(tick, intervalMs)
    addEventListener('focus', tick)
    addEventListener('online', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(clock)
      removeEventListener('focus', tick)
      removeEventListener('online', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])
  return now
}
