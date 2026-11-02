import type { PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { targets } from '../db/schema.ts'
import { executorDeployments } from './schema.ts'
import type { StockDeployment } from './source.ts'
import { EFFECTS_BUILD, EFFECTS_CAPABILITY } from './effects-plan.ts'
export interface EffectsDeployment extends Omit<StockDeployment, 'build' | 'capability'> {
  build: typeof EFFECTS_BUILD
  capability: typeof EFFECTS_CAPABILITY
}

export async function effectsDeployment(
  client: PoolClient,
  input: { deploymentId: string; targetId: string; contextId: string; origin: string },
): Promise<EffectsDeployment | null> {
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
    row.build !== EFFECTS_BUILD ||
    row.capability !== EFFECTS_CAPABILITY
  ) {
    return null
  }
  return {
    deploymentId: row.id,
    epoch: row.epoch,
    targetId: row.target_id,
    contextId: row.context_id,
    continuity: row.continuity,
    build: EFFECTS_BUILD,
    capability: EFFECTS_CAPABILITY,
    targetRevision: row.revision.toString(),
  }
}
