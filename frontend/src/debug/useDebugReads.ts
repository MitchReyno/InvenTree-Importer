import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { notifyManager, useQueryClient, type Query } from '@tanstack/react-query'

export type DebugRead = {
  /** The read's resource path, e.g. `capture/<batch>`, without the server scope. */
  name: string
  status: 'pending' | 'error' | 'success'
  fetching: boolean
  paused: boolean
  /** When its data last arrived, in epoch milliseconds, or null before any. */
  dataUpdatedAt: number | null
}

// serverQueryKey puts 'intake' and the four scope identities before the resource path.
const SCOPE_PARTS = 5

function readName(query: Query) {
  const key = query.queryKey
  const resource = key[0] === 'intake' ? key.slice(SCOPE_PARTS) : key

  return resource.map(String).join('/')
}

function describe(query: Query): DebugRead {
  const { status, fetchStatus, dataUpdatedAt } = query.state

  return {
    name: readName(query),
    status,
    fetching: fetchStatus === 'fetching',
    paused: fetchStatus === 'paused',
    dataUpdatedAt: dataUpdatedAt > 0 ? dataUpdatedAt : null,
  }
}

/**
 * The reads mounted on the current screen (queries with an observer) and their state, from the
 * cache the screen already fills. Starts no request.
 */
export function useDebugReads(): DebugRead[] {
  const cache = useQueryClient().getQueryCache()
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notifyManager.batchCalls(notify)),
    [cache],
  )
  // A string snapshot keeps useSyncExternalStore stable between unrelated cache events.
  const snapshot = useCallback(
    () =>
      JSON.stringify(
        cache
          .getAll()
          .filter((query) => query.getObserversCount() > 0)
          .map(describe)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    [cache],
  )
  const serialized = useSyncExternalStore(subscribe, snapshot)

  return useMemo(() => JSON.parse(serialized) as DebugRead[], [serialized])
}
