import { isEffectsPlan } from '#/execution/effects/effects-plan.ts'
import { and, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { partTransfers, executorRuns, executorApprovals } from '#/execution/schema.ts'
import { decodeExecutablePlan } from '#/execution/media-plan.ts'
import { supportedStates } from '#/execution/effects/effects-state.ts'
import type { EffectsPlan } from '#/execution/effects/effects-plan.ts'
import { partTransferKey, type PartTransfer } from './part-attachment-plan.ts'

function retainedTransfer(
  plan: Pick<EffectsPlan, 'targetId' | 'originalSourceKey'>,
  transfer: PartTransfer,
) {
  return and(
    eq(partTransfers.targetId, plan.targetId),
    eq(partTransfers.originalKey, plan.originalSourceKey),
    eq(partTransfers.partSubjectId, transfer.partSubjectId),
    eq(partTransfers.destinationKey, transfer.destinationKey),
    eq(partTransfers.versionId, transfer.version.versionId),
    eq(partTransfers.blobDigest, Buffer.from(transfer.version.blobDigest, 'hex')),
  )
}

export async function priorPartTransfer(
  client: Pool | PoolClient,
  plan: Pick<EffectsPlan, 'targetId' | 'originalSourceKey'>,
  transfer: PartTransfer,
): Promise<PartTransfer['prior']> {
  const transferRows = await executeDatabaseQuery(
    queryDatabase(client).select().from(partTransfers).where(retainedTransfer(plan, transfer)),
  )
  const row = transferRows[0]
  if (!row) {
    return null
  }
  const approved = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        plan_bytes: executorApprovals.planBytes,
        plan_digest: executorApprovals.planDigest,
      })
      .from(executorRuns)
      .innerJoin(executorApprovals, eq(executorApprovals.id, executorRuns.approvalId))
      .where(eq(executorRuns.id, row.runId)),
  )
  const authority = approved[0]
  if (!authority) {
    throw new Error('part_transfer_history_missing')
  }
  const original = decodeExecutablePlan(authority.plan_bytes, authority.plan_digest)
  if (
    !isEffectsPlan(original) ||
    original.targetId !== plan.targetId ||
    original.originalSourceKey !== plan.originalSourceKey
  ) {
    throw new Error('part_transfer_history_invalid')
  }
  const retained = original.partAttachments.find(
    (item) => partTransferKey(item) === row.operationKey,
  )
  if (
    !retained ||
    retained.prior !== null ||
    retained.partSubjectId !== transfer.partSubjectId ||
    retained.destinationKey !== transfer.destinationKey ||
    retained.version.versionId !== transfer.version.versionId ||
    retained.version.blobDigest !== transfer.version.blobDigest ||
    retained.artifactKey !== row.artifactKey
  ) {
    throw new Error('part_transfer_history_invalid')
  }
  const output = (await supportedStates(client, row.runId, original)).find(
    (item) => item.operationKey === row.operationKey,
  )
  if (
    output?.certainty !== 'confirmed' ||
    output.remotePks.length !== 1 ||
    !output.createIntentId
  ) {
    throw new Error('part_transfer_history_unconfirmed')
  }
  return {
    runId: row.runId,
    operationKey: row.operationKey,
    intentId: output.createIntentId,
    pk: output.remotePks[0],
    artifactKey: row.artifactKey,
  }
}

export async function retainPartTransfers(client: PoolClient, runId: string, plan: EffectsPlan) {
  for (const transfer of plan.partAttachments) {
    if (transfer.prior) {
      await requirePriorPartTransfer(client, plan, transfer)
      continue
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(partTransfers)
        .values({
          targetId: plan.targetId,
          originalKey: plan.originalSourceKey,
          partSubjectId: transfer.partSubjectId,
          destinationKey: transfer.destinationKey,
          versionId: transfer.version.versionId,
          blobDigest: Buffer.from(transfer.version.blobDigest, 'hex'),
          runId,
          operationKey: partTransferKey(transfer),
          artifactKey: transfer.artifactKey,
        }),
    )
  }
}

export async function requirePriorPartTransfer(
  client: Pool | PoolClient,
  plan: EffectsPlan,
  transfer: PartTransfer,
) {
  const prior = await priorPartTransfer(client, plan, { ...transfer, prior: null })
  if (
    !prior ||
    !transfer.prior ||
    Object.entries(prior).some(
      ([key, value]) => value !== transfer.prior![key as keyof typeof prior],
    )
  ) {
    throw new Error('part_transfer_history_changed')
  }
}

export async function requirePartTransfers(
  client: Pool | PoolClient,
  runId: string,
  plan: EffectsPlan,
) {
  for (const transfer of plan.partAttachments) {
    if (transfer.prior) {
      await requirePriorPartTransfer(client, plan, transfer)
      continue
    }
    const retained = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          runId: partTransfers.runId,
          operationKey: partTransfers.operationKey,
          artifactKey: partTransfers.artifactKey,
        })
        .from(partTransfers)
        .where(retainedTransfer(plan, transfer)),
    )
    const row = retained[0]
    if (
      !row ||
      row.runId !== runId ||
      row.operationKey !== partTransferKey(transfer) ||
      row.artifactKey !== transfer.artifactKey
    ) {
      throw new Error('part_transfer_authority_missing')
    }
  }
}
