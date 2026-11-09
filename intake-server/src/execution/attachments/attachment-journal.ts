import { and, eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import {
  executorGuards,
  executorAttachmentRecoveries,
  executorAttachmentIntents,
  executorAttachmentResults,
  executorAttachmentEffects,
  executorAttachmentVerifications,
} from '../schema.ts'
import { sql } from 'drizzle-orm'
import { cancellationVersion } from '../cancellation.ts'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../../db/authority.ts'
import type { AttachmentWire } from '../../inventory/transport.ts'
import { executorTransaction } from '../transaction.ts'
import { lockRun, snapshot } from '../authority.ts'
import { attachmentOperations, type AttachmentOperation } from '../media-plan.ts'

export type AttachmentRequestKind =
  'create_attachment' | 'get_attachment' | 'download_attachment' | 'lookup_attachment' | 'get_stock'

export interface AttachmentJournalContext {
  pool: Pool
  runId: string
  operation: AttachmentOperation
  recoveryId: string | null
  health: () => Promise<void>
}

export async function authorizeAttachmentRequest(
  context: AttachmentJournalContext,
  kind: AttachmentRequestKind,
  request: unknown,
): Promise<{ id: string; bytes: Buffer } | null> {
  await context.health()
  const id = randomUUID()
  const bytes = Buffer.from(canonical(request))
  return executorTransaction(context.pool, async (client) => {
    const authority = await lockRun(client, context.runId)
    await context.health()
    const approved = attachmentOperations(authority.plan).find(
      (attachment) => attachment.artifactKey === context.operation.artifactKey,
    )
    if (!approved || canonical(approved) !== canonical(context.operation)) {
      throw new Error('attachment_approval_scope_changed')
    }
    const state = await snapshot(client, context.runId)
    const child = state.attachments.find(
      (attachment) => attachment.artifactKey === context.operation.artifactKey,
    )
    const stock = state.operations.find(
      (operation) => operation.operationKey === context.operation.stockOperationKey,
    )
    if (!child || stock?.certainty !== 'confirmed' || !stock.remotePk) {
      throw new Error('attachment_destination_not_confirmed')
    }
    const guard = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ active_run: executorGuards.activeRun })
        .from(executorGuards)
        .where(
          and(
            eq(executorGuards.targetId, authority.plan.targetId),
            eq(executorGuards.originalKey, authority.plan.originalSourceKey),
          ),
        ),
    )
    if (guard[0].active_run !== context.runId) {
      throw new Error('source_not_owned')
    }
    const cancelVersion = await cancellationVersion(client, context.runId)
    if (cancelVersion !== '0' && !context.recoveryId) {
      return null
    }
    if (context.recoveryId) {
      const recovery = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            cancel_version: sql<string>`${executorAttachmentRecoveries.cancelVersion}::text`,
            kind: executorAttachmentRecoveries.kind,
          })
          .from(executorAttachmentRecoveries)
          .where(
            and(
              eq(executorAttachmentRecoveries.id, context.recoveryId),
              eq(executorAttachmentRecoveries.runId, context.runId),
              eq(executorAttachmentRecoveries.artifactKey, context.operation.artifactKey),
            ),
          ),
      )
      const selected = recovery[0]
      if (!selected) {
        throw new Error('attachment_recovery_authority_missing')
      }
      if (selected.cancel_version !== cancelVersion) {
        return null
      }
      if (selected.kind === 'verify_attachment' && kind === 'create_attachment') {
        throw new Error('attachment_verification_is_read_only')
      }
    }
    if (
      kind === 'create_attachment' &&
      (state.state === 'recovery_required' || child.certainty !== 'none')
    ) {
      throw new Error('attachment_create_not_recoverable')
    }
    const prior = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          recovery_id: executorAttachmentIntents.recoveryId,
          certainty: executorAttachmentEffects.certainty,
          outcome: executorAttachmentResults.outcome,
        })
        .from(executorAttachmentIntents)
        .leftJoin(
          executorAttachmentEffects,
          eq(executorAttachmentEffects.intentId, executorAttachmentIntents.id),
        )
        .leftJoin(
          executorAttachmentResults,
          eq(executorAttachmentResults.intentId, executorAttachmentIntents.id),
        )
        .where(
          and(
            eq(executorAttachmentIntents.runId, context.runId),
            eq(executorAttachmentIntents.artifactKey, context.operation.artifactKey),
            eq(executorAttachmentIntents.kind, kind),
          ),
        )
        .orderBy(executorAttachmentIntents.attempt),
    )
    const reusedSelection = prior.some((attempt) => attempt.recovery_id === context.recoveryId)
    if (prior.length && (!context.recoveryId || reusedSelection)) {
      throw new Error('selected_attachment_recovery_required')
    }
    if (kind === 'create_attachment' && prior.some((attempt) => attempt.certainty !== 'none')) {
      throw new Error('attachment_create_not_recoverable')
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(executorAttachmentIntents)
        .values({
          id,
          runId: context.runId,
          artifactKey: context.operation.artifactKey,
          attempt: prior.length + 1,
          recoveryId: context.recoveryId,
          kind,
          requestBytes: bytes,
          requestDigest: sha256(bytes),
        }),
    )
    return { id, bytes }
  })
}

export interface AttachmentResult {
  outcome: 'response' | 'transport_loss' | 'proven_not_sent'
  status: number | null
  bytes: Buffer | null
  certainty: 'unknown' | 'none'
  remotePk: string | null
}

/** Results remain recordable after cancellation; an already accepted effect is never erased. */
export async function checkpointAttachment(
  context: AttachmentJournalContext,
  intentId: string,
  kind: AttachmentRequestKind,
  result: AttachmentResult,
) {
  await executorTransaction(context.pool, async (client) => {
    await lockRun(client, context.runId)
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(executorAttachmentResults)
        .values({
          intentId,
          outcome: result.outcome,
          status: result.status,
          responseBytes: result.bytes && result.bytes.length <= 65536 ? result.bytes : null,
          responseDigest: result.bytes ? sha256(result.bytes) : null,
          responseSize: result.bytes ? BigInt(result.bytes.length) : null,
          remotePk: result.remotePk,
        }),
    )
    if (kind === 'create_attachment') {
      await executeDatabaseQuery(
        queryDatabase(client).insert(executorAttachmentEffects).values({
          intentId,
          runId: context.runId,
          artifactKey: context.operation.artifactKey,
          certainty: result.certainty,
          remotePk: result.remotePk,
        }),
      )
    }
  })
}

export async function recordAttachmentVerification(
  context: AttachmentJournalContext,
  intentId: string,
  createIntentId: string,
  outcome: 'matches' | 'missing_or_changed' | 'unavailable',
  remotePk: string | null,
  observed: AttachmentWire | null,
  verifiedDigest: Buffer | null,
) {
  await executorTransaction(context.pool, async (client) => {
    await lockRun(client, context.runId)
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(executorAttachmentVerifications)
        .values({
          id: randomUUID(),
          intentId,
          createIntentId,
          runId: context.runId,
          artifactKey: context.operation.artifactKey,
          outcome,
          remotePk,
          verifiedDigest,
          observedStockPk: observed?.stockPk ?? null,
          observedArtifactKey: observed?.artifactKey ?? null,
        }),
    )
  })
}
