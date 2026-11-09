import type { BatchAttentionDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useCachedData } from '#/queries/useCachedData'

type CachedBatch = { title: string; revision: string }

/**
 * The open batch's title and attention counts, from the reads the batch screen already holds.
 * Never fetches, so the header adds no requests and agrees with the batch's own tabs; a read that
 * has since failed gives nothing rather than stale counts.
 */
export function useCachedBatchReads(batchId: string | undefined) {
  const scope = useServerScope()
  const batch = useCachedData<CachedBatch>(
    batchId ? serverQueryKey(scope, 'capture', batchId) : undefined,
  )
  const revision = batch?.revision
  const attention = useCachedData<BatchAttentionDto>(
    batchId && revision ? serverQueryKey(scope, 'attention', batchId, revision) : undefined,
  )

  return { title: batch?.title, attention }
}
