import type { ConnectionStatusDto, InventoryCredentialDto } from '@invimport/contracts'
import { CONNECTION_PROBE_TIMEOUT_MS, InventoryTransportError } from '#/inventory/transport.ts'
import type { DevConfig } from '#/config.ts'
import { readBoundedBody } from '#/capture/bounded-body.ts'

type Binding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId' | 'targetKind'>
type Observation = ConnectionStatusDto['target']
const CACHE_MS = 30000
/** Forced checks are counted on their own, so a background poll never delays one. */
export const MIN_FORCED_CHECK_INTERVAL_MS = 5000
const STALE_MS = 60000
const DEADLINE_MS = CONNECTION_PROBE_TIMEOUT_MS
const VERSION_BODY_MAX_BYTES = 16 * 1024
const VERSION_PATTERN = /^[ -~]{1,64}$/

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

/** Classifies one bounded probe; shared with the token check, so both judge a token alike. */
export async function probeResult(
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
    if (response.status === 401 || response.status === 403) {
      return { state: 'unavailable', failure_code: 'unauthorized' }
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

/** The root's `version` string, or null for anything unreadable; never fails the probe. */
async function versionResult(read: () => Promise<Response>) {
  let responded = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DEADLINE_MS)
  })
  const attempt = (async () => {
    const response = await read()
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return null
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body.cancel()
      return null
    }
    const bytes = await readBoundedBody(response.body, VERSION_BODY_MAX_BYTES, DEADLINE_MS)
    const root: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    responded = Boolean(root && typeof root === 'object' && !Array.isArray(root))
    const version =
      root && typeof root === 'object' && !Array.isArray(root)
        ? (root as Record<string, unknown>).version
        : undefined
    return typeof version === 'string' && VERSION_PATTERN.test(version) ? version : null
  })().catch(() => null)
  try {
    const version = await Promise.race([attempt, timeout])
    return { version, responded }
  } finally {
    clearTimeout(timer)
  }
}

export type TargetProbe = (signal: AbortSignal) => Promise<Response>

export type ConnectionStatusReader = (() => Promise<ConnectionStatusDto>) & {
  /** Probes now, unless a probe is in flight or a forced check ran in the last 5 seconds. */
  check: () => Promise<ConnectionStatusDto>
  /**
   * Forgets the observation and the forced-check window, for a new read token. A probe already
   * running with the old token can no longer become the observation.
   */
  reset: () => void
  refresh: () => Promise<ConnectionStatusDto>
  stop: () => void
  /** Counts resets; an answer begun under another generation describes an older token. */
  generation: () => number
  /** The current answer without probing: the observation, or unobserved after a reset. */
  latest: () => ConnectionStatusDto
}

/** One fixed profile owns one bounded cached observation and one coalesced probe. */
export function connectionStatus(
  binding: Binding,
  origin: string | undefined,
  probe?: TargetProbe,
  now: () => number = Date.now,
  version?: TargetProbe,
  /** Monotonic milliseconds for the forced-check window, so a clock change can't skip it. */
  elapsed: () => number = () => performance.now(),
  /**
   * The read token in use: its source is reported with each observation, captured when the
   * probe starts, and the token itself is used only to keep it out of the version string.
   */
  credential?: { state: () => InventoryCredentialDto; current: () => string },
): ConnectionStatusReader {
  const scope = {
    actor_id: binding.actorId,
    target_id: binding.targetId,
    target_context_id: binding.targetContextId,
  }
  const url = navigation(origin)
  const kind = binding.targetKind ?? 'configured'
  let completed: { at: number; value: Observation } | undefined
  let pending: Promise<void> | undefined
  let lastForced: number | undefined
  // Counts resets, so a probe started before one can't publish after it.
  let generation = 0
  let controller: AbortController | undefined
  let stopped = false

  function unconfigured(): ConnectionStatusDto | undefined {
    if (url && probe) {
      return undefined
    }
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

  function probeNow(target: URL, send: TargetProbe) {
    if (stopped) {
      return Promise.resolve()
    }
    if (pending) {
      return pending
    }
    const started = generation
    const abort = new AbortController()
    controller = abort
    const source = credential?.state()
    // The probe and the version read send this token, in this same tick.
    const sent = credential?.current()
    const running: Promise<void> = (async () => {
      const [result, read] = await Promise.all([
        probeResult(() => send(abort.signal)),
        version ? versionResult(() => version(abort.signal)) : Promise.resolve(null),
      ])
      if (started !== generation) {
        return
      }
      const at = now()
      const versionString = read?.version ?? null
      completed = {
        at,
        value: {
          ...result,
          root_responded: read?.responded,
          // A target that echoes the token back in its version must not get it into a response.
          version:
            result.state === 'reachable' && !(sent && versionString?.includes(sent))
              ? versionString
              : null,
          freshness: 'fresh',
          observed_at: new Date(at).toISOString(),
          navigation_url: target.href,
          label: target.host,
          kind,
          ...source,
        },
      }
    })().finally(() => {
      abort.abort()
      if (pending === running) {
        controller = undefined
        pending = undefined
      }
    })
    pending = running
    return running
  }

  /**
   * Probes until an observation stands; a reset mid-probe drops that probe's result. Repeated
   * resets can't hold a request: after one retry it answers unobserved and the next read probes.
   */
  async function observe(target: URL, send: TargetProbe) {
    await probeNow(target, send)
    // A reset during that probe dropped its result; try once more with the current token.
    if (!completed) {
      await probeNow(target, send)
    }
  }

  function unobserved(target: URL): ConnectionStatusDto {
    return {
      ...scope,
      target: {
        state: 'unknown',
        freshness: 'unobserved',
        observed_at: null,
        failure_code: null,
        navigation_url: target.href,
        label: target.host,
        kind,
        ...credential?.state(),
      },
    }
  }

  function latest(): ConnectionStatusDto {
    if (!completed) {
      return unobserved(url!)
    }
    const observation = completed
    return {
      ...scope,
      target: { ...observation.value, freshness: observationFreshness(observation.at, now()) },
    }
  }

  const read = async (): Promise<ConnectionStatusDto> => {
    const none = unconfigured()
    if (none) {
      return none
    }
    if (!completed || now() - completed.at >= CACHE_MS || now() < completed.at) {
      await observe(url!, probe!)
    }
    return latest()
  }

  const check = async (): Promise<ConnectionStatusDto> => {
    const none = unconfigured()
    if (none) {
      return none
    }
    if (pending) {
      await observe(url!, probe!)
      return latest()
    }
    // The window runs from when the last forced check finished, however long it took.
    if (
      completed &&
      lastForced !== undefined &&
      elapsed() - lastForced < MIN_FORCED_CHECK_INTERVAL_MS
    ) {
      return latest()
    }
    const started = generation
    await observe(url!, probe!)
    // A check that began with the old token can't charge the new token's window.
    if (started === generation) {
      lastForced = elapsed()
    }
    return latest()
  }

  function reset() {
    controller?.abort()
    generation += 1
    completed = undefined
    pending = undefined
    lastForced = undefined
  }

  return Object.assign(read, {
    check,
    refresh: async () => {
      const none = unconfigured()
      if (none) {
        return none
      }
      await probeNow(url!, probe!)
      return latest()
    },
    reset,
    stop() {
      stopped = true
      reset()
    },
    generation: () => generation,
    // Without probing: what a caller holding an older answer should return instead.
    latest: () => unconfigured() ?? latest(),
  })
}
