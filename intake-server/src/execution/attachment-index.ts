import type { PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { attachmentOperations, type ExecutablePlan } from './media-plan.ts'

export async function retainAttachmentIndex(
  client: PoolClient,
  runId: string,
  plan: ExecutablePlan,
) {
  for (const attachment of attachmentOperations(plan)) {
    const bytes = Buffer.from(canonical(attachment))
    await client.query(
      `INSERT INTO executor_attachment(run_id,artifact_key,stock_operation_key,request_bytes,request_digest)
       VALUES($1,$2,$3,$4,$5)`,
      [runId, attachment.artifactKey, attachment.stockOperationKey, bytes, sha256(bytes)],
    )
  }
}

export async function requireAttachmentIndex(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  plan: ExecutablePlan,
) {
  if (plan.version === 'bench-stock-plan/1') {
    // Historical foundation/stock-only migration fixtures need no media tables.
    return
  }
  const result = await client.query<{
    artifact_key: string
    stock_operation_key: string
    request_bytes: Buffer
    request_digest: Buffer
  }>('SELECT * FROM executor_attachment WHERE run_id=$1', [runId])
  if (result.rows.length !== plan.attachments.length) {
    throw new Error('attachment_authority_missing')
  }
  for (const attachment of plan.attachments) {
    const indexed = result.rows.find((row) => row.artifact_key === attachment.artifactKey)
    if (!indexed || indexed.stock_operation_key !== attachment.stockOperationKey) {
      throw new Error('attachment_authority_mismatch')
    }
    verifyBytes(indexed.request_bytes, indexed.request_digest)
    if (!indexed.request_bytes.equals(Buffer.from(canonical(attachment)))) {
      throw new Error('attachment_bytes_mismatch')
    }
  }
}
