import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import {
  hashKey,
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query'
import { freshReads } from './fresh-reads'

export type FreshPhase = 'empty' | 'cached' | 'refreshing' | 'current' | 'failed'

/** Why a read's commands wait: a read still to land, or one that failed. */
export type FreshReason = 'Updating…' | 'Status unavailable'

export interface FreshReadOptions<T> {
  queryKey: QueryKey
  queryFn: () => Promise<T>
  enabled?: boolean
  refetchInterval?: number | false
  /** A page's own test of the data, such as a matching capture revision, for the `current` phase. */
  current?: (data: T) => boolean
  /** Display-only data restored from session storage; shown while the query has none. */
  restored?: T
  /** Shows the previous key's data while a new key is first read; it never verifies the new key. */
  keepPrevious?: boolean
}

export interface FreshRead<T> {
  query: UseQueryResult<T>
  /** The query's data, else the restored snapshot. */
  data: T | undefined
  /** The data shown is a restored snapshot, not a read made in this tab's session. */
  restored: boolean
  phase: FreshPhase
  /** A read whose request started after this observer mounted is in the cache. */
  verified: boolean
  /** Verified, and not failed or paused. Commands that carry a revision gate on this. */
  commandsReady: boolean
  /** Identifies the verified read shown; it changes with each new one, even of equal data. */
  verifiedRead?: number
  /** Commands ready on a read that started after the last live hint, for commands with no revision. */
  settledAfterHint: boolean
  reason?: FreshReason
  /** The same tests on the cache as it is now, for a check at dispatch. */
  commandsReadyNow: () => boolean
  settledAfterHintNow: () => boolean
  /** `current` checked on the cache now: verified, settled, the shown read, and the page's test. */
  currentNow: () => boolean
}

/**
 * A server read with its freshness. Every caller of a query key goes through this hook, so every
 * request for that key is numbered and only a request this observer saw start can verify it.
 */
export function useFreshRead<T>({
  queryKey,
  queryFn,
  enabled = true,
  refetchInterval,
  current,
  restored,
  keepPrevious = false,
}: FreshReadOptions<T>): FreshRead<T> {
  const client = useQueryClient()
  const registry = freshReads(client)
  const hash = hashKey(queryKey)
  const [observer] = useState(() => Symbol('fresh-read'))
  // The order this observer mounted at, per registry and key; a new key or scope mounts it again.
  const [mount, setMount] = useState<{ registry: unknown; hash: string; order: number } | null>(
    null,
  )
  const mounted = mount?.registry === registry && mount.hash === hash ? mount : null

  // Before TanStack's subscription (a passive effect) starts the mount fetch, so that request
  // starts after this mount order.
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    const order = mounted?.order ?? registry.nextOrder()
    if (!mounted) {
      setMount({ registry, hash, order })
    }
    return registry.observe(queryKey, observer, order)
    // The hash stands for the key, and `mounted` only changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, hash, enabled, observer])

  const query = useQuery({
    queryKey,
    queryFn: registry.track(queryKey, () => queryFn()),
    enabled,
    refetchInterval,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  })
  useSyncExternalStore(
    useCallback((notify) => registry.subscribe(notify), [registry]),
    () => registry.version(),
  )

  const mountOrder = mounted?.order
  const failed = query.isError || query.fetchStatus === 'paused'
  const verified = enabled && registry.verified(queryKey, mountOrder)
  const settledAfterHint = enabled && registry.settledAfterHint(queryKey, mountOrder)
  const data = query.data ?? restored
  const phase = freshPhase({
    failed,
    hasData: data !== undefined,
    fetching: query.isFetching,
    current: verified && query.data !== undefined && (current?.(query.data) ?? true),
  })

  const renderedRead = registry.adoptedOrder(queryKey)

  // At dispatch the cache must still hold the read this render showed: a newer one may have
  // changed what the command would act on, so the operator sees it first.
  function readyNow(test: 'verified' | 'afterHint') {
    const state = client.getQueryState(queryKey)
    const healthy =
      state?.status === 'success' &&
      state.fetchStatus !== 'paused' &&
      registry.adoptedOrder(queryKey) === renderedRead
    const proven =
      test === 'verified'
        ? registry.verified(queryKey, mountOrder)
        : registry.settledAfterHint(queryKey, mountOrder)
    return enabled && healthy && proven
  }

  return {
    query,
    data,
    restored: query.data === undefined && restored !== undefined,
    phase,
    verified,
    verifiedRead: verified ? renderedRead : undefined,
    commandsReady: verified && !failed,
    settledAfterHint: settledAfterHint && !failed,
    reason: freshReason(failed, verified),
    commandsReadyNow: () => readyNow('verified'),
    settledAfterHintNow: () => readyNow('afterHint'),
    currentNow: () => {
      const state = client.getQueryState<T>(queryKey)
      if (state?.fetchStatus !== 'idle' || state.data === undefined || !readyNow('verified')) {
        return false
      }
      return current?.(state.data) ?? true
    },
  }
}

function freshPhase({
  failed,
  hasData,
  fetching,
  current,
}: {
  failed: boolean
  hasData: boolean
  fetching: boolean
  current: boolean
}): FreshPhase {
  if (failed) {
    return 'failed'
  }
  if (!hasData) {
    return 'empty'
  }
  if (fetching) {
    return 'refreshing'
  }
  return current ? 'current' : 'cached'
}

function freshReason(failed: boolean, verified: boolean): FreshReason | undefined {
  if (failed) {
    return 'Status unavailable'
  }
  return verified ? undefined : 'Updating…'
}
