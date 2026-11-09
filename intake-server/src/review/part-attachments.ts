import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { transferReadIntents, transferReadResults } from '../execution/schema.ts'
import { fail } from '../capture/model.ts'
import type { ManualMaterial } from './model.ts'
import { issue } from './model.ts'
import { retainedEvidence } from './media-plan.ts'
import type { PartBinding, EffectsPlan } from '../execution/effects-plan.ts'
import { logicalEffectKey } from '../execution/effects-plan.ts'
import {
  partDestinationKey,
  partTransferKey,
  type PartTransfer,
} from '../execution/part-attachment-plan.ts'
import { priorPartTransfer } from '../execution/part-attachment-index.ts'
import {
  partAttachmentMetadata,
  samePartAttachmentBytes,
  type PartAttachmentWire,
} from '../execution/part-attachment-wire.ts'
import { inventoryBody } from '../execution/response.ts'

export interface ManualAttachmentRead {
  metadata: (pk: string) => Promise<Response>
  file: (input: { pk: string; partPk: string; path: string }) => Promise<Response>
}

export async function selectedPartTransfers(
  client: PoolClient,
  source: { targetId: string; originalSourceKey: string },
  material: ManualMaterial,
  parts: PartBinding[],
): Promise<PartTransfer[]> {
  const evidence = retainedEvidence(material.mediaInputs ?? new Map())
  const transfers: PartTransfer[] = []
  for (const [subjectId, inputs] of material.mediaInputs ?? []) {
    const selection = inputs.attachments.find(
      (selection) =>
        selection.subject_id === subjectId &&
        selection.destination === 'part_attachment' &&
        selection.mode === 'selected',
    )
    if (!selection) {
      continue
    }
    if (!material.partDestinations.has(subjectId)) {
      fail('part_attachment_destination_missing', 409)
    }
    const binding = parts.find((part) => part.subjectId === subjectId)
    const part = binding?.prior?.pk ?? material.partDestinations.get(subjectId) ?? null
    const version = evidence.find((version) => version.versionId === selection.version_id)
    if (!version) {
      fail('part_attachment_evidence_missing', 409)
    }
    const transfer: PartTransfer = {
      artifactKey: selection.id,
      partSubjectId: subjectId,
      destinationKey: partDestinationKey(subjectId, part, binding),
      part,
      partOperationKey: part === null ? logicalEffectKey(subjectId, 'create_part') : null,
      version,
      prior: null,
    }
    transfer.prior = await priorPartTransfer(client, source, transfer)
    transfers.push(transfer)
  }
  return transfers.sort((left, right) =>
    partTransferKey(left).localeCompare(partTransferKey(right)),
  )
}

async function boundedResponse(send: () => Promise<Response>, deadline: number) {
  const remaining = Math.min(5000, deadline - Date.now())
  if (remaining <= 0) {
    throw new Error('preparation_read_budget_exceeded')
  }
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      send().then((response) => {
        if (expired) {
          void response.body?.cancel()
          throw new Error('preparation_read_budget_exceeded')
        }
        return response
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(new Error('preparation_read_budget_exceeded'))
        }, remaining)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function observePartTransfers(
  pool: Pool,
  read: ManualAttachmentRead | undefined,
  input: {
    batchId: string
    commandId: string
    targetId: string
    contextId: string
    originalSourceKey: string
    transfers: PartTransfer[]
  },
  deadline: number,
) {
  const issues = []
  for (const transfer of input.transfers) {
    if (!transfer.prior) {
      continue
    }
    if (!read || transfer.part === null) {
      issues.push(
        issue(
          'attachment_read_unavailable',
          'Complete known attachment reads are required before this transfer can be reused.',
        ),
      )
      continue
    }
    const prior = transfer.prior
    const wire: PartAttachmentWire = {
      artifactKey: prior.artifactKey,
      partPk: transfer.part,
      version: transfer.version,
    }
    let metadata: ReturnType<typeof partAttachmentMetadata> | null = null
    let metadataIntentId: string | null = null
    for (const kind of ['metadata', 'file'] as const) {
      if (kind === 'file' && !metadata) {
        break
      }
      const intentId = randomUUID()
      const spec = {
        kind,
        pk: prior.pk,
        partPk: transfer.part,
        versionId: transfer.version.versionId,
        blobDigest: transfer.version.blobDigest,
        ...(kind === 'file' ? { path: metadata!.path, metadataIntentId } : {}),
      }
      const bytes = Buffer.from(canonical(spec))
      await transaction(pool, async (client) => {
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(transferReadIntents)
            .values({
              id: intentId,
              batchId: input.batchId,
              prepareCommandId: input.commandId,
              transferKey: partTransferKey(transfer),
              targetId: input.targetId,
              contextId: input.contextId,
              originalKey: input.originalSourceKey,
              partSubjectId: transfer.partSubjectId,
              destinationKey: transfer.destinationKey,
              versionId: transfer.version.versionId,
              blobDigest: Buffer.from(transfer.version.blobDigest, 'hex'),
              originalRunId: prior.runId,
              originalOperationKey: prior.operationKey,
              originalIntentId: prior.intentId,
              kind,
              metadataParentId: kind === 'file' ? metadataIntentId : null,
              requestBytes: bytes,
              requestDigest: sha256(bytes),
            }),
        )
      })
      let verified = false
      let responseBytes: Buffer | null = null
      let status: number | null = null
      try {
        const response = await boundedResponse(
          () =>
            kind === 'metadata'
              ? read.metadata(prior.pk)
              : read.file({ pk: prior.pk, partPk: transfer.part!, path: metadata!.path }),
          deadline,
        )
        status = response.status
        responseBytes = await inventoryBody(
          response,
          kind === 'file' ? 20971520 : 65536,
          Math.max(1, Math.min(5000, deadline - Date.now())),
        )
        if (status !== 200 || Date.now() > deadline) {
          throw new Error('known_attachment_read_unavailable')
        }
        if (kind === 'metadata') {
          metadata = partAttachmentMetadata(responseBytes, prior.pk, wire)
          metadataIntentId = intentId
          verified = true
        } else {
          verified = samePartAttachmentBytes(responseBytes, wire)
        }
      } catch {
        verified = false
      }
      const receipt = Buffer.from(
        canonical({
          kind,
          pk: prior.pk,
          partPk: transfer.part,
          versionId: transfer.version.versionId,
          blobDigest: transfer.version.blobDigest,
          verified,
          ...(kind === 'file' ? { metadataIntentId } : {}),
        }),
      )
      await transaction(pool, async (client) => {
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(transferReadResults)
            .values({
              intentId,
              outcome: verified ? 'verified' : 'unavailable',
              status,
              responseBytes: responseBytes && responseBytes.length <= 65536 ? responseBytes : null,
              responseDigest: responseBytes ? sha256(responseBytes) : null,
              responseSize: responseBytes ? BigInt(responseBytes.length) : null,
              receiptBytes: receipt,
              receiptDigest: sha256(receipt),
            }),
        )
      })
      if (!verified) {
        issues.push(
          issue(
            'known_attachment_changed',
            'A previously confirmed attachment is missing, changed or unavailable. It will not be uploaded again.',
          ),
        )
        break
      }
    }
  }
  return issues
}

