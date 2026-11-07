import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type SessionFailureDto,
  type SessionFailureSummaryDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { fail } from '../processing/model.ts'

const MAX_DIAGNOSTIC_BYTES = 16 * 1024

/** Savepoint failure cannot poison settlement or release a still-running child. */
export async function retainSessionFailure(client: PoolClient, diagnostic: SessionFailureDto) {
  await client.query('SAVEPOINT session_failure')
  try {
    validate('SessionFailure', diagnostic)
    const bytes = JSON.stringify(diagnostic)
    if (Buffer.byteLength(bytes) > MAX_DIAGNOSTIC_BYTES) {
      throw new Error('session_diagnostic_capacity')
    }
    await client.query(
      `INSERT INTO agent_session_failure(id, attempt_id, turn_count, diagnostic)
      VALUES ($1, $2, $3::bigint, $4::jsonb) ON CONFLICT(attempt_id, turn_count) DO NOTHING`,
      [diagnostic.id, diagnostic.attempt_id, diagnostic.turn, bytes],
    )
    await client.query('RELEASE SAVEPOINT session_failure')
    return true
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT session_failure')
    await client.query('RELEASE SAVEPOINT session_failure')
    process.stderr.write(
      JSON.stringify({
        event: 'session_diagnostic_unavailable',
        correlation_id: diagnostic.correlation_id,
      }) + '\n',
    )
    return false
  }
}

export async function latestSessionFailures(client: Pool | PoolClient, attemptIds: string[]) {
  if (!attemptIds.length) {
    return new Map<string, SessionFailureSummaryDto>()
  }
  const result = await client.query<{ attempt_id: string; diagnostic: SessionFailureDto }>(
    `
    SELECT failure.attempt_id, failure.diagnostic FROM agent_session_failure failure
    JOIN agent_session session ON session.attempt_id = failure.attempt_id AND session.turn_count = failure.turn_count
    WHERE failure.attempt_id = ANY($1::uuid[])`,
    [attemptIds],
  )
  const summaries = new Map<string, SessionFailureSummaryDto>()
  for (const row of result.rows) {
    validate('SessionFailure', row.diagnostic)
    const { id, category, summary, details_available } = row.diagnostic
    summaries.set(row.attempt_id, { id, category, summary, details_available })
  }
  return summaries
}

/** Read authority is the retained command's actor and complete target binding. */
export async function readSessionFailure(
  pool: Pool,
  binding: ProcessingConfig,
  attemptId: string,
  failureId: string,
): Promise<SessionFailureDto> {
  const result = await pool.query<{ diagnostic: SessionFailureDto }>(
    `
    SELECT failure.diagnostic FROM agent_session_failure failure
    JOIN processing_attempt attempt ON attempt.id = failure.attempt_id
    JOIN command command ON command.id = attempt.command_id
    WHERE failure.id = $1 AND failure.attempt_id = $2
      AND command.actor_id = $3 AND command.target_id = $4 AND command.target_context_id = $5`,
    [failureId, attemptId, binding.actorId, binding.targetId, binding.targetContextId],
  )
  const diagnostic = result.rows[0]?.diagnostic ?? fail('session_failure_not_found', 404)
  validate('SessionFailure', diagnostic)
  return diagnostic
}
