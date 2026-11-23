import { useQuery } from '@tanstack/react-query'
import { useFreshRead } from '#/queries/useFreshRead'
import type { BatchRecordsDto, RecordExistingValuesDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { useServerScope } from '#/context'

export type RecordsClient = {
  read: (batchId: string) => Promise<BatchRecordsDto>
  /** Mapped records' current values in the target; absent where no target is configured. */
  existing?: (batchId: string) => Promise<RecordExistingValuesDto>
}

/**
 * Records at the batch revision; an accepted edit moves the revision, so the read is fresh. The
 * previous revision's records stand in until the new revision's read arrives.
 */
export function useBatchRecords(
  client: RecordsClient | undefined,
  batchId: string,
  revision: string | undefined,
) {
  const scope = useServerScope()
  return useFreshRead({
    queryKey: serverQueryKey(scope, 'records', batchId, revision ?? 'unknown'),
    queryFn: () => client!.read(batchId),
    enabled: client !== undefined && revision !== undefined,
    keepPrevious: true,
  })
}

/** The target's current values for mapped records, read only while a mapped record is open. */
export function useExistingValues(
  client: RecordsClient | undefined,
  batchId: string,
  revision: string | undefined,
  enabled: boolean,
) {
  const scope = useServerScope()
  return useQuery({
    queryKey: serverQueryKey(scope, 'records-existing', batchId, revision ?? 'unknown'),
    queryFn: () => client!.existing!(batchId),
    enabled: enabled && client?.existing !== undefined && revision !== undefined,
    // The target changes outside this app, so a minute-old read is read again.
    staleTime: 60_000,
    retry: false,
  })
}
