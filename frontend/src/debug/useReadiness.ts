import { useMemo } from 'react'
import { intakeClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { useServerScope } from '#/context'

/** The local setup read; it runs only while `enabled`, so nothing is read until it is shown. */
export function useReadiness(enabled: boolean) {
  const scope = useServerScope()
  const client = useMemo(() => intakeClient(scope.origin), [scope.origin])

  return useFreshRead({
    queryKey: serverQueryKey(scope, 'readiness'),
    queryFn: () => client.readiness(),
    enabled,
  })
}
