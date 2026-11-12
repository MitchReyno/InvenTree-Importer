import { createContext, useContext } from 'react'
import type { ServerScope } from '../queries/scope'

export const ServerScopeContext = createContext<ServerScope | undefined>(undefined)

export function useServerScope() {
  const scope = useContext(ServerScopeContext)
  if (!scope) {
    throw new Error('server_scope_required')
  }

  return scope
}
