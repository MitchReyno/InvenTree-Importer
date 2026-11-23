import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { createServerQueryClient } from '#/queries/client'
import { type ServerScope } from '#/queries/scope'
import { snapshots } from '#/queries/snapshots'
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

  // Session storage keeps snapshots for this scope only; another scope's never show, and a scope
  // that ends takes its snapshots and waiting writes with it.
  useEffect(() => {
    if (!scope) {
      return
    }
    snapshots.prune(scope)
    return () => snapshots.dropScope(scope)
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
