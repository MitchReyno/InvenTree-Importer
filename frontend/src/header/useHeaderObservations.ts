import { useEffect, useRef, useState } from 'react'
import { useIntakeConnection } from '#/context/IntakeConnection'
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
  const intake = useIntakeConnection()
  const recoveredAt = intake?.recoveredAt ?? 0
  const confirmedRecovery = useRef(0)
  const baseline = useRef<{ recovery: number; observedAt: string | null } | null>(null)
  const connection = useQuery({
    queryKey: serverQueryKey(scope, 'header-connection'),
    queryFn: async () => {
      if (recoveredAt <= confirmedRecovery.current) {
        const result = await client.connection()
        assertHeaderScope(result, scope)
        return result
      }
      // Compare two server timestamps. Browser and target clocks need not agree.
      if (baseline.current?.recovery !== recoveredAt) {
        const initial = await client.connection()
        assertHeaderScope(initial, scope)
        baseline.current = { recovery: recoveredAt, observedAt: initial.target.observed_at }
      }
      const before = baseline.current.observedAt
      const result = await client.checkConnection()
      assertHeaderScope(result, scope)
      if (
        result.target.state !== 'unconfigured' &&
        (!result.target.observed_at || result.target.observed_at === before)
      ) {
        return { ...result, target: unobserved(result.target) }
      }
      confirmedRecovery.current = recoveredAt
      return result
    },
    enabled: intake?.contact !== 'disconnected',
    refetchInterval: (query) => {
      const target = query.state.data?.target
      if (
        recoveredAt > confirmedRecovery.current ||
        query.state.status === 'error' ||
        !target ||
        target.state === 'unknown' ||
        (target.state === 'unavailable' && target.failure_code !== 'unauthorized')
      ) {
        return 4000
      }
      return HEADER_POLL_MS
    },
  })
  const confirm = intake?.confirm
  useEffect(() => {
    if (connection.isError) {
      confirm?.()
    }
  }, [confirm, connection.errorUpdatedAt, connection.isError])
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
    if (intake?.contact !== 'disconnected') {
      void connection.refetch({ cancelRefetch: false })
    }
    void work.refetch()
  })
  // A confirmed command's source stands until a read made after it reports one.
  const reported = readCredential(connection.data?.target)
  const readSince = confirmed !== undefined && connection.dataUpdatedAt >= confirmed.at
  const credential = (readSince ? reported : undefined) ?? confirmed?.value ?? reported

  const disconnected = intake?.contact === 'disconnected'
  const scopedUnavailable =
    disconnected ||
    intake?.contact === 'degraded' ||
    Boolean(intake?.bootstrapFailed) ||
    connection.isError ||
    connection.fetchStatus === 'paused'
  const target =
    connection.isFetchedAfterMount &&
    intake?.contact !== 'checking' &&
    recoveredAt <= confirmedRecovery.current
      ? connection.data?.target
      : undefined
  return {
    now,
    disconnected,
    scopedUnavailable,
    target,
    connection,
    work,
    check,
    credential,
    replaceToken,
    revertToken,
    intake,
  }
}
