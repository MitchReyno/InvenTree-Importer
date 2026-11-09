import { skipToken, useQuery } from '@tanstack/react-query'
import type { ConnectionStatusDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { safeTargetNavigation } from './observations'

/** The InvenTree web address from the header's connection read; this never reads it again. */
export function useTargetNavigation() {
  const scope = useServerScope()
  const connection = useQuery<ConnectionStatusDto>({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: skipToken,
  })
  return safeTargetNavigation(connection.data?.target?.navigation_url)
}
