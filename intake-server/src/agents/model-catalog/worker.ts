// The session worker's model catalogue schedule: when each provider's list is read, and how a
// read is published under the sign-in it belongs to.
import type { Pool } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
import type { CaptureBinding } from '#/capture/model.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { CatalogReadError } from './normalise.ts'
import type { CatalogAuthentication, CatalogProvider, CatalogReader } from './readers.ts'
import {
  beginCatalogRead,
  catalogReadDue,
  clearCatalogRequest,
  clearStaleReads,
  observeCatalogGeneration,
  publishCatalogRead,
  readCatalogRows,
  recordCatalogFailure,
  type CatalogKey,
  type CatalogRow,
} from './store.ts'

/** How often a fenced reader's sign-in generation is checked: the stated detection window. */
export const CATALOG_GENERATION_POLL_MS = 60_000
/** A host read's own bound; a guest read is bounded by the coordinator's 20 s as well. */
const HOST_READ_MS = 25_000
const GENERATION_READ_MS = 5_000
/** Reads discarded for a sign-in change before the attempt is recorded as failed. */
const MAX_DISCARDED_READS = 3

/** A provider's current authentication, and whether it is on. */
export interface CatalogProviderSetting extends CatalogKey {
  enabled: boolean
}

export interface CatalogWorkerOptions {
  pool: Pool
  scope: CaptureBinding
  /** The reader for a key, or undefined where that mode has no route to its sign-in. */
  reader: (key: CatalogKey) => CatalogReader | undefined
  /** Each provider's current authentication, from the saved settings. */
  providers: () => Promise<CatalogProviderSetting[]>
  now?: () => Date
  generationPollMs?: number
}

function sameKey(row: CatalogRow, key: CatalogKey) {
  return row.provider === key.provider && row.authentication === key.authentication
}

function failureCode(error: unknown) {
  if (error instanceof CatalogReadError) {
    return error.code
  }
  return 'unavailable' as const
}

/**
 * Reads on start for each enabled provider, then whenever a row is due (requested, never read,
 * 12 hours old, or 5 minutes after a failure), and polls fenced readers' sign-in generations.
 * Reads are one at a time per provider. `pass` runs one round; the caller runs it every
 * supervisor pass and on each notification, so a lost notification only delays a read.
 */
