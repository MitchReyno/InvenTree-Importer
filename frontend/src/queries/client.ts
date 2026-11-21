import { QueryClient } from '@tanstack/react-query'

const UNUSED_QUERY_RETENTION_MS = 5 * 60 * 1000
export const RETAINED_POLL_INTERVAL_MS = 2000

/** In-memory read coordination only. Commands keep their explicit domain-owned lifecycle. */
export function createServerQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: UNUSED_QUERY_RETENTION_MS,
        refetchOnMount: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
      mutations: { retry: false },
    },
  })
}
