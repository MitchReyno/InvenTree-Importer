import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectionStatusDto, InventoryCredentialDto } from '@invimport/contracts'
import { freshReads } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'
import { useNow } from '#/browser/useNow'
import { useOnForeground } from '#/browser/useOnForeground'
import { assertHeaderScope, HEADER_POLL_MS, unobserved } from './observations'
import type { HeaderClient } from './types'
// Leaf modules, not the barrel: the barrel's HeaderObservationsContext imports this hook.
import { useRetainedPollInterval } from '#/context/LiveUpdatesContext'
import { useServerScope } from '#/context/ServerScopeContext'

/** The token source a read reported, when it reported one. */
function readCredential(target: ConnectionStatusDto['target'] | undefined) {
  if (!target?.credential_source) {
    return undefined
  }
  return {
    credential_source: target.credential_source,
    credential_saved_at: target.credential_saved_at ?? null,
  } satisfies InventoryCredentialDto
}

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
  const workKey = serverQueryKey(scope, 'header-work', batchId ?? 'all')
  const work = useQuery({
    queryKey: workKey,
    // Numbered, so Resume can tell a read that started after the last live hint.
    queryFn: freshReads(queryClient).track(workKey, async () => {
      const result = await client.work(batchId ? { batch_id: batchId } : {})
      assertHeaderScope(result, scope)
      return result
    }),
    refetchInterval: poll === false ? HEADER_POLL_MS : poll,
  })
  // Counts token commands, so a check sent before one can't describe the token after it.
  const tokenCommands = useRef(0)
  const [confirmed, setConfirmed] = useState<{ value: InventoryCredentialDto; at: number }>()
  // One shared check, so the server menu and Settings can't both send one; its result replaces
  // the connection read everywhere.
  const check = useMutation({
    mutationFn: async () => {
      const sentAfter = tokenCommands.current
      const result = await client.checkConnection()
      assertHeaderScope(result, scope)
      return { result, sentAfter }
    },
    // A read already running started before the check, so it must not replace the result.
    onSuccess: async ({ result, sentAfter }) => {
      if (sentAfter !== tokenCommands.current) {
        return
      }
      const key = serverQueryKey(scope, 'header-connection')
      await queryClient.cancelQueries({ queryKey: key })
      // A token command may have finished while the cancel was awaited.
      if (sentAfter !== tokenCommands.current) {
        return
      }
      queryClient.setQueryData(key, result)
    },
  })

  /**
   * Sends a token command straight to the server, never through a mutation that would keep the
   * token in a shared cache. Whatever the outcome, the server may have a new observation, so
   * the connection is read again.
   */
  async function tokenCommand(send: () => Promise<InventoryCredentialDto>) {
    const key = serverQueryKey(scope, 'header-connection')
    try {
      const receipt = await send()
      // At once, before any await, so no check sent before this can still publish.
      tokenCommands.current += 1
      // Kept apart from the read, so it shows even when no read has succeeded yet.
      setConfirmed({ value: receipt, at: Date.now() })
      await queryClient.cancelQueries({ queryKey: key })
      // The confirmed source shows at once; the old token's observation no longer applies.
      queryClient.setQueryData<ConnectionStatusDto>(key, (old) =>
        old ? { ...old, target: { ...unobserved(old.target), ...receipt } } : old,
      )
      return receipt
    } finally {
      tokenCommands.current += 1
      await queryClient.cancelQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  function replaceToken(token: string) {
    return tokenCommand(() => client.replaceInventoryCredential({ token }))
  }

  function revertToken() {
    return tokenCommand(() => client.revertInventoryCredential())
  }

  useOnForeground(() => {
    void connection.refetch()
    void work.refetch()
  })
  // A confirmed command's source stands until a read made after it reports one.
  const reported = readCredential(connection.data?.target)
  const readSince = confirmed !== undefined && connection.dataUpdatedAt >= confirmed.at
  const credential = (readSince ? reported : undefined) ?? confirmed?.value ?? reported

  return { now, connection, work, check, credential, replaceToken, revertToken }
}
