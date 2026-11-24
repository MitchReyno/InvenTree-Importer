import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
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
  const base = { filter: options.filter, ...day, ...(options.batchId ? { batch_id: options.batchId } : {}) }
  const enabled = options.enabled ?? true
  // Cursors of the pages loaded after the first; a new filter or batch starts from the newest.
  const listKey = `${options.filter}:${options.batchId ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; cursors: string[] }>({
    key: listKey,
    cursors: [],
  })
  const cursors = loaded.key === listKey ? loaded.cursors : []
  const fresh = useFreshRead<AgentSessionListDto>({
    queryKey: sessionListKey(scope, base),
    queryFn: () => read(base),
    enabled,
    refetchInterval: options.refetchInterval,
  })
  const later = useQueries({
    queries: cursors.map((before) => ({
      queryKey: sessionListKey(scope, { ...base, before }),
      queryFn: () => read({ ...base, before }),
      enabled,
      refetchInterval: options.refetchInterval,
    })),
  })
  const pages = [fresh.query.data, ...later.map((page) => page.data)]
  const last = later.at(-1)
  const lastPage = cursors.length ? last?.data : fresh.query.data
  const next = lastPage?.next_before ?? null

  function loadMore() {
    if (next === null || cursors.includes(next)) {
      return
    }
    setLoaded({ key: listKey, cursors: [...cursors, next] })
  }

  return {
    fresh,
    list: fresh.query.data,
    rows: mergedRows(pages),
    canLoadMore: next !== null,
    loadingMore: last?.isPending === true,
    moreFailed: last?.isError === true,
    loadMore,
  }
}
