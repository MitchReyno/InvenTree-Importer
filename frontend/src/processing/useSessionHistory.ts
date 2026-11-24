import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey } from '#/queries/scope'
import { useReportRefreshing, useRetainedPollInterval, useServerScope } from '#/context'
import { appendOlderPage, mergeNewestPage, type HeldHistory } from './session-history'
import type { ProcessingClient } from './types'

type HistoryRead = NonNullable<ProcessingClient['history']>

/**
 * The drawer's history: only the newest page, re-read on every live hint or poll. Under the
 * batch's Processing key, so the same invalidations reach it.
 */
export function useNewestHistory(read: HistoryRead, batchId: string, jobId: string) {
  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId, 'history', jobId, 'newest'),
    queryFn: () => read(batchId, jobId),
    refetchInterval: pollInterval,
  })
  useReportRefreshing(query.data !== undefined && query.isFetching)
  return query
}

/**
 * The session page's history: each read of the newest page merges into the entries already held,
 * which live in the cache so an answer's remount keeps the older pages loaded.
 */
export function useSessionPageHistory(read: HistoryRead, batchId: string, jobId: string) {
  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'processing', batchId, 'history', jobId, 'page')
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const page = await read(batchId, jobId)
      // Merged with what is held when the page lands, so an older page loaded meanwhile stays.
      return mergeNewestPage(queryClient.getQueryData<HeldHistory>(queryKey), page)
    },
    refetchInterval: pollInterval,
  })
  useReportRefreshing(query.data !== undefined && query.isFetching)

  async function loadOlder() {
    const cursor = queryClient.getQueryData<HeldHistory>(queryKey)?.before
    if (cursor === undefined || older === 'loading') {
      return
    }
    setOlder('loading')
    try {
      const page = await read(batchId, jobId, cursor)
      queryClient.setQueryData<HeldHistory>(queryKey, (held) =>
        held ? appendOlderPage(held, page, cursor) : held,
      )
      setOlder('idle')
    } catch {
      setOlder('failed')
    }
  }

  return { query, loadOlder, older }
}
