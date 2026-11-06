import { useQuery } from '@tanstack/react-query'
import type { BatchRecordsDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '../queries/scope'

export type RecordsClient = { read: (batchId: string) => Promise<BatchRecordsDto> }

/** Records at the batch revision; an accepted edit moves the revision, so the read is fresh. */
export function useBatchRecords(
  client: RecordsClient | undefined,
  batchId: string,
  revision: string | undefined,
) {
  const scope = useServerScope()
  return useQuery({
    queryKey: serverQueryKey(scope, 'records', batchId, revision ?? 'unknown'),
    queryFn: () => client!.read(batchId),
    enabled: client !== undefined && revision !== undefined,
    placeholderData: (previous) => previous,
  })
}
