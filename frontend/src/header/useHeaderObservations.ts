import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'
import { assertHeaderScope, HEADER_POLL_MS } from './observations'
import type { HeaderClient } from './types'

export function useHeaderObservations(client: HeaderClient, batchId?: string) {
  const scope = useServerScope()
  const poll = useRetainedPollInterval()
  const [now, setNow] = useState(Date.now)
  const connection = useQuery({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: async () => {
      const result = await client.connection()
      assertHeaderScope(result, scope)
      return result
    },
    refetchInterval: HEADER_POLL_MS,
  })
  const work = useQuery({
    queryKey: serverQueryKey(scope, 'header-work', batchId ?? 'all'),
    queryFn: async () => {
      const result = await client.work(batchId ? { batch_id: batchId } : {})
      assertHeaderScope(result, scope)
      return result
    },
    refetchInterval: poll === false ? HEADER_POLL_MS : poll,
  })
  const refreshConnection = connection.refetch
  const refreshWork = work.refetch
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000)

    function foreground() {
      setNow(Date.now())
      if (document.visibilityState !== 'hidden') {
        void refreshConnection()
        void refreshWork()
      }
    }

    window.addEventListener('focus', foreground)
    window.addEventListener('online', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      clearInterval(clock)
      window.removeEventListener('focus', foreground)
      window.removeEventListener('online', foreground)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [refreshConnection, refreshWork])
  return { now, connection, work }
}
