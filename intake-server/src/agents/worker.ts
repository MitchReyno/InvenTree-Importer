import type { Pool, PoolClient } from 'pg'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { requireFreeCapacity, type HeldCapacityChecks } from './held-capacity.ts'
import {
  awaitFencedWrites,
  readSupervisorFence,
  SUPERVISOR_LOCK_SEED,
  supervisorLockName,
  type SupervisorFence,
} from './supervisor-fence.ts'

/** The connection holding the actor's supervisor lock, and the fence its writes pass. */
export interface SupervisorLock {
  owner: PoolClient
  fence: SupervisorFence
}

export interface SupervisorLockOptions {
  /** Overrides `SUPERVISOR_FENCE_WAIT_MS`, for tests. */
  fenceWaitMs?: number
}

/**
 * Takes the actor's supervisor lock, so a second supervisor cannot claim this actor, then waits
 * for a previous holder's fenced writes still in flight. The returned connection holds the lock;
 * destroying that connection releases only this lock.
 */
export async function lockAgentSupervisor(
  pool: Pool,
  config: ProcessingConfig,
  options: SupervisorLockOptions = {},
): Promise<SupervisorLock> {
  const owner = await pool.connect()
  // From checkout: the pool drops its idle listener, and losing the connection during the barrier
  // must end as a refusal here rather than an unhandled error. It stays for the worker's life.
  let lost = false
  owner.on('error', () => {
    lost = true
  })
  try {
    const lock = await owner.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, $2)) AS acquired',
      [supervisorLockName(config.actorId), SUPERVISOR_LOCK_SEED],
    )
    if (!lock.rows[0]?.acquired) {
      throw new Error('agent_supervisor_already_running')
    }
    const fence = await readSupervisorFence(owner, config.actorId)
    // Before anything reads held capacity, so no write of a worker that lost the lock lands after.
    await awaitFencedWrites(owner, config.actorId, options.fenceWaitMs)
    return { owner, fence }
  } catch (error) {
    owner.release(true)
    if (lost) {
      throw new Error('agent_supervisor_lock_lost', { cause: error })
    }
    throw error
  }
}

/**
 * The lock, then the held-capacity check: a session child may outlive its worker, so a held
 * slot or lane is released only once its turn is confirmed gone, and otherwise refuses.
 */
export async function acquireAgentSupervisor(
  pool: Pool,
  config: ProcessingConfig,
  checks: HeldCapacityChecks = {},
): Promise<SupervisorLock> {
  const lock = await lockAgentSupervisor(pool, config)
  try {
    await requireFreeCapacity(lock.owner, config, checks)
    return lock
  } catch (error) {
    lock.owner.release(true)
    throw error
  }
}
