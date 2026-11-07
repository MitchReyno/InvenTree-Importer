import { useCallback, useSyncExternalStore } from 'react'
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * Another screen's settled read, taken from the cache without an observer, so that screen's fetch
 * options stay in force. Data is withheld, not shown as current, once its read fails or pauses, or
 * once it is invalidated with no refresh under way (its owning screen is closed).
 */
export function useCachedData<T>(queryKey: QueryKey | undefined): T | undefined {
  const cache = useQueryClient().getQueryCache()
  const hash = queryKey ? hashKey(queryKey) : undefined
  const subscribe = useCallback((notify: () => void) => cache.subscribe(notify), [cache])
  const read = useCallback(() => {
    const state = hash ? cache.get(hash)?.state : undefined
    const current =
      state?.status === 'success' &&
      state.fetchStatus !== 'paused' &&
      !(state.isInvalidated && state.fetchStatus === 'idle')
    return current ? (state.data as T) : undefined
  }, [cache, hash])

  return useSyncExternalStore(subscribe, read)
}
