import { useEffect, useState } from 'react'
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

/** A sign-in change the card shows until a read asked for after it lands. */
type Settling = { at: number; state?: Exclude<ProviderState, 'unknown'> }

type SettlingByProvider = Partial<Record<AgentProviderId, Settling>>

const NONE_SETTLING: SettlingByProvider = {}

type StatusSource = { providerStatus: () => Promise<ProviderStatusDto> }

/** A status read, with when it was asked for: an answer can't be newer than its request. */
type StatusRead = { status: ProviderStatusDto; requestedAt: number }

async function readStatus(client: StatusSource): Promise<StatusRead> {
  const requestedAt = Date.now()
  const status = await client.providerStatus()
  return { status, requestedAt }
}

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
    queryFn: () => readStatus(client),
    retry: false,
  })
  // Sign-in changes still settling are kept with the status read, not this section, so a change
  // made just before leaving still holds when Settings › Agents opens again.
  const settleKey = serverQueryKey(scope, 'provider-status', 'settling')
  const settlingQuery = useQuery({
    queryKey: settleKey,
    queryFn: () => NONE_SETTLING,
    enabled: false,
    initialData: NONE_SETTLING,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const settling = settlingQuery.data
  const [checking, setChecking] = useState(false)

  // Syncs a timer per settling change: once its window has passed, the status is read again.
  // Leaving drops the timers; opening the section again schedules what is still due.
  useEffect(() => {
    // A window that passed while the section was closed needs nothing: opening it reads afresh.
    const due = Object.values(settling)
      .map((change) => change.at + SETTLE_MS - Date.now())
      .filter((wait) => wait > 0)
    const timers = due.map((wait) => setTimeout(() => void readAfresh(), wait))
    return () => timers.forEach(clearTimeout)
    // readAfresh reads through the query client; only the settling changes start timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling])

  /**
   * A new read. A read still running may have been asked for before a change settled, so it is
   * cancelled rather than joined.
   */
  async function readAfresh() {
    await queryClient.cancelQueries({ queryKey, exact: true })
    await queryClient.refetchQueries({ queryKey, exact: true })
  }

  /** Check again: one place to ask, so a forced refresh can be added to the read. */
  async function checkAgain() {
    setChecking(true)
    try {
      await readAfresh()
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
    queryClient.setQueryData<SettlingByProvider>(settleKey, (current = NONE_SETTLING) => ({
      ...current,
      [provider]: { at, state },
    }))
  }

  // A read asked for before a change settled may report the VM before it; a failed read reports
  // nothing about it either way.
  const answeredAt = Math.max(query.data?.requestedAt ?? 0, query.errorUpdatedAt)

  function cardStatus(provider: AgentProviderId): ProviderCardStatus {
    const answer = query.data?.status[provider]
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
