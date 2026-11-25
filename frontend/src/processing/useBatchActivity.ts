import { useQuery } from '@tanstack/react-query'
import { serverQueryKey } from '#/queries/scope'
import { useRetainedPollInterval, useServerScope } from '#/context'
import type { ProcessingClient } from './types'

/**
 * Processing's recent activity across the batch's sessions, under the batch's Processing key so
 * the live hints and polls that refresh Processing refresh it too. Off without a session read.
 */
export function useBatchActivity(read: ProcessingClient['batchActivity'], batchId: string) {
  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()
  return useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId, 'activity'),
    queryFn: () => read!(batchId),
    enabled: read !== undefined,
    refetchInterval: pollInterval,
  })
}
