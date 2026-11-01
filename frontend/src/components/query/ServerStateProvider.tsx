import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { createServerQueryClient } from '../../queries/client'
import { ServerScopeContext, type ServerScope } from '../../queries/scope'

interface Props {
  children: ReactNode
  scope?: ServerScope
  client?: QueryClient
}

/** Mount a separate keyed provider for each private actor/target/context lifetime. */
export function ServerStateProvider({ children, scope, client }: Props) {
  const [ownedClient] = useState(createServerQueryClient)
  const queryClient = client ?? ownedClient

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
