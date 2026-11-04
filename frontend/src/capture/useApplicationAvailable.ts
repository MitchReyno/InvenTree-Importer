import { useEffect, useState } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../queries/scope'

/**
 * Observes the header's shared connection read without starting another probe loop, plus the
 * browser's offline hint. Only evidence of failure disables editing; no observation is not one.
 */
export function useApplicationAvailable() {
  const scope = useServerScope()
  const connection = useQuery({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: skipToken,
  })
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false)

    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return !offline && connection.status !== 'error' && connection.fetchStatus !== 'paused'
}
