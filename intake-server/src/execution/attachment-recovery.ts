import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { lockRun, snapshot } from './authority.ts'

export interface AttachmentRecovery {
  id: string
  run_id: string
  artifact_key: string
  kind: 'repair_attachment' | 'verify_attachment'
  create_intent_id: string | null
  cancel_version: string
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
    const creates = await client.query<{ id: string; certainty: string | null }>(
      `SELECT i.id,e.certainty FROM executor_attachment_intent i
       LEFT JOIN executor_attachment_effect e ON e.intent_id=i.id
       WHERE i.run_id=$1 AND i.artifact_key=$2 AND i.kind='create_attachment' ORDER BY i.attempt DESC`,
      [runId, artifactKey],
    )
    createIntentId = creates.rows.find((attempt) => attempt.certainty !== 'none')?.id ?? null
    if (!createIntentId) {
      throw new Error('attachment_create_authority_missing')
    }
  }
  const cancellation = await client.query<{ version: string }>(
    'SELECT COALESCE(max(id),0) AS version FROM executor_cancel WHERE run_id=$1',
    [runId],
  )
  const recoveryId = randomUUID()
  await client.query(
    `INSERT INTO executor_attachment_recovery(id,run_id,artifact_key,actor_id,cancel_version,kind,create_intent_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [recoveryId, runId, artifactKey, actorId, cancellation.rows[0].version, kind, createIntentId],
  )
  await client.query(
    'UPDATE executor_guard SET active_run=$3 WHERE target_id=$1 AND original_key=$2',
    [authority.plan.targetId, authority.plan.originalSourceKey, runId],
  )
  return recoveryId
}

export async function attachmentVerificationOnly(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  recoveryIds: readonly string[],
): Promise<boolean> {
  if (!recoveryIds.length) {
    return false
  }
  const selected = await client.query<AttachmentRecovery>(
    'SELECT * FROM executor_attachment_recovery WHERE run_id=$1 AND id=ANY($2::uuid[])',
    [runId, recoveryIds],
  )
  return (
    selected.rows.length === recoveryIds.length &&
    selected.rows.every((recovery) => recovery.kind === 'verify_attachment')
  )
}
