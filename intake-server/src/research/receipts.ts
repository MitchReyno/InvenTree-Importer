import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import { canonical, strictJson } from '@invimport/contracts/json'
import {
  validate,
  type ResearchReceiptDto,
  type ResearchReceiptDescriptorDto,
  type ResearchReceiptSourceDto,
} from '@invimport/contracts'
import { captureInTransaction, type CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { sha256, verifyBytes } from '../db/authority.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { ResearchError, refuseResearch } from './errors.ts'
import {
  MAX_RESEARCH_RECEIPTS,
  MAX_RESEARCH_RECEIPT_BYTES,
  MAX_RESEARCH_SOURCE_BYTES,
} from './limits.ts'
import { researchReceipts } from './schema.ts'

export interface ResearchReceiptScope extends CaptureBinding {
  batchId: string
  attemptId: string
  commandId: string
  inputSha256: string
  sourceUrls: readonly string[]
}

export interface ResearchSourceBody {
  kind: 'web' | 'inventory'
  mediaType: 'text/html' | 'text/plain' | 'application/pdf' | 'application/json'
  sourceUrl?: string
  bytes: Buffer
}

export interface ResearchReceiptRepository {
  read: (receiptId: string) => Promise<{ receipt: ResearchReceiptDto; bytes: Buffer }>
  publish: (
    requestId: string,
    request: unknown,
    source: ResearchSourceBody,
  ) => Promise<ResearchReceiptDto>
}

type ReceiptRow = typeof researchReceipts.$inferSelect

function scopeConditions(scope: ResearchReceiptScope) {
  return and(
    eq(researchReceipts.batchId, scope.batchId),
    eq(researchReceipts.attemptId, scope.attemptId),
    eq(researchReceipts.commandId, scope.commandId),
    eq(researchReceipts.actorId, scope.actorId),
    eq(researchReceipts.targetId, scope.targetId),
    eq(researchReceipts.targetContextId, scope.targetContextId),
  )
}

function verifiedReceipt(row: ReceiptRow, scope: ResearchReceiptScope) {
  try {
    verifyBytes(row.bodyBytes, row.bodyDigest)
    verifyBytes(row.descriptorBytes, row.descriptorDigest)
    const decoded = strictJson(row.descriptorBytes.toString('utf8'))
    validate('ResearchReceiptDescriptor', decoded)
    const descriptor = decoded as ResearchReceiptDescriptorDto
    if (canonical(descriptor) !== row.descriptorBytes.toString('utf8')) {
      refuseResearch('research_receipt_corrupt')
    }
    const expected: ResearchReceiptDescriptorDto = {
      schema_version: 'bench-intake-research-receipt/1',
      batch_id: scope.batchId,
      attempt_id: scope.attemptId,
      command_id: scope.commandId,
      actor_id: scope.actorId,
      target_id: scope.targetId,
      target_context_id: scope.targetContextId,
      input_sha256: scope.inputSha256,
      request_id: row.requestId,
      request_sha256: descriptor.request_sha256,
      receipt: {
        id: row.id,
        kind: row.kind,
        sha256: row.bodyDigest.toString('hex'),
        byte_size: row.byteSize.toString(),
        media_type: row.mediaType,
        ...(row.sourceUrl === null ? {} : { source_url: row.sourceUrl }),
      },
    }
    let request: unknown
    if (row.kind === 'web') {
      if (
        !row.sourceUrl ||
        !scope.sourceUrls.includes(row.sourceUrl) ||
        !['text/html', 'text/plain', 'application/pdf'].includes(row.mediaType)
      ) {
        refuseResearch('research_receipt_corrupt')
      }
      request = { url: row.sourceUrl }
    } else {
      if (row.sourceUrl !== null || row.mediaType !== 'application/json') {
        refuseResearch('research_receipt_corrupt')
      }
      const observation = strictJson(row.bodyBytes.toString('utf8'))
      validate('ResearchInventoryObservation', observation)
      const record = observation as { model: 'part' | 'location'; pk: string; label: string }
      if (canonical(record) !== row.bodyBytes.toString('utf8')) {
        refuseResearch('research_receipt_corrupt')
      }
      request = { model: record.model, pk: record.pk }
    }
    if (
      canonical(expected) !== canonical(descriptor) ||
      row.byteSize !== BigInt(row.bodyBytes.length) ||
      row.bodyBytes.length === 0 ||
      row.bodyBytes.length > MAX_RESEARCH_SOURCE_BYTES ||
      descriptor.request_sha256 !== sha256(Buffer.from(canonical(request))).toString('hex')
    ) {
      refuseResearch('research_receipt_corrupt')
    }
    return descriptor
  } catch (error) {
    if (error instanceof ResearchError) {
      throw error
    }
    throw new ResearchError('research_receipt_corrupt', { cause: error })
  }
}

async function selectReceipt(client: PoolClient, scope: ResearchReceiptScope, receiptId: string) {
  await prepareMediaTransaction(client)
  await captureInTransaction(client, scope, scope.batchId)
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(researchReceipts)
      .where(and(scopeConditions(scope), eq(researchReceipts.id, receiptId))),
  )
  const row = rows[0]
  if (!row) {
    refuseResearch('research_receipt_missing')
  }
  return { row, descriptor: verifiedReceipt(row, scope) }
}

