import { useEffect, useState } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../queries/scope'

/** Matches the header's connection freshness contract. */
export const APPLICATION_FRESH_MS = 60_000
const CLOCK_MS = 5_000

/**
 * Editing needs a fresh scoped observation of the application API: the header's shared
 * connection read or this batch's own capture read, succeeded within 60 seconds and not now
 * failing. No probe loop is added. A suspended page becomes stale until a read refreshes.
 */
export function useApplicationAvailable(captureUpdatedAt: number, captureFailing: boolean) {
  const scope = useServerScope()
  const connection = useQuery({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: skipToken,
  })
  const [now, setNow] = useState(Date.now)
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  useEffect(() => {
    const update = () => {
      setOffline(navigator.onLine === false)
      setNow(Date.now())
    }

    const clock = setInterval(update, CLOCK_MS)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(clock)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const connectionFailing = connection.status === 'error' || connection.fetchStatus === 'paused'
  const observedAt = Math.max(connection.dataUpdatedAt, captureUpdatedAt)
  const fresh = observedAt > 0 && now - observedAt <= APPLICATION_FRESH_MS
  return !offline && !connectionFailing && !captureFailing && fresh
}
