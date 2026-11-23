import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { freshReads } from './fresh-reads'

/** How current a tracked read must be: `shown` allows a refresh in flight; `settled` does not. */
export type AfterHint = 'shown' | 'settled'

/**
 * Whether one tracked read holds a successful result whose request started after the last live
 * hint. `settled` also needs no newer read in flight, for a command checked at dispatch.
 */
export function readAfterHint(client: QueryClient, key: QueryKey, level: AfterHint) {
  const state = client.getQueryState(key)
  const registry = freshReads(client)
  if (state?.status !== 'success' || state.fetchStatus === 'paused') {
    return false
  }
  if (level === 'settled') {
    // Any tracked request verifies it, so the order to compare from is the start.
    return registry.settledAfterHint(key, 0)
  }

  return registry.adoptedAfterHint(key)
}

/** `readAfterHint` for one read, following the cache and live hints; false without a key. */
export function useReadAfterHint(key: QueryKey | undefined, level: AfterHint) {
  const client = useQueryClient()
  const subscribe = useCallback(
    (notify: () => void) => {
      const stopCache = client.getQueryCache().subscribe(notify)
      const stopHints = freshReads(client).subscribe(notify)
      return () => {
        stopCache()
        stopHints()
      }
    },
    [client],
  )

  return useSyncExternalStore(subscribe, () => (key ? readAfterHint(client, key, level) : false))
}

/** Whether read `a`'s adopted request started after read `b`'s; false while `a` has none. */
export function useReadNewer(a: QueryKey | undefined, b: QueryKey) {
  const client = useQueryClient()
  const subscribe = useCallback(
    (notify: () => void) => freshReads(client).subscribe(notify),
    [client],
  )

  return useSyncExternalStore(subscribe, () => {
    const registry = freshReads(client)
    const own = a ? registry.adoptedOrder(a) : undefined
    const other = registry.adoptedOrder(b)
    return own !== undefined && (other === undefined || own > other)
  })
}