/** Shared caller transaction verifies immutable receipt authority without acquiring domain locks. */
export async function verifyResearchReceiptSources(
  client: PoolClient,
  scope: ResearchReceiptScope,
  sources: readonly ResearchReceiptSourceDto[],
): Promise<void> {
  for (const source of sources) {
    const { descriptor } = await selectReceipt(client, scope, source.receipt_id)
    if (descriptor.receipt.sha256 !== source.sha256) {
      refuseResearch('research_receipt_corrupt')
    }
  }
}

export function researchReceiptStore(
  pool: Pool,
  suppliedScope: ResearchReceiptScope,
): ResearchReceiptRepository {
  const scope = Object.freeze({
    ...suppliedScope,
    sourceUrls: Object.freeze([...suppliedScope.sourceUrls]),
  })

  async function read(receiptId: string) {
    return transaction(pool, async (client) => {
      const { row, descriptor } = await selectReceipt(client, scope, receiptId)
      return { receipt: descriptor.receipt, bytes: row.bodyBytes }
    })
  }

  async function publish(
    requestId: string,
    request: unknown,
    source: ResearchSourceBody,
  ): Promise<ResearchReceiptDto> {
    if (source.bytes.length === 0 || source.bytes.length > MAX_RESEARCH_SOURCE_BYTES) {
      refuseResearch('research_capacity')
    }
    if (
      source.kind === 'web' &&
      (!source.sourceUrl || !scope.sourceUrls.includes(source.sourceUrl))
    ) {
      refuseResearch('research_source_refused')
    }
    const requestDigest = sha256(Buffer.from(canonical(request))).toString('hex')
    return transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      await captureInTransaction(client, scope, scope.batchId)
      // Only this audit repository takes the budget lock; it acquires no later domain lock.
      await executeDatabaseQuery(
        queryDatabase(client).execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`research-receipt/1:${scope.attemptId}`},0))`,
        ),
      )
      const priorRows = await executeDatabaseQuery(
        queryDatabase(client)
          .select()
          .from(researchReceipts)
          .where(and(scopeConditions(scope), eq(researchReceipts.requestId, requestId))),
      )
      const prior = priorRows[0]
      if (prior) {
        const descriptor = verifiedReceipt(prior, scope)
        const exactSource =
          descriptor.request_sha256 === requestDigest &&
          prior.kind === source.kind &&
          prior.mediaType === source.mediaType &&
          prior.sourceUrl === (source.sourceUrl ?? null) &&
          prior.bodyBytes.equals(source.bytes)
        if (!exactSource) {
          refuseResearch('research_protocol_invalid')
        }
        return descriptor.receipt
      }
      const budgets = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            count: sql<string>`count(*)::text`,
            size: sql<string>`coalesce(sum(byte_size),0)::text`,
          })
          .from(researchReceipts)
          .where(eq(researchReceipts.attemptId, scope.attemptId)),
      )
      const budget = budgets[0]
      if (
        BigInt(budget.count) >= BigInt(MAX_RESEARCH_RECEIPTS) ||
        BigInt(budget.size) + BigInt(source.bytes.length) > BigInt(MAX_RESEARCH_RECEIPT_BYTES)
      ) {
        refuseResearch('research_capacity')
      }
      const receipt: ResearchReceiptDto = {
        id: randomUUID(),
        kind: source.kind,
        sha256: sha256(source.bytes).toString('hex'),
        byte_size: String(source.bytes.length),
        media_type: source.mediaType,
        ...(source.sourceUrl === undefined ? {} : { source_url: source.sourceUrl }),
      }
      const descriptor: ResearchReceiptDescriptorDto = {
        schema_version: 'bench-intake-research-receipt/1',
        batch_id: scope.batchId,
        attempt_id: scope.attemptId,
        command_id: scope.commandId,
        actor_id: scope.actorId,
        target_id: scope.targetId,
        target_context_id: scope.targetContextId,
        input_sha256: scope.inputSha256,
        request_id: requestId,
        request_sha256: requestDigest,
        receipt,
      }
      validate('ResearchReceiptDescriptor', descriptor)
      const descriptorBytes = Buffer.from(canonical(descriptor))
      const row: ReceiptRow = {
        id: receipt.id,
        batchId: scope.batchId,
        attemptId: scope.attemptId,
        commandId: scope.commandId,
        actorId: scope.actorId,
        targetId: scope.targetId,
        targetContextId: scope.targetContextId,
        requestId,
        kind: source.kind,
        sourceUrl: source.sourceUrl ?? null,
        mediaType: source.mediaType,
        byteSize: BigInt(source.bytes.length),
        bodyBytes: source.bytes,
        bodyDigest: Buffer.from(receipt.sha256, 'hex'),
        descriptorBytes,
        descriptorDigest: sha256(descriptorBytes),
      }
      verifiedReceipt(row, scope)
      await executeDatabaseQuery(queryDatabase(client).insert(researchReceipts).values(row))
      return receipt
    })
  }

  return Object.freeze({ read, publish })
}
