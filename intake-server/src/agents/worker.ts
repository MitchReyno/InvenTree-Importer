import type { Pool, PoolClient } from 'pg'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { requireFreeCapacity, type HeldCapacityChecks } from './held-capacity.ts'
import {
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

/**
 * Takes the actor's supervisor lock, so a second supervisor cannot claim this actor. The returned
 * connection holds it; destroying that connection releases only this lock.
 */
export async function lockAgentSupervisor(
  pool: Pool,
  config: ProcessingConfig,
): Promise<SupervisorLock> {
  const owner = await pool.connect()
  try {
    const lock = await owner.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, $2)) AS acquired',
      [supervisorLockName(config.actorId), SUPERVISOR_LOCK_SEED],
    )
    if (!lock.rows[0]?.acquired) {
      throw new Error('agent_supervisor_already_running')
    }
    const fence = await readSupervisorFence(owner, config.actorId)
    return { owner, fence }
  } catch (error) {
    owner.release(true)
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