export async function requirePartTransferReads(
  client: PoolClient,
  batchId: string,
  commandId: string,
  plan: EffectsPlan,
) {
  const reads = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        intent: transferReadIntents,
        outcome: transferReadResults.outcome,
        receiptBytes: transferReadResults.receiptBytes,
        receiptDigest: transferReadResults.receiptDigest,
        responseDigest: transferReadResults.responseDigest,
        responseSize: transferReadResults.responseSize,
      })
      .from(transferReadIntents)
      .leftJoin(transferReadResults, eq(transferReadResults.intentId, transferReadIntents.id))
      .where(
        and(
          eq(transferReadIntents.batchId, batchId),
          eq(transferReadIntents.prepareCommandId, commandId),
        ),
      ),
  )
  const expected = plan.partAttachments.filter((transfer) => transfer.prior !== null)
  if (reads.length !== expected.length * 2) {
    throw new Error('part_transfer_read_authority_missing')
  }
  for (const transfer of expected) {
    const prior = transfer.prior!
    const rows = reads.filter((row) => row.intent.transferKey === partTransferKey(transfer))
    const metadata = rows.find((row) => row.intent.kind === 'metadata')
    const file = rows.find((row) => row.intent.kind === 'file')
    if (!metadata || !file || file.intent.metadataParentId !== metadata.intent.id) {
      throw new Error('part_transfer_read_parent_mismatch')
    }
    for (const row of rows) {
      const intent = row.intent
      if (
        row.outcome !== 'verified' ||
        intent.targetId !== plan.targetId ||
        intent.contextId !== plan.contextId ||
        intent.originalKey !== plan.originalSourceKey ||
        intent.partSubjectId !== transfer.partSubjectId ||
        intent.destinationKey !== transfer.destinationKey ||
        intent.versionId !== transfer.version.versionId ||
        intent.blobDigest.toString('hex') !== transfer.version.blobDigest ||
        intent.originalRunId !== prior.runId ||
        intent.originalOperationKey !== prior.operationKey ||
        intent.originalIntentId !== prior.intentId ||
        !row.responseDigest ||
        row.responseSize === null ||
        !row.receiptBytes ||
        !row.receiptDigest
      ) {
        throw new Error('part_transfer_read_authority_changed')
      }
      verifyBytes(intent.requestBytes, intent.requestDigest)
      verifyBytes(row.receiptBytes, row.receiptDigest)
      const expectedReceipt = canonical({
        kind: intent.kind,
        pk: prior.pk,
        partPk: transfer.part,
        versionId: transfer.version.versionId,
        blobDigest: transfer.version.blobDigest,
        verified: true,
        ...(intent.kind === 'file' ? { metadataIntentId: metadata.intent.id } : {}),
      })
      if (row.receiptBytes.toString('utf8') !== expectedReceipt) {
        throw new Error('part_transfer_read_receipt_changed')
      }
      if (
        intent.kind === 'file' &&
        (row.responseDigest.toString('hex') !== transfer.version.blobDigest ||
          String(row.responseSize) !== transfer.version.byteSize)
      ) {
        throw new Error('part_transfer_read_content_changed')
      }
    }
  }
}
