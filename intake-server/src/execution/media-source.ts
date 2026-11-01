import type { PoolClient } from 'pg'
import type { StockDeployment } from './source.ts'
import { MEDIA_CAPABILITY, MEDIA_EXECUTOR_BUILD } from './media-plan.ts'

export interface MediaDeployment extends Omit<StockDeployment, 'build' | 'capability'> {
  build: typeof MEDIA_EXECUTOR_BUILD
  capability: typeof MEDIA_CAPABILITY
}

export async function mediaDeployment(
  client: PoolClient,
  input: { deploymentId: string; targetId: string; contextId: string; origin: string },
): Promise<MediaDeployment | null> {
  const result = await client.query(
    `SELECT d.*,t.revision,t.current_context_id,t.profile
     FROM executor_deployment d JOIN target t ON t.id=d.target_id
     WHERE d.id=$1 AND d.target_id=$2 AND d.context_id=$3`,
    [input.deploymentId, input.targetId, input.contextId],
  )
  const deployment = result.rows[0]
  if (!deployment) {
    return null
  }
  const sameTarget =
    deployment.origin === input.origin && deployment.current_context_id === input.contextId
  const qualifiedMedia =
    deployment.profile === 'owned-disposable' &&
    deployment.build === MEDIA_EXECUTOR_BUILD &&
    deployment.capability === MEDIA_CAPABILITY
  if (!sameTarget || !qualifiedMedia) {
    return null
  }
  return {
    deploymentId: deployment.id,
    epoch: deployment.epoch,
    targetId: deployment.target_id,
    contextId: deployment.context_id,
    continuity: deployment.continuity,
    build: MEDIA_EXECUTOR_BUILD,
    capability: MEDIA_CAPABILITY,
    targetRevision: deployment.revision,
  }
}
