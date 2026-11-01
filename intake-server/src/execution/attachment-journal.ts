import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import type { AttachmentWire } from '../inventory/transport.ts'
import { executorTransaction } from './transaction.ts'
import { lockRun, snapshot } from './authority.ts'
import { attachmentOperations, type AttachmentOperation } from './media-plan.ts'

export type AttachmentRequestKind =
  'create_attachment' | 'get_attachment' | 'download_attachment' | 'lookup_attachment' | 'get_stock'

export interface AttachmentJournalContext {
  pool: Pool
  runId: string
  operation: AttachmentOperation
  recoveryId: string | null
  health: () => Promise<void>
}

interface PriorAttempt {
  recovery_id: string | null
  certainty: 'unknown' | 'none' | null
  outcome: string | null
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
    const guard = await client.query<{ active_run: string | null }>(
      'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2',
      [authority.plan.targetId, authority.plan.originalSourceKey],
    )
    if (guard.rows[0].active_run !== context.runId) {
      throw new Error('source_not_owned')
    }
    const cancellation = await client.query<{ version: string }>(
      'SELECT COALESCE(max(id),0) AS version FROM executor_cancel WHERE run_id=$1',
      [context.runId],
    )
    const cancelVersion = cancellation.rows[0].version
    if (cancelVersion !== '0' && !context.recoveryId) {
      return null
    }
    if (context.recoveryId) {
      const recovery = await client.query<{ cancel_version: string; kind: string }>(
        `SELECT cancel_version,kind FROM executor_attachment_recovery
         WHERE id=$1 AND run_id=$2 AND artifact_key=$3`,
        [context.recoveryId, context.runId, context.operation.artifactKey],
      )
      const selected = recovery.rows[0]
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
    const prior = await client.query<PriorAttempt>(
      `SELECT i.recovery_id,e.certainty,r.outcome FROM executor_attachment_intent i
       LEFT JOIN executor_attachment_effect e ON e.intent_id=i.id
       LEFT JOIN executor_attachment_result r ON r.intent_id=i.id
       WHERE i.run_id=$1 AND i.artifact_key=$2 AND i.kind=$3 ORDER BY i.attempt`,
      [context.runId, context.operation.artifactKey, kind],
    )
    const reusedSelection = prior.rows.some((attempt) => attempt.recovery_id === context.recoveryId)
    if (prior.rowCount && (!context.recoveryId || reusedSelection)) {
      throw new Error('selected_attachment_recovery_required')
    }
    if (
      kind === 'create_attachment' &&
      prior.rows.some((attempt) => attempt.certainty !== 'none')
    ) {
      throw new Error('attachment_create_not_recoverable')
    }
    await client.query(
      `INSERT INTO executor_attachment_intent(id,run_id,artifact_key,attempt,recovery_id,kind,request_bytes,request_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        context.runId,
        context.operation.artifactKey,
        prior.rows.length + 1,
        context.recoveryId,
        kind,
        bytes,
        sha256(bytes),
      ],
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
    await client.query(
      `INSERT INTO executor_attachment_result(intent_id,outcome,status,response_bytes,response_digest,response_size,remote_pk)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        intentId,
        result.outcome,
        result.status,
        result.bytes && result.bytes.length <= 65536 ? result.bytes : null,
        result.bytes ? sha256(result.bytes) : null,
        result.bytes ? String(result.bytes.length) : null,
        result.remotePk,
      ],
    )
    if (kind === 'create_attachment') {
      await client.query(
        `INSERT INTO executor_attachment_effect(intent_id,run_id,artifact_key,certainty,remote_pk)
         VALUES($1,$2,$3,$4,$5)`,
        [intentId, context.runId, context.operation.artifactKey, result.certainty, result.remotePk],
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
    await client.query(
      `INSERT INTO executor_attachment_verification(id,intent_id,create_intent_id,run_id,artifact_key,
          outcome,remote_pk,verified_digest,observed_stock_pk,observed_artifact_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        intentId,
        createIntentId,
        context.runId,
        context.operation.artifactKey,
        outcome,
        remotePk,
        verifiedDigest,
        observed?.stockPk ?? null,
        observed?.artifactKey ?? null,
      ],
    )
  })
}
