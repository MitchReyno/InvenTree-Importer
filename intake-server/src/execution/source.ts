import type { PoolClient } from 'pg'
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
  const sourceResult = await client.query(
    'SELECT original_key FROM executor_source WHERE target_id=$1 AND source_id=$2',
    [source.targetId, source.sourceId],
  )
  if (sourceResult.rows[0]?.original_key !== source.originalSourceKey) {
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
  const previousResult = await client.query<{ id: string }>(
    'SELECT id FROM executor_run WHERE target_id=$1 AND original_key=$2 ORDER BY id',
    [source.targetId, source.originalSourceKey],
  )
  const runs: StockSnapshot[] = []
  for (const previous of previousResult.rows) {
    runs.push(await snapshot(client, previous.id))
  }
  const contributionsResult = await client.query<{ contribution_key: string; run_id: string }>(
    'SELECT contribution_key,run_id FROM executor_operation WHERE target_id=$1 AND contribution_key=ANY($2::uuid[])',
    [source.targetId, contributionKeys],
  )
  const guardResult = await client.query<{ active_run: string | null }>(
    'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2',
    [source.targetId, source.originalSourceKey],
  )
  return {
    runs,
    contributions: contributionsResult.rows,
    activeRunId: guardResult.rows[0]?.active_run ?? null,
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
  const result = await client.query(
    `SELECT d.*,t.revision,t.current_context_id,t.profile
     FROM executor_deployment d JOIN target t ON t.id=d.target_id
     WHERE d.id=$1 AND d.target_id=$2 AND d.context_id=$3`,
    [input.deploymentId, input.targetId, input.contextId],
  )
  const row = result.rows[0]
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
    targetRevision: row.revision,
  }
}
