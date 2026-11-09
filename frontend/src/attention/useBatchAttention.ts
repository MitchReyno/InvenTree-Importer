import { useQuery } from '@tanstack/react-query'
import type { BatchAttentionDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'

export type AttentionClient = { read: (batchId: string) => Promise<BatchAttentionDto> }

/**
 * Tab badges and the need-you panel read this one projection, so they never disagree.
 * The batch revision is part of the key, so an accepted edit reads fresh counts.
 */
export function useBatchAttention(
  client: AttentionClient | undefined,
  batchId: string,
  revision: string | undefined,
) {
  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()

  return useQuery({
    queryKey: serverQueryKey(scope, 'attention', batchId, revision ?? 'unknown'),
    queryFn: () => client!.read(batchId),
    enabled: client !== undefined,
    refetchInterval: pollInterval,
    placeholderData: (previous) => previous,
  })
}
