import { useState } from 'react'
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import type { AgentProviderId, ProviderStatusDto } from '@invimport/contracts'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import {
  checkingPill,
  confirmedPill,
  providerPill,
  READ_FAILED,
  TIMED_OUT,
  type ProviderPill,
  type ProviderState,
} from './provider-status'

/** How often the status is read while the VM's Codex check runs. */
export const POLL_MS = 1000

/**
 * How long a run of reads waits for a Codex check: the VM stops a check after 10 s, so this is
 * that and a margin. The first read asked for after it ends the run.
 */
export const POLL_LIMIT_MS = 15_000

const CHECKING_CODEX = 'Checking Codex sign-in…'

/** What a provider card shows of its sign-in. */
export type ProviderCardStatus = {
  pill: ProviderPill
  /** When the Claude token was saved, where the VM recorded it. */
  savedAt: string | null
  /** When the VM last checked Codex's sign-in; Claude is read on every request. */
  checkedAt: string | null
  /** A check the card is waiting for is running. */
  refreshing: boolean
  /** What a screen reader hears of the check: that it runs, then its outcome. */
  announcement: string
  /** When the provider's latest session couldn't sign in, if it was the latest. */
  failedAt: string | null
}

type KnownState = Exclude<ProviderState, 'unknown'>

/**
 * A sign-in change the card shows until the run of reads its own fresh read starts has an
 * answer. `freshAt` identifies that run; the entry stays as history for late dialog answers.
 */
type Settling = { at: number; state?: KnownState; freshAt: number }

type SettlingByProvider = Partial<Record<AgentProviderId, Settling>>

const NONE_SETTLING: SettlingByProvider = {}

type StatusSource = {
  providerStatus: (options?: { refresh?: boolean }) => Promise<ProviderStatusDto>
}

/**
 * The reads waiting for one Codex check: started by a fresh read, or by a first read that found
 * a check running. `from` identifies it; `until` is its monotonic deadline.
 */
type Run = { from: number; until: number; ended: boolean; expired: boolean }

/** A status read, with when it was asked for, since an answer can't be newer than its request. */
type StatusRead = { status: ProviderStatusDto; requestedAt: number; run?: Run }

/** Whether the VM has no Codex check running that the card waits for. */
function codexSettled(status: ProviderStatusDto) {
  const codex = status.codex
  if (codex.state === 'unknown') {
    return codex.reason !== 'checking'
  }
  return !codex.refreshing
}

/** The run this read belongs to: a fresh read's own, the one it carries on, or a new one. */
function runFor(
  status: ProviderStatusDto,
  previous: StatusRead | undefined,
  asked: { at: number; monotonic: number; freshAt?: number },
): Run | undefined {
  const settled = codexSettled(status)
  const carried = previous?.run && !previous.run.ended ? previous.run : undefined
  if (asked.freshAt !== undefined) {
    const until = asked.monotonic + POLL_LIMIT_MS
    return { from: asked.freshAt, until, ended: settled, expired: false }
  }
  if (carried) {
    const expired = asked.monotonic >= carried.until
    return { ...carried, ended: settled || expired, expired }
  }
  if (settled) {
    return undefined
  }
  return { from: asked.at, until: asked.monotonic + POLL_LIMIT_MS, ended: false, expired: false }
}

async function readStatus(
  client: StatusSource,
  previous: StatusRead | undefined,
  freshAt?: number,
): Promise<StatusRead> {
  const asked = { at: Date.now(), monotonic: performance.now(), freshAt }
  const refresh = freshAt !== undefined
  const status = await client.providerStatus(refresh ? { refresh: true } : undefined)
  return { status, requestedAt: asked.at, run: runFor(status, previous, asked) }
}

