import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { AgentSessionFilter, AgentSessionListDto } from '@invimport/contracts'
import { useFreshRead } from '#/queries/useFreshRead'
import { useServerScope } from '#/context'
import { localDayBounds, mergedRows, sessionListKey, type SessionListRead } from './session-list'

type Options = {
  filter: AgentSessionFilter
  /** Narrows the list, its counts and totals to one batch. */
  batchId?: string
  enabled?: boolean
  refetchInterval?: number | false
}

/**
 * The session list under one filter: its newest page as a fresh read, so commands can wait on
 * it, and the pages Load more added after it. Each page is re-read with the others, so a live
 * hint refreshes every row shown.
 */
export function useSessionList(read: SessionListRead, options: Options) {
  const scope = useServerScope()
  const day = localDayBounds(new Date())
  const base = {
    filter: options.filter,
    ...day,
    ...(options.batchId ? { batch_id: options.batchId } : {}),
  }
  const enabled = options.enabled ?? true
  const queryClient = useQueryClient()
  // How many pages Load more added after the first; a new filter or batch starts from the newest.
  const listKey = `${options.filter}:${options.batchId ?? ''}`
  const [loaded, setLoaded] = useState({ key: listKey, extra: 0 })
  const extra = loaded.key === listKey ? loaded.extra : 0
  const fresh = useFreshRead<AgentSessionListDto>({
    queryKey: sessionListKey(scope, base),
    queryFn: () => read(base),
    enabled,
    refetchInterval: options.refetchInterval,
    // The chips stay in place while another filter's first read lands.
    keepPrevious: true,
  })
  // Each later page starts after the previous page as last read, never a stored cursor, so a
  // session that moves across a page boundary between reads is never skipped.
  const cursors: string[] = []
  let cursor = fresh.query.isPlaceholderData ? null : (fresh.query.data?.next_before ?? null)
  for (let page = 0; page < extra && cursor !== null; page += 1) {
    cursors.push(cursor)
    const held = queryClient.getQueryData<AgentSessionListDto>(
      sessionListKey(scope, { ...base, before: cursor }),
    )
    cursor = held ? held.next_before : null
  }
  const later = useQueries({
    queries: cursors.map((before) => ({
      queryKey: sessionListKey(scope, { ...base, before }),
      queryFn: () => read({ ...base, before }),
      enabled,
      refetchInterval: options.refetchInterval,
    })),
  })
  const current = !fresh.query.isPlaceholderData
  const pages = current ? [fresh.query.data, ...later.map((page) => page.data)] : []
  const last = later.at(-1)
  const lastPage = cursors.length ? last?.data : fresh.query.data
  const next = current && cursors.length === extra ? (lastPage?.next_before ?? null) : null

  function loadMore() {
    if (next === null) {
      return
    }
    setLoaded({ key: listKey, extra: extra + 1 })
  }

  return {
    fresh,
    /** The selected filter's read; absent while only another filter's read is held. */
    list: current ? fresh.query.data : undefined,
    /** Shown until the selected filter's first read lands, so the chips stay in place. */
    previous: fresh.query.data,
    rows: mergedRows(pages),
    canLoadMore: next !== null,
    loadingMore: last?.isPending === true && !last.isError,
    moreFailed: last?.isError === true && last.data === undefined,
    loadMore,
    /** Reads the page that failed again, from the same place. */
    retryMore: () => void last?.refetch(),
  }
}
