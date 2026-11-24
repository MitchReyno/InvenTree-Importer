import type { Pool } from 'pg'
import type {
  ClaudeProviderStatusDto,
  CodexProviderStatusDto,
  ProviderSignInFailureDto,
  ProviderStatusDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { isSessionProfile } from '#/processing/session-policy.ts'
import type { CodexBridgeStatus } from './shared-vm/coordinator.ts'
import {
  requestProviderStatus,
  type ClaudeDisplayStatus,
  type DisplayProviderStatuses,
} from './provider-status-channel.ts'
import { lastSignInFailures } from './sign-in-failures.ts'

/** A read of the guest is reused this long, so repeated page loads don't each reach the VM. */
export const PROVIDER_STATUS_CACHE_MS = 5000

export interface GuestStatusRead {
  /** Undefined when the session worker didn't answer. */
  statuses: DisplayProviderStatuses | undefined
  readAt: Date
}

/**
 * Where the route's guest status comes from; the session worker unless a test supplies one.
 * `refresh` is Check again: it skips the reused read and asks Codex for a fresh check.
 */
export type GuestStatusSource = (refresh: boolean) => Promise<GuestStatusRead>

const NOT_CONFIGURED: DisplayProviderStatuses = {
  claude: { state: 'unknown', reason: 'not_configured' },
  codex: { state: 'unknown', reason: 'not_configured' },
}

/** Whether Codex has no check running that a reader may be waiting for. */
function codexSettled(statuses: DisplayProviderStatuses | undefined) {
  const codex = statuses?.codex
  if (!codex) {
    return true
  }
  if (codex.state === 'unknown') {
    return codex.reason !== 'checking'
  }
  return !codex.refreshing
}

/**
 * Asks the session worker, at most once per cache window, with concurrent callers sharing a read.
 * Check again asks at once, sharing only another Check again in flight, and its answer is reused
 * like any other. An answer whose Codex check hasn't finished is never reused, so a client
 * waiting for that check reads the worker each time. A profile that runs no agent sessions has no
 * worker to ask.
 */
export function workerStatusSource(
  pool: Pool,
  config: ProcessingConfig,
  cacheMs = PROVIDER_STATUS_CACHE_MS,
  now = () => new Date(),
  // Times the reuse window, so a wall-clock step back never keeps a read past it.
  monotonicNow = () => performance.now(),
): GuestStatusSource {
  let cached: { read: Promise<GuestStatusRead>; until: number } | undefined
  let forced: Promise<GuestStatusRead> | undefined

  const read = async (refresh: boolean): Promise<GuestStatusRead> => {
    if (!config.profileId || !isSessionProfile(config.profileId)) {
      return { statuses: NOT_CONFIGURED, readAt: now() }
    }
    const statuses = await requestProviderStatus(pool, config, undefined, refresh)
    return { statuses, readAt: now() }
  }

  /** Makes `pending` the reused read once it settles; a failed read is never reused. */
  const remember = (pending: Promise<GuestStatusRead>) => {
    cached = { read: pending, until: Number.POSITIVE_INFINITY }
    void pending.then(
      (answer) => {
        if (cached?.read !== pending) {
          return
        }
        if (codexSettled(answer.statuses)) {
          cached = { read: pending, until: monotonicNow() + cacheMs }
        } else {
          cached = undefined
        }
      },
      () => {
        if (cached?.read === pending) {
          cached = undefined
        }
      },
    )
  }

  return (refresh) => {
    if (refresh) {
      if (!forced) {
        const pending = read(true)

        const settle = () => {
          forced = undefined
        }

        forced = pending
        void pending.then(settle, settle)
        remember(pending)
      }
      return forced
    }
    const time = monotonicNow()
    if (!cached || time >= cached.until) {
      remember(read(false))
    }
    return cached!.read
  }
}

function claudeView(
  status: ClaudeDisplayStatus | undefined,
  failure: ProviderSignInFailureDto | null,
): ClaudeProviderStatusDto {
  if (!status) {
    return { state: 'unknown', reason: 'worker_unavailable', last_sign_in_failure: failure }
  }
  switch (status.state) {
    case 'saved':
      return {
        state: 'saved',
        saved_at: status.saved_at,
        checked_at: status.checked_at,
        last_sign_in_failure: failure,
      }
    case 'not_saved':
      return { state: 'not_saved', checked_at: status.checked_at, last_sign_in_failure: failure }
    case 'unknown':
      return { state: 'unknown', reason: status.reason, last_sign_in_failure: failure }
  }
}

function codexView(
  status: CodexBridgeStatus | undefined,
  failure: ProviderSignInFailureDto | null,
): CodexProviderStatusDto {
  if (!status) {
    return { state: 'unknown', reason: 'worker_unavailable', last_sign_in_failure: failure }
  }
  if (status.state === 'unknown') {
    return { state: 'unknown', reason: status.reason, last_sign_in_failure: failure }
  }
  return {
    state: status.state,
    checked_at: status.checked_at,
    refreshing: status.refreshing,
    last_sign_in_failure: failure,
  }
}

/**
 * Each provider's sign-in status with its last-session line. The credential revision the guest
 * reports never reaches the API: saving needs the protected management read.
 */
export async function readProviderStatus(
  pool: Pool,
  config: ProcessingConfig,
  guest: GuestStatusSource,
  refresh = false,
): Promise<ProviderStatusDto> {
  const [read, failures] = await Promise.all([guest(refresh), lastSignInFailures(pool, config)])
  return {
    claude: claudeView(read.statuses?.claude, failures.claude),
    codex: codexView(read.statuses?.codex, failures.codex),
    read_at: read.readAt.toISOString(),
  }
}
