import type { Pool, PoolClient } from 'pg'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { AgentPauseAllDto, AgentPauseDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { appendEvent } from '../db/authority.ts'
import { captureBatches } from '../capture/schema.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { fail } from '../processing/model.ts'
import { agentBatchPauses } from './schema.ts'

/** At most this many batches change in one Pause all or Resume all. */
export const MAX_PAUSE_BATCHES = 1000

type Scope = Pick<ProcessingConfig, 'actorId' | 'targetId' | 'targetContextId'>

const inScope = (config: Scope) =>
  and(
    eq(captureBatches.actorId, config.actorId),
    eq(captureBatches.targetId, config.targetId),
    eq(captureBatches.targetContextId, config.targetContextId),
  )

/**
 * Pauses or resumes batches already locked for update. The lock orders this against a session
 * claiming its slot, which holds the batch row shared, so no session starts after a pause commits.
 */
async function apply(
  client: PoolClient,
  config: Scope,
  batches: { id: string; streamId: string }[],
  paused: boolean,
) {
  const db = queryDatabase(client)
  if (!batches.length) {
    return
  }
  const ids = batches.map((batch) => batch.id)
  await executeDatabaseQuery(
    paused
      ? db
          .insert(agentBatchPauses)
          .values(ids.map((batchId) => ({ batchId, actorId: config.actorId })))
          .onConflictDoNothing()
      : db.delete(agentBatchPauses).where(inArray(agentBatchPauses.batchId, ids)),
  )
  for (const batch of batches) {
    await appendEvent(client, batch.streamId, 'processing_changed', { batch_id: batch.id })
  }
}

/** Pauses or resumes one batch's agent sessions; doing it twice is the same as once. */
export async function setBatchPause(
  pool: Pool,
  config: Scope,
  batchId: string,
  paused: boolean,
): Promise<AgentPauseDto> {
  return transaction(pool, async (client) => {
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: captureBatches.id, streamId: captureBatches.streamId })
        .from(captureBatches)
        .where(and(eq(captureBatches.id, batchId), inScope(config)))
        .for('update'),
    )
    if (!rows.length) {
      fail('not_found', 404)
    }
    await apply(client, config, rows, paused)
    return { batch_id: batchId, paused }
  })
}

/** Pauses or resumes every live batch of the account at once. */
export async function setAllPause(
  pool: Pool,
  config: Scope,
  paused: boolean,
  limit = MAX_PAUSE_BATCHES,
): Promise<AgentPauseAllDto> {
  return transaction(pool, async (client) => {
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: captureBatches.id, streamId: captureBatches.streamId })
        .from(captureBatches)
        .where(and(inScope(config), eq(captureBatches.archived, false)))
        .orderBy(asc(captureBatches.id))
        .limit(limit + 1)
        .for('update'),
    )
    // Pausing only some of them would report a pause that missed running batches.
    if (rows.length > limit) {
      fail('pause_scope_too_large', 409)
    }
    await apply(client, config, rows, paused)
    return { paused, batch_ids: rows.map((row) => row.id) }
  })
}

/** The account's paused live batches; an archived batch runs nothing either way. */
export async function pausedBatchIds(client: PoolClient, config: Scope) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: agentBatchPauses.batchId })
      .from(agentBatchPauses)
      .innerJoin(captureBatches, eq(captureBatches.id, agentBatchPauses.batchId))
      .where(and(inScope(config), eq(captureBatches.archived, false)))
      .orderBy(asc(agentBatchPauses.batchId))
      .limit(MAX_PAUSE_BATCHES),
  )
  return rows.map((row) => row.id)
}