export function modelCatalogWorker(options: CatalogWorkerOptions) {
  const { pool, scope } = options
  const now = options.now ?? (() => new Date())
  const pollMs = options.generationPollMs ?? CATALOG_GENERATION_POLL_MS
  const stopping = new AbortController()
  const initial = new Set<CatalogProvider>(['claude', 'codex'])
  const lastPoll = new Map<string, number>()
  const running = new Map<CatalogProvider, Promise<void>>()
  // Generation polls run apart from reads, so a long or failing read never delays one.
  const polling = new Map<CatalogProvider, Promise<boolean>>()
  // The CLI version each key's last admission-triggered request was for.
  const versionRequested = new Map<string, string>()
  let cleared: Promise<void> | undefined

  const keyName = (key: CatalogKey) => key.provider + ':' + key.authentication

  async function readKey(key: CatalogKey, reader: CatalogReader) {
    for (let discarded = 0; ; discarded++) {
      const started = await beginCatalogRead(pool, scope, key, reader.readIn, now())
      const signal = AbortSignal.any([stopping.signal, AbortSignal.timeout(HOST_READ_MS)])
      try {
        const read = await reader.read(signal)
        // Taken from the source just before storing: a change committed before this never lets
        // the reply become current.
        const current = reader.fenced ? await reader.generation(generationSignal()) : null
        const outcome = await publishCatalogRead(
          pool,
          scope,
          key,
          { ...read, source: reader.source, readIn: reader.readIn },
          started,
          current,
          now(),
        )
        if (outcome === 'published') {
          return
        }
        if (discarded + 1 >= MAX_DISCARDED_READS) {
          await recordCatalogFailure(pool, scope, key, 'unavailable', started, now())
          return
        }
      } catch (error) {
        if (stopping.signal.aborted) {
          return
        }
        const code = error instanceof ResearchReapPendingError ? 'unavailable' : failureCode(error)
        const timedOut = signal.aborted && !(error instanceof CatalogReadError)
        await recordCatalogFailure(pool, scope, key, timedOut ? 'timeout' : code, started, now())
        return
      }
    }
  }

  function generationSignal() {
    return AbortSignal.any([stopping.signal, AbortSignal.timeout(GENERATION_READ_MS)])
  }

  /**
   * Observes a fenced reader's generation once its poll interval has passed; true when it found
   * a different sign-in, which requested a read.
   */
  async function poll(key: CatalogKey, reader: CatalogReader) {
    const name = keyName(key)
    const time = now().getTime()
    const last = lastPoll.get(name)
    if (!reader.fenced || (last !== undefined && time - last < pollMs)) {
      return false
    }
    lastPoll.set(name, time)
    try {
      const generation = await reader.generation(generationSignal())
      if (generation === null) {
        return false
      }
      return await observeCatalogGeneration(pool, scope, key, generation, now())
    } catch {
      // An unreachable guest is seen by the next read; the poll changes nothing.
      return false
    }
  }

  async function serveProvider(
    setting: CatalogProviderSetting,
    rows: CatalogRow[],
    polled: Promise<boolean> | undefined,
  ) {
    const key = { provider: setting.provider, authentication: setting.authentication }
    const reader = options.reader(key)
    const row = rows.find((candidate) => sameKey(candidate, key))
    const firstRead = initial.delete(setting.provider) && setting.enabled
    if (!reader) {
      if (row?.refreshRequestedAt) {
        await clearCatalogRequest(pool, scope, key)
      }
      return
    }
    // A sign-in change this round's poll found requested a read, which isn't in `rows` yet.
    const signInChanged = (await polled) === true
    const requested = row?.refreshRequestedAt != null
    const due = setting.enabled ? catalogReadDue(row, now()) : requested
    if (firstRead || signInChanged || due) {
      await readKey(key, reader)
    }
  }

  /** One round. A provider still reading from an earlier round is left to finish. */
  async function pass() {
    if (stopping.signal.aborted) {
      return
    }
    cleared ??= clearStaleReads(pool, scope).catch((error: unknown) => {
      cleared = undefined
      throw error
    })
    await cleared
    const [settings, rows] = await Promise.all([options.providers(), readCatalogRows(pool, scope)])
    for (const setting of settings) {
      const polled = startPoll(setting, rows)
      if (running.has(setting.provider)) {
        continue
      }
      const work = serveProvider(setting, rows, polled)
        .catch(() => {
          process.stderr.write(`${JSON.stringify({ event: 'model_catalog_read_retrying' })}\n`)
        })
        .finally(() => running.delete(setting.provider))
      running.set(setting.provider, work)
    }
  }

  /**
   * Starts a generation poll for a provider whose list the API may serve: an enabled provider, or
   * a disabled one with a stored list. It runs beside any read of that provider.
   */
  function startPoll(setting: CatalogProviderSetting, rows: CatalogRow[]) {
    const key = { provider: setting.provider, authentication: setting.authentication }
    const reader = options.reader(key)
    const stored = rows.some((row) => sameKey(row, key) && row.models !== null)
    if (!reader || polling.has(setting.provider) || !(setting.enabled || stored)) {
      return undefined
    }
    const polled = poll(key, reader).finally(() => polling.delete(setting.provider))
    polling.set(setting.provider, polled)
    return polled
  }

  /**
   * Requests a read when a turn's admission reports a CLI version other than the stored list's,
   * once per version. A list from a models API has no CLI version to compare.
   */
  /** Requests for a reported version in flight, so overlapping admissions write one. */
  const versionRequests = new Map<string, Promise<void>>()

  async function cliVersionReported(
    provider: CatalogProvider,
    authentication: CatalogAuthentication,
    version: string,
  ) {
    const name = keyName({ provider, authentication })
    const requestName = name + '@' + version
    const inFlight = versionRequests.get(requestName)
    if (inFlight) {
      return inFlight
    }
    const request = requestForVersion(provider, authentication, version).finally(() =>
      versionRequests.delete(requestName),
    )
    versionRequests.set(requestName, request)
    return request
  }

  async function requestForVersion(
    provider: CatalogProvider,
    authentication: CatalogAuthentication,
    version: string,
  ) {
    const rows = await readCatalogRows(pool, scope)
    const row = rows.find((candidate) => sameKey(candidate, { provider, authentication }))
    const name = keyName({ provider, authentication })
    const unchanged = row?.cliVersion === version || versionRequested.get(name) === version
    if (!row?.models || row.source === 'api' || unchanged) {
      return
    }
    await pool.query(
      `UPDATE agent_model_catalog SET refresh_requested_at=coalesce(refresh_requested_at,$6),
          refresh_seq=refresh_seq+1
        WHERE actor_id=$1 AND target_id=$2 AND target_context_id=$3 AND provider=$4
          AND authentication=$5`,
      [scope.actorId, scope.targetId, scope.targetContextId, provider, authentication, now()],
    )
    // Only once the request is saved, so a failed one is asked again by the next admission.
    versionRequested.set(name, version)
  }

  return {
    pass,
    cliVersionReported,
    /** Settles every read in flight; used by tests and shutdown. */
    async idle() {
      while (running.size || polling.size) {
        await Promise.allSettled([...running.values(), ...polling.values()])
      }
    },
    async close() {
      stopping.abort()
      const bound = new AbortController()
      await Promise.race([
        Promise.allSettled([...running.values(), ...polling.values()]),
        delay(HOST_READ_MS, undefined, { signal: bound.signal }).catch(() => undefined),
      ])
      bound.abort()
    },
  }
}

export type ModelCatalogWorker = ReturnType<typeof modelCatalogWorker>
