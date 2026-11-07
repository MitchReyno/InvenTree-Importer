import { isEffectsPlan } from './effects-plan.ts'
import { cancellationVersion } from './cancellation.ts'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { supportedRecoveries, executorRuns, executorGuards } from './schema.ts'
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
  if (authority.actorId !== actorId || !isEffectsPlan(authority.plan)) {
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
  const prior = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: executorRuns.id })
      .from(executorRuns)
      .where(
        and(
          eq(executorRuns.targetId, authority.plan.targetId),
          eq(executorRuns.originalKey, authority.plan.originalSourceKey),
          ne(executorRuns.id, runId),
        ),
      ),
  )
  for (const row of prior) {
    const state = await snapshot(client, row.id)
    if (state.state === 'recovery_required' || state.state === 'queued') {
      throw new Error('source_history_unsettled')
    }
  }
  const version = await cancellationVersion(client, runId)
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
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(executorGuards)
      .set({ activeRun: runId })
      .where(
        and(
          eq(executorGuards.targetId, authority.plan.targetId),
          eq(executorGuards.originalKey, authority.plan.originalSourceKey),
        ),
      ),
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
