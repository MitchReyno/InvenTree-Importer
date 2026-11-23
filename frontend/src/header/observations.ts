import type { ConnectionStatusDto, HeaderWorkDto } from '@invimport/contracts'
import type { ServerScope } from '#/queries/scope'

export const HEADER_POLL_MS = 30_000
export const HEADER_FRESH_MS = 60_000

export function assertHeaderScope(
  value: { actor_id: string; target_id: string; target_context_id: string },
  scope: ServerScope,
) {
  if (
    value.actor_id !== scope.actorId ||
    value.target_id !== scope.targetId ||
    value.target_context_id !== scope.targetContextId
  ) {
    throw new Error('header_scope_mismatch')
  }
}

const CLOCK_SKEW_TOLERANCE_MS = 5000

export function timestampFresh(timestamp: number, now: number, maximumAge = HEADER_FRESH_MS) {
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now + CLOCK_SKEW_TOLERANCE_MS &&
    now - timestamp < maximumAge
  )
}

export function observationFresh(at: string | null, now: number) {
  return timestampFresh(at === null ? NaN : Date.parse(at), now)
}

export function safeTargetNavigation(value: string | null | undefined) {
  if (!value) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

export type TargetTone = 'ok' | 'info' | 'warn' | 'bad' | 'muted'

/** Connection text, its tone and a short phone-width word. Stale data is never `ok`. */
export type TargetStatus = { summary: string; tone: TargetTone; short: string }

const UNKNOWN: TargetStatus = {
  summary: 'InvenTree status unknown',
  tone: 'muted',
  short: 'Unknown',
}
const UNAVAILABLE: TargetStatus = {
  summary: 'InvenTree unreachable',
  tone: 'bad',
  short: 'Offline',
}

export function targetStatus(
  target: ConnectionStatusDto['target'] | undefined,
  unavailable: boolean,
  now: number,
): TargetStatus {
  if (unavailable) {
    return UNAVAILABLE
  }
  if (!target) {
    return { summary: 'Reading connection…', tone: 'muted', short: 'Reading…' }
  }
  if (target.state === 'unconfigured') {
    return { summary: 'InvenTree target unconfigured', tone: 'muted', short: 'Not set up' }
  }
  if (!target.observed_at || target.freshness === 'unobserved') {
    return UNKNOWN
  }
  if (target.freshness === 'stale' || !observationFresh(target.observed_at, now)) {
    return { summary: 'InvenTree status stale', tone: 'warn', short: 'Stale' }
  }
  if (target.state === 'reachable' && target.kind === 'owned_test') {
    // The one place the test target is named outside Changes.
    return { summary: 'Test InvenTree', tone: 'info', short: 'Test' }
  }
  if (target.state === 'reachable') {
    const safeUrl = safeTargetNavigation(target.navigation_url)
    if (safeUrl) {
      const hostname = new URL(safeUrl).hostname
      return { summary: hostname, tone: 'ok', short: hostname }
    }
    return { summary: 'InvenTree connected', tone: 'ok', short: 'Connected' }
  }
  if (target.state === 'unavailable' && target.failure_code === 'unauthorized') {
    return { summary: 'InvenTree refused the token', tone: 'bad', short: 'Refused' }
  }
  if (target.state === 'unavailable') {
    return UNAVAILABLE
  }

  return UNKNOWN
}

export function targetSummary(
  target: ConnectionStatusDto['target'] | undefined,
  unavailable: boolean,
  now: number,
) {
  return targetStatus(target, unavailable, now).summary
}

export type HeaderWorkItem = HeaderWorkDto['work'][number]

export function preferredWork(value: HeaderWorkDto | undefined, batchId?: string) {
  const work = value?.work ?? []
  const current = work.filter((item) => item.batch_id === batchId)
  const candidates = current.length ? current : work
  return (
    candidates.find(
      (item) =>
        item.state === 'running' ||
        item.state === 'stopping' ||
        (item.kind === 'processing' && item.occupies_lane),
    ) ??
    candidates.find(
      (item) => !['ready', 'cancelled', 'superseded', 'settled_complete'].includes(item.state),
    ) ??
    candidates[0]
  )
}

/** The target as it stands before any probe with the new token has answered. */
export function unobserved(target: ConnectionStatusDto['target']): ConnectionStatusDto['target'] {
  return {
    ...target,
    state: 'unknown',
    freshness: 'unobserved',
    observed_at: null,
    failure_code: null,
    // The old token's read of the version describes nothing yet.
    version: null,
  }
}
