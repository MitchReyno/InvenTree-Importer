import type { ConnectionStatusDto, HeaderWorkDto } from '@invimport/contracts'
import type { ServerScope } from '../queries/scope'

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

export function targetSummary(
  target: ConnectionStatusDto['target'] | undefined,
  unavailable: boolean,
  now: number,
) {
  if (unavailable) {
    return 'InvenTree unavailable'
  }
  if (!target) {
    return 'Reading connection…'
  }
  if (target.state === 'unconfigured') {
    return 'InvenTree target unconfigured'
  }
  if (!target.observed_at || target.freshness === 'unobserved') {
    return 'InvenTree status unknown'
  }
  if (target.freshness === 'stale' || !observationFresh(target.observed_at, now)) {
    return 'InvenTree status stale'
  }
  if (target.state === 'reachable') {
    const safeUrl = safeTargetNavigation(target.navigation_url)
    if (safeUrl) {
      return new URL(safeUrl).hostname
    }
    return 'InvenTree connected'
  }
  if (target.state === 'unavailable') {
    return 'InvenTree unavailable'
  }
  return 'InvenTree status unknown'
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

export function workflowSummary(
  value: HeaderWorkDto | undefined,
  item: HeaderWorkItem | undefined,
  unavailable: boolean,
  now: number,
) {
  if (unavailable) {
    return 'Workflow unavailable'
  }
  if (!value) {
    return 'Reading workflow…'
  }
  if (!observationFresh(value.observed_at, now)) {
    return 'Workflow status stale'
  }
  if (item) {
    if (item.kind === 'processing' && item.occupies_lane) {
      return `Processing in progress · ${item.stage}`
    }
    if (item.state === 'running' || item.state === 'stopping') {
      return `${item.kind === 'import' ? 'Import' : 'Processing'} in progress · ${item.stage}`
    }
    if (
      [
        'failed',
        'interrupted',
        'waiting_for_user',
        'waiting_for_login',
        'recovery_required',
        'settled_incomplete',
      ].includes(item.state)
    ) {
      return `Needs attention · ${item.stage}`
    }
    if (item.state.startsWith('waiting') || item.state === 'queued') {
      return `Work queued · ${item.stage}`
    }
    return `Retained work · ${item.state.replaceAll('_', ' ')}`
  }
  if (value.lane_occupied) {
    return 'Processing lane occupied'
  }
  if (value.active_sessions.length) {
    return 'Agent work queued'
  }
  if (value.work_truncated || value.sessions_truncated) {
    return 'Partial workflow status'
  }
  return 'Idle'
}
