import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey } from '#/queries/scope'
import { useNow } from '#/browser/useNow'
import { useOnForeground } from '#/browser/useOnForeground'
import { assertHeaderScope, HEADER_POLL_MS } from './observations'
import type { HeaderClient } from './types'
// Leaf modules, not the barrel: the barrel's HeaderObservationsContext imports this hook.
import { useRetainedPollInterval } from '#/context/LiveUpdatesContext'
import { useServerScope } from '#/context/ServerScopeContext'

export function useHeaderObservations(client: HeaderClient, batchId?: string) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const now = useNow(1000)
  const poll = useRetainedPollInterval()
  const connection = useQuery({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: async () => {
      const result = await client.connection()
      assertHeaderScope(result, scope)
      return result
    },
    refetchInterval: HEADER_POLL_MS,
  })
  const work = useQuery({
    queryKey: serverQueryKey(scope, 'header-work', batchId ?? 'all'),
    queryFn: async () => {
      const result = await client.work(batchId ? { batch_id: batchId } : {})
      assertHeaderScope(result, scope)
      return result
    },
    refetchInterval: poll === false ? HEADER_POLL_MS : poll,
  })
  // One shared check, so the server menu and Settings can't both send one; its result replaces
  // the connection read everywhere.
  const check = useMutation({
    mutationFn: async () => {
      const result = await client.checkConnection()
      assertHeaderScope(result, scope)
      return result
    },
    // A read already running started before the check, so it must not replace the result.
    onSuccess: async (result) => {
      const key = serverQueryKey(scope, 'header-connection')
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData(key, result)
    },
  })

  // The server forgets its observation when the token changes; read the new one at once.
  async function observeNewToken() {
    const key = serverQueryKey(scope, 'header-connection')
    await queryClient.cancelQueries({ queryKey: key })
    await queryClient.invalidateQueries({ queryKey: key })
  }

  const replaceToken = useMutation({
    mutationFn: (token: string) => client.replaceInventoryCredential({ token }),
    onSuccess: observeNewToken,
  })
  const revertToken = useMutation({
    mutationFn: () => client.revertInventoryCredential(),
    onSuccess: observeNewToken,
  })
  useOnForeground(() => {
    void connection.refetch()
    void work.refetch()
  })
  return { now, connection, work, check, replaceToken, revertToken }
}
