import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { supportedRecoveries } from './schema.ts'
import { lockRun, snapshot } from './authority.ts'
import { supportedStates } from './effects-state.ts'

export async function selectSupportedRecovery(
  client: PoolClient,
  runId: string,
  key: string,
  actorId: string,
  kind: 'resume_effect' | 'verify_effect',
) {
  const authority = await lockRun(client, runId)
  if (authority.actorId !== actorId || authority.plan.version !== 'bench-effects-plan/1') {
    throw new Error('recovery_scope_mismatch')
  }
  const states = await supportedStates(client, runId, authority.plan)
  const state = states.find((item) => item.operationKey === key)
  if (!state) {
    throw new Error('recovery_scope_mismatch')
  }
  if (kind === 'verify_effect') {
    if (!state.createIntentId || state.remotePks.length !== 1 || state.certainty === 'none') {
      throw new Error('unattributed_effect_not_verifiable')
    }
  } else if (
    state.certainty !== 'none' ||
    (await snapshot(client, runId)).state === 'recovery_required'
  ) {
    throw new Error('effect_create_not_recoverable')
  }
  const prior = await client.query(
    'SELECT r.id FROM executor_run r WHERE r.target_id=$1 AND r.original_key=$2 AND r.id<>$3',
    [authority.plan.targetId, authority.plan.originalSourceKey, runId],
  )
  for (const row of prior.rows) {
    const state = await snapshot(client, row.id)
    if (state.state === 'recovery_required' || state.state === 'queued') {
      throw new Error('source_history_unsettled')
    }
  }
  const version = (
    await client.query(
      'SELECT COALESCE(max(id),0) AS version FROM executor_cancel WHERE run_id=$1',
      [runId],
    )
  ).rows[0].version
  const id = randomUUID()
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(supportedRecoveries)
      .values({
        id,
        runId,
        operationKey: key,
        actorId,
        cancelVersion: BigInt(version),
        kind,
      }),
  )
  await client.query(
    'UPDATE executor_guard SET active_run=$3 WHERE target_id=$1 AND original_key=$2',
    [authority.plan.targetId, authority.plan.originalSourceKey, runId],
  )
  return id
}

export async function supportedVerificationOnly(client: PoolClient, runId: string, ids: string[]) {
  if (!ids.length) {
    return false
  }
  const selected = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ kind: supportedRecoveries.kind })
      .from(supportedRecoveries)
      .where(and(eq(supportedRecoveries.runId, runId), inArray(supportedRecoveries.id, ids))),
  )
  return selected.length === ids.length && selected.every((row) => row.kind === 'verify_effect')
}