/** Reads again each second while a run waits; a failed read ends it. */
function pollInterval(query: Query<StatusRead>) {
  const run = query.state.data?.run
  if (query.state.status === 'error' || !run || run.ended) {
    return false
  }
  return POLL_MS
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
    queryFn: () => readStatus(client, queryClient.getQueryData<StatusRead>(queryKey)),
    retry: false,
    refetchInterval: pollInterval,
  })
  // Sign-in changes are kept with the status read, not this section, so a change made just
  // before leaving still holds when Settings › Agents opens again.
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

  /**
   * A fresh read, identified by `freshAt`: the server skips its reused read and asks Codex for a
   * new check. A read still running may have been asked for before a change, so it is cancelled
   * rather than joined. It runs through the query client, so it completes after leaving too.
   */
  async function readAfresh(freshAt: number) {
    await queryClient.cancelQueries({ queryKey, exact: true })
    await queryClient
      .fetchQuery({
        queryKey,
        queryFn: () => readStatus(client, queryClient.getQueryData<StatusRead>(queryKey), freshAt),
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
      await readAfresh(Date.now())
    } finally {
      setChecking(false)
    }
  }

  /**
   * A sign-in change: the card shows `state`, what the VM just confirmed, or "Checking…" when
   * the outcome is the VM's to report, until its own fresh read and the run it starts answer.
   */
  function signInChanged(
    provider: AgentProviderId,
    state?: KnownState,
    { late = false }: { late?: boolean } = {},
  ) {
    const at = Date.now()
    queryClient.setQueryData<SettlingByProvider>(settleKey, (current = NONE_SETTLING) => {
      // A late answer to an older change restarts the wait but keeps a newer confirmation.
      const kept = late ? current[provider]?.state : state
      return { ...current, [provider]: { at, state: kept, freshAt: at } }
    })
    void readAfresh(at)
  }

  const read = query.data
  const waiting = read?.run !== undefined && !read.run.ended && !query.isError

  /**
   * A change is shown until a read asked for at or after its fresh read answers and, for Codex,
   * the run that fresh read started ends. A later Check again starts another run, which never
   * brings the change back; a failed read ends the wait.
   */
  function changeShown(provider: AgentProviderId) {
    const change = settling[provider]
    if (!change) {
      return undefined
    }
    if (query.isError && query.errorUpdatedAt >= change.freshAt) {
      return undefined
    }
    if (!read || read.requestedAt < change.freshAt) {
      return change
    }
    const ownRunWaiting = provider === 'codex' && waiting && read.run?.from === change.freshAt
    return ownRunWaiting ? change : undefined
  }

  /** Codex's outcome once a run of reads ends: what the VM said, or that the check timed out. */
  function codexPill(answer: ProviderStatusDto['codex']) {
    const unfinished = answer.state === 'unknown' && answer.reason === 'checking'
    return unfinished && read?.run?.expired ? TIMED_OUT : providerPill(answer)
  }

  function cardStatus(provider: AgentProviderId): ProviderCardStatus {
    const answer = read?.status[provider]
    const failedAt = answer?.last_sign_in_failure?.failed_at ?? null
    const savedAt = answer?.state === 'saved' ? answer.saved_at : null
    // Only Codex has a check that runs in the VM; Claude is read on every request.
    const checks = provider === 'codex'
    const quiet = { savedAt: null, checkedAt: null, announcement: '', failedAt }
    const change = changeShown(provider)
    if (change) {
      const pill = change.state ? confirmedPill(change.state) : checkingPill()
      const refreshing = checks && change.state !== undefined
      return { ...quiet, pill, refreshing, announcement: refreshing ? CHECKING_CODEX : '' }
    }
    if (query.isError || !answer) {
      const pill = query.isError && !query.isFetching ? READ_FAILED : checkingPill()
      return { ...quiet, pill, refreshing: false, failedAt: query.isError ? null : failedAt }
    }
    const pill = checks ? codexPill(answer as ProviderStatusDto['codex']) : providerPill(answer)
    const known = answer.state !== 'unknown'
    const checkedAt = checks && known ? answer.checked_at : null
    // Check again keeps the known pill and says beside it that a check runs.
    const refreshing = checks && known && ((checking && query.isFetching) || waiting)
    return {
      pill,
      savedAt,
      checkedAt,
      refreshing,
      announcement: announce(checks, refreshing, pill),
      failedAt,
    }
  }

  /** Codex's check, as a screen reader hears it: that it runs, then the outcome of the run. */
  function announce(checks: boolean, refreshing: boolean, pill: ProviderPill) {
    if (!checks) {
      return ''
    }
    if (refreshing || waiting) {
      return CHECKING_CODEX
    }
    return read?.run?.ended ? `Codex checked: ${pill.word}` : ''
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
