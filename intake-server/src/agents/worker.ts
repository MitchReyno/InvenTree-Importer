import type { Pool, PoolClient } from 'pg'
import type { ProcessingConfig } from '../processing/attempts.ts'

/** A second supervisor cannot claim this actor. Unknown old children keep the physical lane blocked. */
export async function acquireAgentSupervisor(
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
    const lane = await owner.query(
      'SELECT attempt_id FROM public.processing_lane WHERE actor_id=$1 AND attempt_id IS NOT NULL',
      [config.actorId],
    )
    if (lane.rowCount) {
      throw new Error('agent_reap_confirmation_required')
    }
    return owner
  } catch (error) {
    // Destroying this connection releases only its own advisory lock.
    owner.release(true)
    throw error
  }
}
