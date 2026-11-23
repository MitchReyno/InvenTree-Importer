import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { createServerQueryClient } from '#/queries/client'
import { type ServerScope } from '#/queries/scope'
import { snapshots } from '#/queries/snapshots'
import { freshReads } from '#/queries/fresh-reads'
import { ServerScopeContext } from '#/context'

interface Props {
  children: ReactNode
  scope?: ServerScope
  client?: QueryClient
}

/** Mount a separate keyed provider for each private actor/target/context lifetime. */
export function ServerStateProvider({ children, scope, client }: Props) {
  const [ownedClient] = useState(createServerQueryClient)
  const queryClient = client ?? ownedClient
  // The fresh-read registry belongs to the client: made with it, so it follows the cache before
  // any read starts, and detached when the client's lifetime ends.
  const [registry] = useState(() => freshReads(queryClient))
  // A layout Effect runs before TanStack's passive subscription can start the first read.
  useLayoutEffect(() => {
    registry.attach()
    return () => registry.detach()
  }, [registry])

  // Session storage keeps snapshots for this scope only: the next scope deletes the others when it
  // starts, and a scope that ends drops its waiting writes. Replaying this Effect keeps them.
  useEffect(() => {
    if (!scope) {
      return
    }
    snapshots.prune(scope)
    return () => snapshots.dropPendingWrites(scope)
  }, [scope])

  useEffect(() => {
    return () => {
      // This cancels cache publication. Existing client deadlines still bound non-abortable I/O.
      void queryClient.cancelQueries()
      queryClient.clear()
    }
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <ServerScopeContext.Provider value={scope}>{children}</ServerScopeContext.Provider>
    </QueryClientProvider>
  )
}
