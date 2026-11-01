import { createContext, useContext } from 'react'

export interface ServerScope {
  origin: string
  actorId: string
  targetId: string
  targetContextId: string
}

export const ServerScopeContext = createContext<ServerScope | undefined>(undefined)

export function serverQueryKey(scope: ServerScope, ...resourceIds: string[]) {
  return [
    'intake',
    scope.origin,
    scope.actorId,
    scope.targetId,
    scope.targetContextId,
    ...resourceIds,
  ] as const
}

export function serverScopeIdentity(scope: ServerScope) {
  return JSON.stringify(serverQueryKey(scope))
}

export function useServerScope() {
  const scope = useContext(ServerScopeContext)
  if (!scope) {
    throw new Error('server_scope_required')
  }

  return scope
}
