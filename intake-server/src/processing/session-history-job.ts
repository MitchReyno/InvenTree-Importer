import type { PoolClient } from 'pg'
import type { ProcessingConfig } from './attempts.ts'

/**
 * Whether job `j` holds a session attempt of the account in parameters $3–$5 (actor, target and
 * target context): an `agent_session` row alone doesn't prove it, since the earlier native runner
 * writes one without a session state.
 */
export const HAS_SESSION_HISTORY = `EXISTS (
          SELECT 1 FROM public.processing_attempt a
            JOIN public.command c ON c.id=a.command_id
            JOIN public.agent_session s ON s.attempt_id=a.id
           WHERE a.job_id=j.id AND s.session_lineage_id=j.id AND s.session_state IS NOT NULL
             AND c.actor_id=$3 AND c.target_id=$4 AND c.target_context_id=$5)`

/** The jobs of this batch whose session history the history route would serve now. */
export async function jobsWithSessionHistory(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  jobIds: readonly string[],
) {
  if (!jobIds.length) {
    return new Set<string>()
  }
  const rows = await client.query<{ id: string }>(
    `SELECT j.id FROM public.processing_job j
      WHERE j.id=ANY($1::uuid[]) AND j.batch_id=$2 AND ${HAS_SESSION_HISTORY}`,
    [[...jobIds], batchId, config.actorId, config.targetId, config.targetContextId],
  )
  return new Set(rows.rows.map((row) => row.id))
}
