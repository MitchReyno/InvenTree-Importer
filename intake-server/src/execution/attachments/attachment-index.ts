import type { PoolClient, Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import { executorAttachments } from '../schema.ts'
import { canonical } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../../db/authority.ts'
import { attachmentOperations, type ExecutablePlan } from '../media-plan.ts'

export async function retainAttachmentIndex(
  client: PoolClient,
  runId: string,
  plan: ExecutablePlan,
) {
  for (const attachment of attachmentOperations(plan)) {
    const bytes = Buffer.from(canonical(attachment))
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(executorAttachments)
        .values({
          runId,
          artifactKey: attachment.artifactKey,
          stockOperationKey: attachment.stockOperationKey,
          requestBytes: bytes,
          requestDigest: sha256(bytes),
        }),
    )
  }
}

export async function requireAttachmentIndex(
  client: Pool | PoolClient,
  runId: string,
  plan: ExecutablePlan,
) {
  if (plan.version === 'bench-stock-plan/1') {
    // Historical foundation/stock-only migration fixtures need no media tables.
    return
  }
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        artifact_key: executorAttachments.artifactKey,
        stock_operation_key: executorAttachments.stockOperationKey,
        request_bytes: executorAttachments.requestBytes,
        request_digest: executorAttachments.requestDigest,
      })
      .from(executorAttachments)
      .where(eq(executorAttachments.runId, runId)),
  )
  if (result.length !== plan.attachments.length) {
    throw new Error('attachment_authority_missing')
  }
  for (const attachment of plan.attachments) {
    const indexed = result.find((row) => row.artifact_key === attachment.artifactKey)
    if (!indexed || indexed.stock_operation_key !== attachment.stockOperationKey) {
      throw new Error('attachment_authority_mismatch')
    }
    verifyBytes(indexed.request_bytes, indexed.request_digest)
    if (!indexed.request_bytes.equals(Buffer.from(canonical(attachment)))) {
      throw new Error('attachment_bytes_mismatch')
    }
  }
}
