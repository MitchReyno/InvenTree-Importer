import type { Pool, PoolClient } from 'pg'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { requireFreeCapacity, type HeldCapacityChecks } from './held-capacity.ts'

/**
 * Takes the actor's supervisor lock, so a second supervisor cannot claim this actor. The returned
 * connection holds it; destroying that connection releases only this lock.
 */
export async function lockAgentSupervisor(
  pool: Pool,
  config: ProcessingConfig,
): Promise<PoolClient> {
  const owner = await pool.connect()
  try {
    const lock = await owner.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 7318)) AS acquired',
      [`agent-supervisor:${config.actorId}`],
    )
    if (!lock.rows[0]?.acquired) {
      throw new Error('agent_supervisor_already_running')
    }
    return owner
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
): Promise<PoolClient> {
  const owner = await lockAgentSupervisor(pool, config)
  try {
    await requireFreeCapacity(owner, config, checks)
    return owner
  } catch (error) {
    owner.release(true)
    throw error
  }
}
