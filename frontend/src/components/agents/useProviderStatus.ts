import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentProviderId, ProviderStatusDto } from '@invimport/contracts'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import {
  checkingPill,
  confirmedPill,
  providerPill,
  READ_FAILED,
  type ProviderPill,
  type ProviderState,
} from './provider-status'

/**
 * How long after a sign-in change a status read may still be one the VM made before it: the
 * server reuses a guest read for 5 s, and a read takes up to 2 s, plus a margin.
 */
export const SETTLE_MS = 8000

/** What a provider card shows of its sign-in. */
export type ProviderCardStatus = {
  pill: ProviderPill
  /** When the Claude token was saved, where the VM recorded it. */
  savedAt: string | null
  /** When the provider's latest session couldn't sign in, if it was the latest. */
  failedAt: string | null
}

/** A sign-in change the card shows until a read made after it lands. */
type Settling = { at: number; state?: Exclude<ProviderState, 'unknown'> }

type StatusSource = { providerStatus: () => Promise<ProviderStatusDto> }

/**
 * The read-only sign-in status of both providers: read when Settings › Agents opens, on Check
 * again, and after a sign-in change, never with the management key.
 */
export function useProviderStatus(client: StatusSource) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'provider-status')
  const query = useQuery({
    queryKey,
    queryFn: () => client.providerStatus(),
    retry: false,
  })
  const [checking, setChecking] = useState(false)
  const [settling, setSettling] = useState<Partial<Record<AgentProviderId, Settling>>>({})
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  // The reads scheduled after a sign-in change are this section's own; leaving drops them.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  function read() {
    return queryClient.refetchQueries({ queryKey, exact: true })
  }

  /** Check again: one place to ask, so a forced refresh can be added to the read. */
  async function checkAgain() {
    setChecking(true)
    try {
      await read()
    } finally {
      setChecking(false)
    }
  }

  /**
   * A sign-in change: the card shows `state`, what the VM just confirmed, or "Checking…" when
   * the outcome is the VM's to report, until a read made after the change lands.
   */
  function signInChanged(provider: AgentProviderId, state?: Exclude<ProviderState, 'unknown'>) {
    const at = Date.now()
    setSettling((current) => ({ ...current, [provider]: { at, state } }))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      void read()
    }, SETTLE_MS)
    timers.current.add(timer)
  }

  const answeredAt = Math.max(query.dataUpdatedAt, query.errorUpdatedAt)

  function cardStatus(provider: AgentProviderId): ProviderCardStatus {
    const answer = query.data?.[provider]
    const failedAt = answer?.last_sign_in_failure?.failed_at ?? null
    const savedAt = answer?.state === 'saved' ? answer.saved_at : null
    const change = settling[provider]
    if (change && answeredAt < change.at + SETTLE_MS) {
      const pill = change.state ? confirmedPill(change.state) : checkingPill()
      return { pill, savedAt: null, failedAt }
    }
    if (query.isFetching && (checking || !answer)) {
      return { pill: checkingPill(), savedAt: null, failedAt }
    }
    if (query.isError || !answer) {
      return { pill: query.isError ? READ_FAILED : checkingPill(), savedAt: null, failedAt: null }
    }
    return { pill: providerPill(answer), savedAt, failedAt }
  }

  return {
    claude: cardStatus('claude'),
    codex: cardStatus('codex'),
    checking: checking && query.isFetching,
    checkAgain,
    signInChanged,
  }
}

export type ProviderStatusState = ReturnType<typeof useProviderStatus>
