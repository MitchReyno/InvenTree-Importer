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

/** How often the status is read while the VM's Codex check runs. */
export const POLL_MS = 1000

/**
 * How long a run of reads waits for a Codex check: the VM stops a check after 10 s, so this is
 * that and a margin.
 */
export const POLL_LIMIT_MS = 15_000

/** What a provider card shows of its sign-in. */
export type ProviderCardStatus = {
  pill: ProviderPill
  /** When the Claude token was saved, where the VM recorded it. */
  savedAt: string | null
  /** When the VM last checked Codex's sign-in; Claude is read on every request. */
  checkedAt: string | null
  /** A check the card is waiting for is running. */
  refreshing: boolean
  /** When the provider's latest session couldn't sign in, if it was the latest. */
  failedAt: string | null
}

type KnownState = Exclude<ProviderState, 'unknown'>

/** A sign-in change the card shows until a read asked for after its fresh read lands. */
type Settling = { at: number; state?: KnownState }

type SettlingState = {
  changes: Partial<Record<AgentProviderId, Settling>>
  /** When the newest fresh read (Check again, or one a change asked for) was asked for. */
  freshAt: number
}

const NONE_SETTLING: SettlingState = { changes: {}, freshAt: 0 }

type StatusSource = {
  providerStatus: (options?: { refresh?: boolean }) => Promise<ProviderStatusDto>
}

/**
 * A status read, with when it was asked for, since an answer can't be newer than its request,
 * and when the reads waiting for an unfinished Codex check started.
 */
type StatusRead = { status: ProviderStatusDto; requestedAt: number; waitingSince?: number }

/** Whether the VM has no Codex check running that the card waits for. */
function codexSettled(status: ProviderStatusDto) {
  const codex = status.codex
  if (codex.state === 'unknown') {
    return codex.reason !== 'checking'
  }
  return !codex.refreshing
}

/** Whether a run of reads waiting for a Codex check is still within its limit. */
function stillWaiting(read: StatusRead | undefined) {
  if (read?.waitingSince === undefined) {
    return false
  }
  return read.requestedAt - read.waitingSince < POLL_LIMIT_MS
}

async function readStatus(
  client: StatusSource,
  refresh: boolean,
  previous: StatusRead | undefined,
): Promise<StatusRead> {
  const requestedAt = Date.now()
  const status = await client.providerStatus(refresh ? { refresh: true } : undefined)
  if (codexSettled(status)) {
    return { status, requestedAt }
  }
  // A fresh read starts a new run of reads; a read after it carries on the same run.
  const waitingSince = refresh ? requestedAt : (previous?.waitingSince ?? requestedAt)
  return { status, requestedAt, waitingSince }
}

/**
 * The read-only sign-in status of both providers: read when Settings › Agents opens, freshly on
 * Check again and after a sign-in change, and again each second while the VM's Codex check runs,
 * never with the management key.
 */
export function useProviderStatus(client: StatusSource) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'provider-status')
  const query = useQuery({
    queryKey,
    queryFn: () => readStatus(client, false, queryClient.getQueryData<StatusRead>(queryKey)),
    retry: false,
    refetchInterval: (current) => (stillWaiting(current.state.data) ? POLL_MS : false),
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

  // Syncs with the settling changes kept in the query cache: a change asks for its fresh read
  // itself, but one recorded while the section was closed (a late dialog answer) is read now.
  useEffect(() => {
    const unasked = Object.values(settling.changes).some((change) => settling.freshAt < change.at)
    if (unasked) {
      void readAfresh()
    }
    // readAfresh reads through the query client; only the settling changes call for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling])

  /**
   * A fresh read: the server skips its reused read and asks Codex for a new check. A read still
   * running may have been asked for before a change, so it is cancelled rather than joined.
   */
  async function readAfresh() {
    const freshAt = Date.now()
    queryClient.setQueryData<SettlingState>(settleKey, (current = NONE_SETTLING) => ({
      ...current,
      freshAt,
    }))
    await queryClient.cancelQueries({ queryKey, exact: true })
    await queryClient
      .fetchQuery({
        queryKey,
        queryFn: () => readStatus(client, true, queryClient.getQueryData<StatusRead>(queryKey)),
        retry: false,
      })
      .catch(() => {
        // The query keeps the failure, which the cards show.
      })
  }

  /** Check again: a fresh read, then the reads until the VM's check lands. */
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
   * the outcome is the VM's to report, until a read asked for after its fresh read lands.
   */
  function signInChanged(
    provider: AgentProviderId,
    state?: KnownState,
    { late = false }: { late?: boolean } = {},
  ) {
    const at = Date.now()
    queryClient.setQueryData<SettlingState>(settleKey, (current = NONE_SETTLING) => {
      // A late answer to an older change restarts the wait but keeps a newer confirmation.
      const kept = late ? current.changes[provider]?.state : state
      return { ...current, changes: { ...current.changes, [provider]: { at, state: kept } } }
    })
    void readAfresh()
  }

  const read = query.data
  // A failed read reports nothing about a change either way, but ends the wait for it.
  const answeredAt = Math.max(read?.requestedAt ?? 0, query.errorUpdatedAt)
  const waiting = stillWaiting(read)

  /** A change is shown until a read asked for after its fresh read answers, and settles. */
  function changeShown(provider: AgentProviderId) {
    const change = settling.changes[provider]
    if (!change) {
      return undefined
    }
    const answeredAfter = settling.freshAt >= change.at && answeredAt >= settling.freshAt
    const stillChecking = provider === 'codex' && waiting && !query.isError
    return answeredAfter && !stillChecking ? undefined : change
  }

  function cardStatus(provider: AgentProviderId): ProviderCardStatus {
    const answer = read?.status[provider]
    const failedAt = answer?.last_sign_in_failure?.failed_at ?? null
    const savedAt = answer?.state === 'saved' ? answer.saved_at : null
    const none = { savedAt: null, checkedAt: null, failedAt }
    const change = changeShown(provider)
    if (change) {
      const pill = change.state ? confirmedPill(change.state) : checkingPill()
      return { ...none, pill, refreshing: change.state !== undefined }
    }
    if (query.isError || !answer) {
      const pill = query.isError && !query.isFetching ? READ_FAILED : checkingPill()
      return { ...none, pill, refreshing: false, failedAt: query.isError ? null : failedAt }
    }
    const pill = providerPill(answer)
    const known = answer.state !== 'unknown'
    const checkedAt = provider === 'codex' && known ? answer.checked_at : null
    // Check again keeps the known pill and says beside it that a check runs.
    const refreshing =
      known && ((checking && query.isFetching) || (provider === 'codex' && waiting))
    return { pill, savedAt, checkedAt, refreshing, failedAt }
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
