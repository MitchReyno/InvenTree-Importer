import type { PoolClient } from 'pg'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { targets } from '../db/schema.ts'
import {
  executorDeployments,
  executorSources,
  executorGuards,
  executorRuns,
  executorOperations,
} from './schema.ts'
import { id, CAPABILITY, EXECUTOR_BUILD } from './plan.ts'
import { snapshot, type StockSnapshot } from './authority.ts'

export interface OriginalSource {
  targetId: string
  sourceId: string
  originalSourceKey: string
}

/** Target/source locks precede capture locks. Enrollment is deliberately not performed here. */
export async function lockStockSource(client: PoolClient, source: OriginalSource) {
  id(source.targetId)
  id(source.sourceId)
  id(source.originalSourceKey)
  const targetResult = await client.query<{ revision: string }>(
    'SELECT revision FROM target WHERE id=$1 FOR UPDATE',
    [source.targetId],
  )
  const target = targetResult.rows[0]
  if (!target) {
    throw new Error('target_authority_missing')
  }
  const sourceResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ originalKey: executorSources.originalKey })
      .from(executorSources)
      .where(
        and(
          eq(executorSources.targetId, source.targetId),
          eq(executorSources.sourceId, source.sourceId),
        ),
      ),
  )
  if (sourceResult[0]?.originalKey !== source.originalSourceKey) {
    throw new Error('original_source_authority_missing')
  }
  await client.query(
    'INSERT INTO executor_guard(target_id,original_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [source.targetId, source.originalSourceKey],
  )
  const guardResult = await client.query<{ active_run: string | null }>(
    'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2 FOR UPDATE',
    [source.targetId, source.originalSourceKey],
  )
  return { targetRevision: target.revision, activeRunId: guardResult.rows[0].active_run }
}

/** Cumulative history is observed under the retained source guard, never inferred from an idle pointer. */
export async function stockSourceHistory(
  client: PoolClient,
  source: OriginalSource,
  contributionKeys: string[],
) {
  const previousResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: executorRuns.id })
      .from(executorRuns)
      .where(
        and(
          eq(executorRuns.targetId, source.targetId),
          eq(executorRuns.originalKey, source.originalSourceKey),
        ),
      )
      .orderBy(asc(executorRuns.id)),
  )
  const runs: StockSnapshot[] = []
  for (const previous of previousResult) {
    runs.push(await snapshot(client, previous.id))
  }
  const contributionsResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        contribution_key: executorOperations.contributionKey,
        run_id: executorOperations.runId,
      })
      .from(executorOperations)
      .where(
        and(
          eq(executorOperations.targetId, source.targetId),
          inArray(executorOperations.contributionKey, contributionKeys),
        ),
      ),
  )
  const guardResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ activeRun: executorGuards.activeRun })
      .from(executorGuards)
      .where(
        and(
          eq(executorGuards.targetId, source.targetId),
          eq(executorGuards.originalKey, source.originalSourceKey),
        ),
      ),
  )
  return {
    runs,
    contributions: contributionsResult,
    activeRunId: guardResult[0]?.activeRun ?? null,
  }
}

export interface StockDeployment {
  deploymentId: string
  epoch: string
  targetId: string
  contextId: string
  continuity: string
  build: typeof EXECUTOR_BUILD
  capability: typeof CAPABILITY
  targetRevision: string
}

/** Executor-owned capability lookup; a successful lookup grants no apply authority. */
export async function stockDeployment(
  client: PoolClient,
  input: { deploymentId: string; targetId: string; contextId: string; origin: string },
): Promise<StockDeployment | null> {
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: executorDeployments.id,
        epoch: executorDeployments.epoch,
        target_id: executorDeployments.targetId,
        context_id: executorDeployments.contextId,
        origin: executorDeployments.origin,
        continuity: executorDeployments.continuity,
        build: executorDeployments.build,
        capability: executorDeployments.capability,
        revision: targets.revision,
        current_context_id: targets.currentContextId,
        profile: targets.profile,
      })
      .from(executorDeployments)
      .innerJoin(targets, eq(targets.id, executorDeployments.targetId))
      .where(
        and(
          eq(executorDeployments.id, input.deploymentId),
          eq(executorDeployments.targetId, input.targetId),
          eq(executorDeployments.contextId, input.contextId),
        ),
      ),
  )
  const row = result[0]
  if (
    !row ||
    row.origin !== input.origin ||
    row.current_context_id !== input.contextId ||
    row.profile !== 'owned-disposable' ||
    row.build !== EXECUTOR_BUILD ||
    row.capability !== CAPABILITY
  ) {
    return null
  }
  return {
    deploymentId: row.id,
    epoch: row.epoch,
    targetId: row.target_id,
    contextId: row.context_id,
    continuity: row.continuity,
    build: EXECUTOR_BUILD,
    capability: CAPABILITY,
    targetRevision: row.revision.toString(),
  }
}
