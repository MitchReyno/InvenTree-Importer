import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import {
  executorAttachmentRecoveries,
  executorAttachmentIntents,
  executorAttachmentEffects,
  executorGuards,
} from '../schema.ts'
import { cancellationVersion } from '../cancellation.ts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { lockRun, snapshot } from '../authority.ts'

export interface AttachmentRecovery {
  id: string
  run_id: string
  artifact_key: string
  kind: 'repair_attachment' | 'verify_attachment'
  create_intent_id: string | null
  cancel_version: string
}

export const attachmentRecoveryColumns = {
  id: executorAttachmentRecoveries.id,
  run_id: executorAttachmentRecoveries.runId,
  artifact_key: executorAttachmentRecoveries.artifactKey,
  actor_id: executorAttachmentRecoveries.actorId,
  cancel_version: sql<string>`${executorAttachmentRecoveries.cancelVersion}::text`,
  kind: executorAttachmentRecoveries.kind,
  create_intent_id: executorAttachmentRecoveries.createIntentId,
}

/** Selection binds original child and create intent; no current media pointer is consulted. */
export async function selectAttachmentRecovery(
  client: PoolClient,
  runId: string,
  artifactKey: string,
  actorId: string,
): Promise<string> {
  const authority = await lockRun(client, runId)
  if (authority.actorId !== actorId || authority.plan.version === 'bench-stock-plan/1') {
    throw new Error('attachment_recovery_scope_mismatch')
  }
  const state = await snapshot(client, runId)
  const attachment = state.attachments.find((child) => child.artifactKey === artifactKey)
  const stock = state.operations.find(
    (operation) => operation.operationKey === attachment?.stockOperationKey,
  )
  if (!attachment || stock?.certainty !== 'confirmed' || !stock.remotePk) {
    throw new Error('attachment_destination_not_confirmed')
  }
  const kind = attachment.certainty === 'none' ? 'repair_attachment' : 'verify_attachment'
  if (kind === 'repair_attachment' && state.state === 'recovery_required') {
    throw new Error('attachment_create_not_recoverable')
  }
  let createIntentId: string | null = null
  if (kind === 'verify_attachment') {
    const creates = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          id: executorAttachmentIntents.id,
          certainty: executorAttachmentEffects.certainty,
        })
        .from(executorAttachmentIntents)
        .leftJoin(
          executorAttachmentEffects,
          eq(executorAttachmentEffects.intentId, executorAttachmentIntents.id),
        )
        .where(
          and(
            eq(executorAttachmentIntents.runId, runId),
            eq(executorAttachmentIntents.artifactKey, artifactKey),
            eq(executorAttachmentIntents.kind, 'create_attachment'),
          ),
        )
        .orderBy(desc(executorAttachmentIntents.attempt)),
    )
    createIntentId = creates.find((attempt) => attempt.certainty !== 'none')?.id ?? null
    if (!createIntentId) {
      throw new Error('attachment_create_authority_missing')
    }
  }
  const cancelVersion = await cancellationVersion(client, runId)
  const recoveryId = randomUUID()
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(executorAttachmentRecoveries)
      .values({
        id: recoveryId,
        runId,
        artifactKey,
        actorId,
        cancelVersion: BigInt(cancelVersion),
        kind,
        createIntentId,
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
  return recoveryId
}

export async function attachmentVerificationOnly(
  client: PoolClient,
  runId: string,
  recoveryIds: readonly string[],
): Promise<boolean> {
  if (!recoveryIds.length) {
    return false
  }
  const selected = await executeDatabaseQuery(
    queryDatabase(client)
      .select(attachmentRecoveryColumns)
      .from(executorAttachmentRecoveries)
      .where(
        and(
          eq(executorAttachmentRecoveries.runId, runId),
          inArray(executorAttachmentRecoveries.id, recoveryIds),
        ),
      ),
  )
  return (
    selected.length === recoveryIds.length &&
    selected.every((recovery) => recovery.kind === 'verify_attachment')
  )
}
