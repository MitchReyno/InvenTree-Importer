import { isEffectsPlan } from '../execution/effects-plan.ts'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { streams } from '../db/schema.ts'
import { mediaEvidence } from '../media/schema.ts'
import {
  manualPreparations,
  manualPrepareOutcomes,
  manualPreparationReviews,
  manualReviews,
  manualPreparationLots,
  manualPrepareCommands,
  manualReadIntents,
  manualReadResults,
  manualRuns,
  manualApprovals,
  manualDispatches,
} from './schema.ts'
import { preparationColumns, prepareCommandColumns, runColumns } from './row-projections.ts'
import { partIdentitySatisfies } from '../inventory/part-identity.ts'
import { supportedEffectsPreview, partAttachmentsPreview } from './effects-preview.ts'
import { requirePartTransferReads } from './part-attachments.ts'
import { supportedStates } from '../execution/effects-state.ts'
import { logicalEffectKey } from '../execution/effects-plan.ts'
import type { PoolClient } from 'pg'
import {
  validate,
  Id,
  Digest,
  type ManualPreparationResultDto,
  type ManualRunDto,
} from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { verifyBytes } from '../db/authority.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { fail } from '../capture/model.ts'
import { partSpecReferences } from '../capture/part-spec.ts'
import type { InventoryMappingDto } from '@invimport/contracts'
import { decodeExecutablePlan } from '../execution/media-plan.ts'
import { requirePreparationMedia } from './media-preparation.ts'
import { evidencePreview } from './media-preview.ts'
import { snapshot } from '../execution/authority.ts'
import type { ManualConfig } from './authority.ts'
import type { ReviewBinding } from './authority.ts'

function isReviewBinding(value: unknown): value is ReviewBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).sort().join(',') === 'digest,reviewId,subjectId' &&
    typeof record.digest === 'string' &&
    new RegExp(Digest.pattern!).test(record.digest) &&
    typeof record.reviewId === 'string' &&
    new RegExp(Id.pattern!).test(record.reviewId) &&
    typeof record.subjectId === 'string' &&
    new RegExp(Id.pattern!).test(record.subjectId)
  )
}

function usesLocationDraft(bytes: Buffer) {
  const value: unknown = strictJson(bytes.toString('utf8'))
  const facts =
    value && typeof value === 'object' && !Array.isArray(value) && 'facts' in value
      ? value.facts
      : value
  return !!facts && typeof facts === 'object' && !Array.isArray(facts) && 'locationDraft' in facts
}

