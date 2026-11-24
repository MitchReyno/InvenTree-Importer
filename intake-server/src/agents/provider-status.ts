import type { Pool } from 'pg'
import type {
  ClaudeProviderStatusDto,
  CodexProviderStatusDto,
  ProviderSignInFailureDto,
  ProviderStatusDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { isSessionProfile } from '#/processing/session-policy.ts'
import type {
  BridgeProviderStatuses,
  ClaudeBridgeStatus,
  CodexBridgeStatus,
} from './shared-vm/coordinator.ts'
import { requestProviderStatus } from './provider-status-channel.ts'
import { lastSignInFailures } from './sign-in-failures.ts'

/** A read of the guest is reused this long, so repeated page loads don't each reach the VM. */
export const PROVIDER_STATUS_CACHE_MS = 5000

export interface GuestStatusRead {
  /** Undefined when the session worker didn't answer. */
  statuses: BridgeProviderStatuses | undefined
  readAt: Date
}

/** Where the route's guest status comes from; the session worker unless a test supplies one. */
export type GuestStatusSource = () => Promise<GuestStatusRead>

const NOT_CONFIGURED: BridgeProviderStatuses = {
  claude: { state: 'unknown', reason: 'not_configured' },
  codex: { state: 'unknown', reason: 'not_configured' },
}

/**
 * Asks the session worker, at most once per cache window, with concurrent callers sharing a read.
 * A profile that runs no agent sessions has no worker to ask.
 */
export function workerStatusSource(
  pool: Pool,
  config: ProcessingConfig,
  cacheMs = PROVIDER_STATUS_CACHE_MS,
  now = () => new Date(),
): GuestStatusSource {
  let cached: { read: Promise<GuestStatusRead>; until: number } | undefined

  const read = async (): Promise<GuestStatusRead> => {
    if (!config.profileId || !isSessionProfile(config.profileId)) {
      return { statuses: NOT_CONFIGURED, readAt: now() }
    }
    const statuses = await requestProviderStatus(pool, config)
    return { statuses, readAt: now() }
  }

  return () => {
    const time = now().getTime()
    if (!cached || time >= cached.until) {
      const pending = read()
      cached = { read: pending, until: Number.POSITIVE_INFINITY }
      void pending.then(
        () => {
          cached = { read: pending, until: now().getTime() + cacheMs }
        },
        () => {
          cached = undefined
        },
      )
    }
    return cached.read
  }
}

function claudeView(
  status: ClaudeBridgeStatus | undefined,
  failure: ProviderSignInFailureDto | null,
): ClaudeProviderStatusDto {
  if (!status) {
    return { state: 'unknown', reason: 'worker_unavailable', last_sign_in_failure: failure }
  }
  switch (status.state) {
    case 'saved':
      return { state: 'saved', saved_at: status.saved_at, last_sign_in_failure: failure }
    case 'not_saved':
      return { state: 'not_saved', last_sign_in_failure: failure }
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
  return { state: status.state, last_sign_in_failure: failure }
}

/**
 * Each provider's sign-in status with its last-session line. The credential revision the guest
 * reports stays here: saving needs the protected management read.
 */
export async function readProviderStatus(
  pool: Pool,
  config: ProcessingConfig,
  guest: GuestStatusSource,
): Promise<ProviderStatusDto> {
  const [read, failures] = await Promise.all([guest(), lastSignInFailures(pool, config)])
  return {
    claude: claudeView(read.statuses?.claude, failures.claude),
    codex: codexView(read.statuses?.codex, failures.codex),
    read_at: read.readAt.toISOString(),
  }
}
