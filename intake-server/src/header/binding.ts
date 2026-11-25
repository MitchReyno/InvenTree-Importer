import { eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { targets } from '#/db/schema.ts'
import { fail } from '#/capture/model.ts'
import type { ConnectionStatusDto, InventoryCredentialDto } from '@invimport/contracts'
import type { DevConfig } from '#/config.ts'
import { connectionStatus, type TargetProbe } from './connection.ts'

type Binding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId'>

/** A header binding plus whether its target is the owned test fake. */
type StatusBinding = Binding & Pick<DevConfig, 'targetKind'>

export async function requireHeaderContext(client: Pool | PoolClient, binding: Binding) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ context: targets.currentContextId })
      .from(targets)
      .where(eq(targets.id, binding.targetId)),
  )
  if (rows[0]?.context !== binding.targetContextId) {
    fail('target_context_changed', 409)
  }
}

/** What connection status is scoped to, including whether the target is the owned test fake. */
export function statusBinding(binding: StatusBinding) {
  return {
    actorId: binding.actorId,
    targetId: binding.targetId,
    targetContextId: binding.targetContextId,
    targetKind: binding.targetKind,
  }
}

export function scopedConnectionStatus(
  pool: Pool,
  binding: StatusBinding,
  origin: string | undefined,
  probe?: TargetProbe,
  version?: TargetProbe,
  /** The read token the probes use; only its source is reported, never the token. */
  credential?: { state: () => InventoryCredentialDto; current: () => string },
  report?: (outcome: string, elapsedMs: number) => void,
) {
  const scope = statusBinding(binding)
  const status = connectionStatus(scope, origin, probe, Date.now, version, undefined, credential)

  const fenced = (run: () => Promise<ConnectionStatusDto>) => async () => {
    const generation = status.generation()
    await requireHeaderContext(pool, scope)
    if (status.generation() !== generation) {
      return status.latest()
    }
    const result = await run()
    await requireHeaderContext(pool, scope)
    // The token changed while the context was checked: that answer describes the old one.
    return status.generation() === generation ? result : status.latest()
  }

  let timer: NodeJS.Timeout | undefined
  let running = false
  let epoch = 0
  const refresh = fenced(status.refresh)

  function schedule(delayMs: number) {
    clearTimeout(timer)
    if (running) {
      timer = setTimeout(() => void poll(epoch), delayMs)
      timer.unref()
    }
  }

  async function poll(started: number) {
    const start = performance.now()
    let outcome = 'scope_unavailable'
    let next = 4000 + Math.random() * 500
    try {
      const result = await refresh()
      outcome = result.target.failure_code ?? result.target.state
      if (result.target.state === 'reachable' || result.target.failure_code === 'unauthorized') {
        next = 30_000
      }
    } catch {
      // A failed scope read cannot establish a target failure.
    } finally {
      if (started === epoch) {
        report?.(outcome, Math.round(performance.now() - start))
        schedule(next)
      }
    }
  }

  const snapshot = fenced(async () => status.latest())
  let reading: Promise<ConnectionStatusDto> | undefined

  function read() {
    reading ??= snapshot().finally(() => {
      reading = undefined
    })
    return reading
  }

  function reset() {
    epoch += 1
    status.reset()
    schedule(0)
  }

  return Object.assign(read, {
    async check() {
      const result = await fenced(status.check)()
      if (result.target.state === 'unavailable' && result.target.failure_code !== 'unauthorized') {
        schedule(4000)
      }
      return result
    },
    reset,
    start() {
      running = Boolean(origin && probe)
      schedule(0)
    },
    stop() {
      running = false
      epoch += 1
      clearTimeout(timer)
      status.stop()
    },
  })
}
