import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BatchAttentionDto } from '@invimport/contracts'
import { freshReads } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'
import { useServerScope, useRetainedPollInterval } from '#/context'

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
  const queryClient = useQueryClient()
  const pollInterval = useRetainedPollInterval()
  const queryKey = serverQueryKey(scope, 'attention', batchId, revision ?? 'unknown')

  return useQuery({
    queryKey,
    // Numbered, so the masthead can tell counts read since the last live hint.
    queryFn: freshReads(queryClient).track<BatchAttentionDto>(queryKey, () =>
      client!.read(batchId),
    ),
    enabled: client !== undefined,
    refetchInterval: pollInterval,
    placeholderData: (previous) => previous,
  })
}
