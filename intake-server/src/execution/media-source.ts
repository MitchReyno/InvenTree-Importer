import type { PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { targets } from '#/db/schema.ts'
import { executorDeployments } from './schema.ts'
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
  const deployment = result[0]
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
    targetRevision: deployment.revision.toString(),
  }
}
