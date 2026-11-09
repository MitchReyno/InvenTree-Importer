import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useNow } from '#/browser/useNow'
import { useOnForeground } from '#/browser/useOnForeground'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'
import { assertHeaderScope, HEADER_POLL_MS } from './observations'
import type { HeaderClient } from './types'

export function useHeaderObservations(client: HeaderClient, batchId?: string) {
  const scope = useServerScope()
  const now = useNow(1000)
  const poll = useRetainedPollInterval()
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
  useOnForeground(() => {
    void connection.refetch()
    void work.refetch()
  })
  return { now, connection, work }
}
