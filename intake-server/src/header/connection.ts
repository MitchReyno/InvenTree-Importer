import type { ConnectionStatusDto } from '@invimport/contracts'
import { InventoryTransportError } from '../inventory/transport.ts'
import type { DevConfig } from '../config.ts'

type Binding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId' | 'targetKind'>
type Observation = ConnectionStatusDto['target']
const CACHE_MS = 30000
const STALE_MS = 60000
const DEADLINE_MS = 3000

class ProbeTimeout extends Error {}

export function observationFreshness(
  observedAt: number | null,
  now: number,
): Observation['freshness'] {
  if (observedAt === null) {
    return 'unobserved'
  }
  const age = now - observedAt
  return age < 0 || age >= STALE_MS ? 'stale' : 'fresh'
}

function navigation(origin: string | undefined): URL | null {
  if (!origin || origin.length > 2048 || /\s/.test(origin)) {
    return null
  }
  try {
    const url = new URL(origin)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      url.host.length > 256
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

async function probeResult(
  probe: () => Promise<Response>,
): Promise<Pick<Observation, 'state' | 'failure_code'>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout()), DEADLINE_MS)
  })
  try {
    const response = await Promise.race([probe(), timeout])
    void response.body?.cancel().catch(() => undefined)
    if (response.status >= 300 && response.status < 400) {
      return { state: 'unavailable', failure_code: 'redirect_refused' }
    }
    if (!response.ok) {
      return { state: 'unavailable', failure_code: 'http_error' }
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      return { state: 'unavailable', failure_code: 'unexpected_response' }
    }
    return { state: 'reachable', failure_code: null }
  } catch (error) {
    const timedOut =
      error instanceof ProbeTimeout ||
      (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    const redirected = error instanceof InventoryTransportError
    let failure: Observation['failure_code'] = 'unavailable'
    if (timedOut) {
      failure = 'timeout'
    } else if (redirected) {
      failure = 'redirect_refused'
    }
    return { state: 'unavailable', failure_code: failure }
  } finally {
    clearTimeout(timer)
  }
}

/** One fixed profile owns one bounded cached observation and one coalesced probe. */
export function connectionStatus(
  binding: Binding,
  origin: string | undefined,
  probe?: () => Promise<Response>,
  now: () => number = Date.now,
) {
  const scope = {
    actor_id: binding.actorId,
    target_id: binding.targetId,
    target_context_id: binding.targetContextId,
  }
  const url = navigation(origin)
  const kind = binding.targetKind ?? 'configured'
  let completed: { at: number; value: Observation } | undefined
  let pending: Promise<void> | undefined

  return async (): Promise<ConnectionStatusDto> => {
    if (!url || !probe) {
      return {
        ...scope,
        target: {
          state: 'unconfigured',
          freshness: 'unobserved',
          observed_at: null,
          navigation_url: null,
          label: null,
          failure_code: origin ? 'invalid_configuration' : null,
          kind,
        },
      }
    }
    if (!completed || now() - completed.at >= CACHE_MS || now() < completed.at) {
      pending ??= (async () => {
        const result = await probeResult(probe)
        const at = now()
        completed = {
          at,
          value: {
            ...result,
            freshness: 'fresh',
            observed_at: new Date(at).toISOString(),
            navigation_url: url.href,
            label: url.host,
            kind,
          },
        }
      })().finally(() => {
        pending = undefined
      })
      await pending
    }
    if (!completed) {
      throw new Error('connection_observation_missing')
    }
    const observation = completed
    return {
      ...scope,
      target: { ...observation.value, freshness: observationFreshness(observation.at, now()) },
    }
  }
}
