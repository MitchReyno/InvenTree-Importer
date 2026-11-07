import { skipToken, useQuery } from '@tanstack/react-query'
import type { BatchAttentionDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '../queries/scope'

type CachedBatch = { title: string; revision: string }

/**
 * The open batch's title and attention counts, from the reads the batch screen already holds.
 * Never fetches, so the header adds no requests and agrees with the batch's own tabs.
 */
export function useCachedBatchReads(batchId: string | undefined) {
  const scope = useServerScope()
  const batch = useQuery<CachedBatch>({
    queryKey: serverQueryKey(scope, 'capture', batchId ?? ''),
    queryFn: skipToken,
  })
  const revision = batch.data?.revision
  const attention = useQuery<BatchAttentionDto>({
    queryKey: serverQueryKey(scope, 'attention', batchId ?? '', revision ?? 'unknown'),
    queryFn: skipToken,
  })

  return batchId
    ? { title: batch.data?.title, attention: revision ? attention.data : undefined }
    : { title: undefined, attention: undefined }
}