export async function retainedPreparation(
  client: PoolClient,
  config: ManualConfig,
  preparationId: string,
) {
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select(preparationColumns)
      .from(manualPreparations)
      .where(
        and(
          eq(manualPreparations.id, preparationId),
          eq(manualPreparations.actorId, config.actorId),
        ),
      ),
  )
  const row = result[0]
  if (!row) {
    fail('not_found', 404)
  }
  const plan = decodeExecutablePlan(row.plan_bytes, row.plan_digest)
  if (plan.targetId !== config.targetId || plan.contextId !== config.targetContextId) {
    fail('not_found', 404)
  }
  verifyBytes(row.review_bytes, row.review_digest)
  verifyBytes(row.dependency_bytes, row.dependency_digest)
  const outcomeResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        command_id: manualPrepareOutcomes.commandId,
        response_bytes: manualPrepareOutcomes.responseBytes,
        response_digest: manualPrepareOutcomes.responseDigest,
      })
      .from(manualPrepareOutcomes)
      .where(eq(manualPrepareOutcomes.commandId, row.prepare_command_id)),
  )
  const outcome = outcomeResult[0]
  if (!outcome || outcome.command_id !== row.prepare_command_id) {
    fail('retained_preparation_corrupt', 409)
  }
  verifyBytes(outcome.response_bytes, outcome.response_digest)
  const sealed: unknown = strictJson(outcome.response_bytes.toString('utf8'))
  validate('ManualPreparationResult', sealed)
  const response = sealed as ManualPreparationResultDto
  if (
    response.status !== 'prepared' ||
    canonical(response) !== outcome.response_bytes.toString('utf8') ||
    canonical(response.preparation) !== row.preview_bytes.toString('utf8')
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const checked = response.preparation
  if (
    isEffectsPlan(plan) &&
    (canonical(checked.supported_effects) !== canonical(supportedEffectsPreview(plan)) ||
      canonical(checked.part_attachments) !==
        canonical(partAttachmentsPreview(plan, checked.effects)))
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  if (checked.capability !== plan.capability) {
    fail('retained_preparation_corrupt', 409)
  }
  if (plan.version !== 'bench-stock-plan/1') {
    const evidence = plan.evidence.map(evidencePreview)
    if (
      checked.media_inputs_sha256 !== plan.mediaInputsDigest ||
      canonical(checked.evidence) !== canonical(evidence) ||
      !checked.attachments ||
      checked.attachments.length !== plan.attachments.length
    ) {
      fail('retained_preparation_corrupt', 409)
    }
    const labels = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: mediaEvidence.id, label: mediaEvidence.label })
        .from(mediaEvidence)
        .where(
          and(
            eq(mediaEvidence.batchId, row.batch_id),
            inArray(
              mediaEvidence.id,
              plan.attachments.map((attachment) => attachment.evidenceId),
            ),
          ),
        ),
    )
    const evidenceLabels = new Map(labels.map((evidence) => [evidence.id, evidence.label]))
    for (const attachment of plan.attachments) {
      const shown = checked.attachments.find(
        (candidate) => candidate.artifact_key === attachment.artifactKey,
      )
      const lot = checked.effects.find((effect) => effect.lot_id === attachment.stockOperationKey)
      const expected = {
        ...evidencePreview(attachment),
        artifact_key: attachment.artifactKey,
        lot_id: attachment.stockOperationKey,
        lot_label: lot?.lot_label,
        evidence_label: evidenceLabels.get(attachment.evidenceId),
        destination: attachment.destination,
      }
      if (!shown || !lot || canonical(shown) !== canonical(expected)) {
        fail('retained_preparation_corrupt', 409)
      }
    }
  } else if (checked.attachments || checked.evidence || checked.media_inputs_sha256) {
    fail('retained_preparation_corrupt', 409)
  }
  if (
    checked.id !== row.id ||
    checked.batch_id !== row.batch_id ||
    checked.plan_sha256 !== row.plan_digest.toString('hex') ||
    checked.review_fingerprint !== row.review_digest.toString('hex') ||
    checked.target_revision !== row.target_revision ||
    checked.effects.length !== plan.operations.length
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  for (const effect of checked.effects) {
    const operation = plan.operations.find((value) => value.operationKey === effect.lot_id)
    if (
      !operation ||
      operation.contributionKey !== effect.contribution_key ||
      operation.quantity !== effect.quantity ||
      operation.part !== effect.part_id ||
      (isEffectsPlan(plan) &&
        operation.part === null &&
        (!('part_operation_key' in effect) ||
          !('partOperationKey' in operation) ||
          operation.partOperationKey !== effect.part_operation_key)) ||
      operation.location !== effect.location_id ||
      (('locationOperationKey' in operation ? operation.locationOperationKey : null) ??
        undefined) !== effect.location_operation_key ||
      operation.barcode !== effect.barcode
    ) {
      fail('retained_preparation_corrupt', 409)
    }
  }
  const operationIds = plan.operations.map((value) => value.operationKey).sort()
  if (
    canonical([...checked.selected_lot_ids].sort()) !== canonical(operationIds) ||
    canonical(checked.effects.map((value) => value.lot_id).sort()) !== canonical(operationIds)
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const parsedReviews = strictJson(row.review_bytes.toString('utf8'))
  if (
    !Array.isArray(parsedReviews) ||
    parsedReviews.length < 1 ||
    parsedReviews.length > 20 ||
    !parsedReviews.every(isReviewBinding) ||
    new Set(parsedReviews.map((value) => value.subjectId)).size !== parsedReviews.length
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const reviews = parsedReviews
  if (
    isEffectsPlan(plan) &&
    (plan.parts.some((part) => !reviews.some((review) => review.subjectId === part.subjectId)) ||
      plan.partAttachments.some(
        (transfer) => !reviews.some((review) => review.subjectId === transfer.partSubjectId),
      ))
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const indexedReviews = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        subject_id: manualPreparationReviews.subjectId,
        review_id: manualPreparationReviews.reviewId,
        actor_id: manualReviews.actorId,
        dependency_bytes: manualReviews.dependencyBytes,
        dependency_digest: manualReviews.dependencyDigest,
      })
      .from(manualPreparationReviews)
      .innerJoin(
        manualReviews,
        and(
          eq(manualReviews.batchId, manualPreparationReviews.batchId),
          eq(manualReviews.subjectId, manualPreparationReviews.subjectId),
          eq(manualReviews.id, manualPreparationReviews.reviewId),
        ),
      )
      .where(
        and(
          eq(manualPreparationReviews.batchId, row.batch_id),
          eq(manualPreparationReviews.preparationId, row.id),
        ),
      ),
  )
  if (indexedReviews.length !== reviews.length) {
    fail('retained_preparation_corrupt', 409)
  }
  // Lots whose reviewed facts inherit a new-location draft; explicit selections never do.
  const draftLocationLots = new Set<string>()
  for (const binding of reviews) {
    const indexed = indexedReviews.find(
      (value) => value.subject_id === binding.subjectId && value.review_id === binding.reviewId,
    )
    if (!indexed || indexed.actor_id !== config.actorId) {
      fail('retained_preparation_corrupt', 409)
    }
    verifyBytes(indexed.dependency_bytes, indexed.dependency_digest)
    if (indexed.dependency_digest.toString('hex') !== binding.digest) {
      fail('retained_preparation_corrupt', 409)
    }
    if (usesLocationDraft(indexed.dependency_bytes)) {
      draftLocationLots.add(binding.subjectId)
    }
  }
  const indexedLots = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        batch_id: manualPreparationLots.batchId,
        preparation_id: manualPreparationLots.preparationId,
        lot_id: manualPreparationLots.lotId,
        review_id: manualPreparationLots.reviewId,
        source_id: manualPreparationLots.sourceId,
        contribution_key: manualPreparationLots.contributionKey,
      })
      .from(manualPreparationLots)
      .where(
        and(
          eq(manualPreparationLots.batchId, row.batch_id),
          eq(manualPreparationLots.preparationId, row.id),
        ),
      ),
  )
  if (
    indexedLots.length !== plan.operations.length ||
    indexedLots.some(
      (value) =>
        value.source_id !== plan.sourceId ||
        !plan.operations.some(
          (operation) =>
            operation.operationKey === value.lot_id &&
            operation.contributionKey === value.contribution_key,
        ) ||
        !reviews.some(
          (binding) => binding.subjectId === value.lot_id && binding.reviewId === value.review_id,
        ),
    )
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  await requirePreparationMedia(
    client,
    row.batch_id,
    row.id,
    plan,
    reviews.map((review) => review.subjectId),
  )
  const commandResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select(prepareCommandColumns)
      .from(manualPrepareCommands)
      .where(
        and(
          eq(manualPrepareCommands.id, row.prepare_command_id),
          eq(manualPrepareCommands.batchId, row.batch_id),
          eq(manualPrepareCommands.actorId, config.actorId),
        ),
      ),
  )
  const command = commandResult[0]
  if (
    !command ||
    command.deployment_id !== plan.deploymentId ||
    command.target_id !== plan.targetId ||
    command.context_id !== plan.contextId ||
    !command.dependency_bytes.equals(row.dependency_bytes) ||
    !command.review_bytes.equals(row.review_bytes)
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  verifyBytes(command.dependency_bytes, command.dependency_digest)
  verifyBytes(command.review_bytes, command.review_digest)
  const expectedReads = new Map<
    string,
    {
      model: string
      pk: string
      outcome: string
      label: string
      mapping?: InventoryMappingDto
      partIdentity?: { category_id: string; tags?: string[] }
    }
  >()
  for (const effect of checked.effects) {
    if (effect.part_id !== null) {
      expectedReads.set(`part:${effect.part_id}`, {
        model: 'part',
        pk: effect.part_id,
        outcome: 'found',
        label: effect.part_label,
      })
    }
    // A reused new-location output is read before the stock create, not at preparation.
    const reusedRecord =
      isEffectsPlan(plan) &&
      draftLocationLots.has(effect.lot_id) &&
      plan.locations?.some((location) => location.prior?.pk === effect.location_id)
    if (effect.location_id && !reusedRecord) {
      expectedReads.set(`location:${effect.location_id}`, {
        model: 'location',
        pk: effect.location_id,
        outcome: 'found',
        label: effect.location_label,
      })
    }
  }
  if (isEffectsPlan(plan)) {
    const capture = await captureInTransaction(client, config, row.batch_id)
    for (const location of plan.locations ?? []) {
      const parent = location.spec.parent
      if (parent) {
        const observation = capture.snapshot.observations.find(
          (item) => item.model === 'location' && item.pk === parent,
        )
        expectedReads.set(`location:${parent}`, {
          model: 'location',
          pk: parent,
          outcome: 'found',
          label: observation?.label ?? location.spec.name,
        })
      }
    }
    for (const part of plan.parts) {
      for (const reference of partSpecReferences(part.spec)) {
        const observation = capture.snapshot.observations.find(
          (item) =>
            item.id === reference.observation_id &&
            item.pk === reference.pk &&
            item.model === reference.model &&
            item.target_context_id === plan.contextId,
        )
        if (!observation?.mapping) {
          fail('retained_preparation_corrupt', 409)
        }
        expectedReads.set(`${reference.model}:${reference.pk}`, {
          model: reference.model,
          pk: reference.pk,
          outcome: 'found',
          label: observation.label,
          mapping: observation.mapping,
        })
      }
      if (part.prior) {
        expectedReads.set(`part:${part.prior.pk}`, {
          model: 'part',
          pk: part.prior.pk,
          outcome: 'found',
          label: part.spec.name,
          partIdentity: { category_id: part.spec.category.pk, tags: part.spec.tags },
        })
      }
    }
  }
  const reads = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        model: manualReadIntents.model,
        pk: manualReadIntents.pk,
        outcome: manualReadResults.outcome,
        receipt_bytes: manualReadResults.receiptBytes,
        receipt_digest: manualReadResults.receiptDigest,
      })
      .from(manualReadIntents)
      .leftJoin(manualReadResults, eq(manualReadResults.intentId, manualReadIntents.id))
      .where(
        and(
          eq(manualReadIntents.batchId, row.batch_id),
          eq(manualReadIntents.prepareCommandId, row.prepare_command_id),
        ),
      ),
  )
  if (reads.length !== expectedReads.size) {
    fail('retained_preparation_corrupt', 409)
  }
  for (const receipt of reads) {
    const expected = expectedReads.get(`${receipt.model}:${receipt.pk}`)
    if (
      !expected ||
      receipt.outcome !== 'found' ||
      !receipt.receipt_bytes ||
      !receipt.receipt_digest
    ) {
      fail('retained_preparation_corrupt', 409)
    }
    verifyBytes(receipt.receipt_bytes, receipt.receipt_digest)
    let expectedReceipt: unknown = expected
    if (expected.partIdentity) {
      const value: unknown = strictJson(receipt.receipt_bytes.toString('utf8'))
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('partIdentity' in value) ||
        !partIdentitySatisfies(value.partIdentity, expected.partIdentity)
      ) {
        fail('retained_preparation_corrupt', 409)
      }
      expectedReceipt = { ...expected, partIdentity: value.partIdentity }
    }
    if (receipt.receipt_bytes.toString('utf8') !== canonical(expectedReceipt)) {
      fail('retained_preparation_corrupt', 409)
    }
  }
  if (isEffectsPlan(plan)) {
    await requirePartTransferReads(client, row.batch_id, row.prepare_command_id, plan)
  }
  return { row, plan, preview: checked }
}

