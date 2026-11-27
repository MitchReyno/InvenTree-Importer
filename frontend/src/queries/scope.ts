export interface ServerScope {
  origin: string
  actorId: string
  targetId: string
  targetContextId: string
}

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
