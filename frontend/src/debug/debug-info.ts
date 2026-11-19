import type { ReadinessDto } from '@invimport/contracts'
import type { UpdateHealth } from '#/context/LiveUpdatesContext'

export type DebugInfoInput = {
  route: string
  /** The last readiness read, `unavailable` when it failed, or undefined before one finished. */
  readiness: ReadinessDto | 'unavailable' | undefined
  health: UpdateHealth
  /** When the summary is taken, in epoch milliseconds. */
  now: number
}

function readinessLines(readiness: DebugInfoInput['readiness']) {
  if (readiness === undefined) {
    return ['Readiness: not checked']
  }
  if (readiness === 'unavailable') {
    return ['Readiness: unavailable']
  }

  return [
    `API version: ${readiness.api_version}`,
    `Deployment: ${readiness.deployment}`,
    `Media: ${readiness.media}`,
    `Web access: ${readiness.web}`,
    `Inventory execution: ${readiness.apply}`,
  ]
}

function liveUpdatesLine(health: UpdateHealth, now: number) {
  if (health.observedAt === null) {
    return `Live updates: ${health.state}, no frame yet`
  }
  const ageSeconds = Math.max(0, Math.round((now - health.observedAt) / 1000))
  const truncated = health.truncated ? ', stream truncated' : ''

  return `Live updates: ${health.state}, last frame ${ageSeconds} s ago${truncated}`
}

/**
 * The plain-text summary Copy debug info puts on the clipboard. It names only the build, route,
 * readiness and live-update state, never credentials, tokens or record content.
 */
export function debugInfoText({ route, readiness, health, now }: DebugInfoInput) {
  return [
    'Bench Intake debug info',
    `Taken: ${new Date(now).toISOString()}`,
    'Build: development',
    `Route: ${route || '(batches)'}`,
    ...readinessLines(readiness),
    liveUpdatesLine(health, now),
  ].join('\n')
}