export async function runIdentity(client: PoolClient, config: ManualConfig, runId: string) {
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        ...runColumns,
        preparation_id: manualApprovals.preparationId,
        actor_id: manualApprovals.actorId,
        round_number: sql<string>`${manualApprovals.roundNumber}::text`,
      })
      .from(manualRuns)
      .innerJoin(
        manualApprovals,
        and(
          eq(manualApprovals.id, manualRuns.approvalId),
          eq(manualApprovals.batchId, manualRuns.batchId),
        ),
      )
      .where(and(eq(manualRuns.id, runId), eq(manualApprovals.actorId, config.actorId))),
  )
  const row = result[0]
  if (!row) {
    fail('not_found', 404)
  }
  const preparation = await retainedPreparation(client, config, row.preparation_id)
  return { row, preparation }
}

export async function manualRunSnapshot(
  client: PoolClient,
  config: ManualConfig,
  runId: string,
): Promise<ManualRunDto> {
  const { row, preparation } = await runIdentity(client, config, runId)
  const journal = await snapshot(client, runId)
  const dispatchResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ state: manualDispatches.state })
      .from(manualDispatches)
      .where(eq(manualDispatches.runId, runId))
      .orderBy(desc(manualDispatches.sequence))
      .limit(1),
  )
  const dispatchState = dispatchResult[0]?.state ?? 'not_requested'
  let state: ManualRunDto['state'] = journal.state
  if (journal.state !== 'recovery_required' && journal.state !== 'settled_complete') {
    if (dispatchState === 'running') {
      state = journal.cancellationRequested ? 'stopping' : 'running'
    } else if (dispatchState === 'queued') {
      state = 'queued'
    } else if (dispatchState === 'interrupted') {
      state = 'recovery_required'
    }
  }
  const operations = journal.operations.map((operation) => {
    const effect = preparation.preview.effects.find(
      (value) => value.lot_id === operation.operationKey,
    )
    if (!effect) {
      fail('retained_preparation_corrupt', 409)
    }
    return {
      operation_key: operation.operationKey,
      lot_id: effect.lot_id,
      lot_label: effect.lot_label,
      quantity: effect.quantity,
      certainty: operation.certainty,
      remote_pk: operation.remotePk,
      recovery_allowed:
        !isEffectsPlan(preparation.plan) &&
        state === 'settled_incomplete' &&
        operation.certainty === 'none',
    }
  })
  const attachments = journal.attachments.map((attachment) => {
    const effect = preparation.preview.effects.find(
      (value) => value.lot_id === attachment.stockOperationKey,
    )
    if (!effect) {
      fail('retained_preparation_corrupt', 409)
    }
    const stock = journal.operations.find(
      (value) => value.operationKey === attachment.stockOperationKey,
    )
    const inactive = dispatchState !== 'running' && dispatchState !== 'queued'
    let recoveryAction: 'repair_attachment' | 'verify_attachment' | null = null
    if (inactive && stock?.certainty === 'confirmed') {
      if (attachment.certainty !== 'none') {
        recoveryAction = 'verify_attachment'
      } else if (journal.state !== 'recovery_required') {
        recoveryAction = 'repair_attachment'
      }
    }
    return {
      artifact_key: attachment.artifactKey,
      lot_id: effect.lot_id,
      lot_label: effect.lot_label,
      version_id: attachment.versionId,
      blob_sha256: attachment.blobDigest,
      byte_size: attachment.byteSize,
      kind: attachment.kind,
      certainty: attachment.certainty,
      remote_pk: attachment.remotePk,
      verification: attachment.verification,
      recovery_action: recoveryAction,
    }
  })
  const certainties = new Set([...operations, ...attachments].map((value) => value.certainty))
  const effectCertainty = certainties.size > 1 ? 'mixed' : (operations[0]?.certainty ?? 'none')
  const streamResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ head: sql<string>`${streams.head}::text` })
      .from(streams)
      .where(eq(streams.id, row.stream_id)),
  )
  const supported = isEffectsPlan(preparation.plan)
    ? await supportedStates(client, runId, preparation.plan)
    : null
  const inactive = dispatchState !== 'running' && dispatchState !== 'queued'
  const partOutputs = isEffectsPlan(preparation.plan)
    ? preparation.plan.parts.map((part) => {
        const output = supported!.find(
          (item) => item.operationKey === logicalEffectKey(part.subjectId, 'create_part'),
        )
        return {
          label: part.spec.name,
          operation_key: logicalEffectKey(part.subjectId, 'create_part'),
          part_subject_id: part.subjectId,
          spec_sha256: part.specDigest,
          certainty: part.prior ? ('confirmed' as const) : output!.certainty,
          remote_pks: part.prior ? [part.prior.pk] : output!.remotePks,
          usable:
            part.prior !== null ||
            (output?.certainty === 'confirmed' &&
              output.verification !== 'missing_or_changed' &&
              output.verification !== 'unavailable'),
          verification: output?.verification ?? null,
        }
      })
    : null
  const supportedEffects = supported?.map((item) => {
    const effect = isEffectsPlan(preparation.plan)
      ? preparation.plan.effects.find((effect) => effect.operationKey === item.operationKey)
      : undefined
    const stock = preparation.preview.effects.find((stock) => stock.lot_id === item.operationKey)
    return {
      operation_key: item.operationKey,
      part_subject_id: effect?.partSubjectId ?? stock?.lot_id ?? item.operationKey,
      kind: item.kind as
        | 'create_part'
        | 'parameter'
        | 'manufacturer'
        | 'supplier'
        | 'part_attachment'
        | 'create_stock',
      label:
        preparation.preview.supported_effects?.find(
          (effect) => effect.operation_key === item.operationKey,
        )?.label ??
        stock?.lot_label ??
        item.kind,
      dependencies: effect?.dependencies ?? [],
      inputs: effect?.input ?? {},
      certainty: item.certainty,
      remote_pks: item.remotePks,
      verification: item.verification,
      ...(item.rejected ? { rejected: true as const } : {}),
      recovery_action: inactive
        ? item.certainty !== 'none' && item.remotePks.length === 1
          ? ('verify_effect' as const)
          : item.certainty === 'none' && journal.state !== 'recovery_required'
            ? ('resume_effect' as const)
            : null
        : null,
    }
  })
  const result: ManualRunDto = {
    run_id: runId,
    batch_id: row.batch_id,
    approval_id: row.approval_id,
    preparation_id: row.preparation_id,
    round_number: row.round_number,
    revision: row.revision,
    state,
    effect_certainty: effectCertainty,
    confirmed_stock_ids: journal.confirmedStockIds,
    attributed_stock_ids: journal.attributedStockIds,
    cancellation_requested: journal.cancellationRequested,
    dispatch_state: dispatchState,
    operations,
    ...(isEffectsPlan(preparation.plan)
      ? { part_attachments: preparation.preview.part_attachments }
      : {}),
    ...(partOutputs && supportedEffects
      ? { part_outputs: partOutputs, supported_effects: supportedEffects }
      : {}),
    ...(preparation.plan.version !== 'bench-stock-plan/1' ? { attachments } : {}),
    cursor: { stream_id: row.stream_id, sequence: streamResult[0].head },
  }
  validate('ManualRun', result)
  return result
}
