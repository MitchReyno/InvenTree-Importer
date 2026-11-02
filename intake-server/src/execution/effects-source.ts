import type { PoolClient } from 'pg'
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
  const result = await client.query(
    `SELECT d.*,t.revision,t.current_context_id,t.profile FROM executor_deployment d JOIN target t ON t.id=d.target_id WHERE d.id=$1 AND d.target_id=$2 AND d.context_id=$3`,
    [input.deploymentId, input.targetId, input.contextId],
  )
  const row = result.rows[0]
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
    targetRevision: row.revision,
  }
}
