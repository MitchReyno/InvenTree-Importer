import type { PoolClient } from 'pg'
import { attachmentOperations, type ExecutablePlan } from './media-plan.ts'

export interface KnownStockOutput {
  operationKey: string
  certainty: 'confirmed' | 'unknown' | 'none'
  remotePk: string | null
}

export interface AttachmentState {
  artifactKey: string
  stockOperationKey: string
  versionId: string
  blobDigest: string
  byteSize: string
  kind: 'original' | 'derived'
  certainty: 'confirmed' | 'unknown' | 'none'
  remotePk: string | null
  verification: 'matches' | 'missing_or_changed' | 'unavailable' | null
}

interface CreateRow {
  id: string
  artifact_key: string
  certainty: 'unknown' | 'none' | null
  remote_pk: string | null
}

interface VerificationRow {
  create_intent_id: string
  artifact_key: string
  outcome: 'matches' | 'missing_or_changed' | 'unavailable'
  remote_pk: string | null
  verified_digest: Buffer | null
  observed_stock_pk: string | null
  observed_artifact_key: string | null
}

/** A later missing file never erases the originally verified historical effect. */
export async function attachmentStates(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  plan: ExecutablePlan,
  stocks: readonly KnownStockOutput[],
): Promise<AttachmentState[]> {
  if (plan.version === 'bench-stock-plan/1') {
    return []
  }
  const creates = await client.query<CreateRow>(
    `SELECT i.id,i.artifact_key,e.certainty,e.remote_pk
     FROM executor_attachment_intent i
     LEFT JOIN executor_attachment_effect e ON e.intent_id=i.id
     WHERE i.run_id=$1 AND i.kind='create_attachment' ORDER BY i.created_at,i.id`,
    [runId],
  )
  const verified = await client.query<VerificationRow>(
    `SELECT create_intent_id,artifact_key,outcome,remote_pk,verified_digest,
            observed_stock_pk,observed_artifact_key
     FROM executor_attachment_verification WHERE run_id=$1 ORDER BY created_at,id`,
    [runId],
  )
  return attachmentOperations(plan).map((attachment) => {
    const stock = stocks.find((output) => output.operationKey === attachment.stockOperationKey)
    const attempts = creates.rows.filter(
      (attempt) => attempt.artifact_key === attachment.artifactKey,
    )
    const receipts = verified.rows.filter(
      (receipt) => receipt.artifact_key === attachment.artifactKey,
    )
    const positiveByIntent = new Map<string, VerificationRow>()
    for (const receipt of receipts) {
      const attempt = attempts.find((candidate) => candidate.id === receipt.create_intent_id)
      const sameIdentity =
        attempt && (!attempt.remote_pk || attempt.remote_pk === receipt.remote_pk)
      const sameDomain =
        receipt.observed_artifact_key === attachment.artifactKey &&
        stock?.certainty === 'confirmed' &&
        receipt.observed_stock_pk === stock.remotePk
      const exactBytes = receipt.verified_digest?.toString('hex') === attachment.blobDigest
      if (receipt.outcome === 'matches' && sameIdentity && sameDomain && exactBytes) {
        positiveByIntent.set(receipt.create_intent_id, receipt)
      }
    }
    const unresolved = attempts.some(
      (attempt) => attempt.certainty !== 'none' && !positiveByIntent.has(attempt.id),
    )
    const positive = [...positiveByIntent.values()][0]
    let certainty: AttachmentState['certainty'] = 'none'
    if (unresolved) {
      certainty = 'unknown'
    } else if (positive) {
      certainty = 'confirmed'
    }
    const latestReceipt = receipts.at(-1)
    const attributed = attempts.find((attempt) => attempt.remote_pk)
    return {
      artifactKey: attachment.artifactKey,
      stockOperationKey: attachment.stockOperationKey,
      versionId: attachment.versionId,
      blobDigest: attachment.blobDigest,
      byteSize: attachment.byteSize,
      kind: attachment.kind,
      certainty,
      remotePk: positive?.remote_pk ?? attributed?.remote_pk ?? null,
      verification: latestReceipt?.outcome ?? null,
    }
  })
}
