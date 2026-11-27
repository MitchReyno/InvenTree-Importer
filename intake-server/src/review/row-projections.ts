import { sql } from 'drizzle-orm'
import {
  manualPreparations,
  manualPrepareCommands,
  manualRuns,
  manualDispatches,
} from './schema.ts'

export const preparationColumns = {
  id: manualPreparations.id,
  batch_id: manualPreparations.batchId,
  prepare_command_id: manualPreparations.prepareCommandId,
  actor_id: manualPreparations.actorId,
  target_revision: sql<string>`${manualPreparations.targetRevision}::text`,
  plan_bytes: manualPreparations.planBytes,
  plan_digest: manualPreparations.planDigest,
  review_bytes: manualPreparations.reviewBytes,
  review_digest: manualPreparations.reviewDigest,
  dependency_bytes: manualPreparations.dependencyBytes,
  dependency_digest: manualPreparations.dependencyDigest,
  preview_bytes: manualPreparations.previewBytes,
  created_at: manualPreparations.createdAt,
}

export const prepareCommandColumns = {
  id: manualPrepareCommands.id,
  batch_id: manualPrepareCommands.batchId,
  actor_id: manualPrepareCommands.actorId,
  deployment_id: manualPrepareCommands.deploymentId,
  target_id: manualPrepareCommands.targetId,
  context_id: manualPrepareCommands.contextId,
  dependency_bytes: manualPrepareCommands.dependencyBytes,
  dependency_digest: manualPrepareCommands.dependencyDigest,
  review_bytes: manualPrepareCommands.reviewBytes,
  review_digest: manualPrepareCommands.reviewDigest,
  created_at: manualPrepareCommands.createdAt,
}

export const runColumns = {
  id: manualRuns.id,
  batch_id: manualRuns.batchId,
  approval_id: manualRuns.approvalId,
  actor_id: manualRuns.actorId,
  stream_id: manualRuns.streamId,
  revision: sql<string>`${manualRuns.revision}::text`,
}

export const dispatchColumns = {
  id: manualDispatches.id,
  sequence: sql<string>`${manualDispatches.sequence}::text`,
  run_id: manualDispatches.runId,
  actor_id: manualDispatches.actorId,
  command_id: manualDispatches.commandId,
  recovery_bytes: manualDispatches.recoveryBytes,
  recovery_digest: manualDispatches.recoveryDigest,
  state: manualDispatches.state,
  safe_code: manualDispatches.safeCode,
  created_at: manualDispatches.createdAt,
}
