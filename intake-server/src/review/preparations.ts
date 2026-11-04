import { effectsCapable, RECORD_EFFECTS_CAPABILITY } from '../execution/effects-plan.ts'
import { isEffectsPlan } from '../execution/effects-plan.ts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { mediaEvidence } from '../media/schema.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import {
  manualReviews,
  manualPrepareCommands,
  manualReadIntents,
  manualReadResults,
  manualPreparations,
  manualPreparationReviews,
  manualPreparationLots,
  manualPrepareOutcomes,
  manualApprovals,
  manualRuns,
} from './schema.ts'

import { partIdentitySatisfies } from '../inventory/part-identity.ts'
import { supportedEffectsPreview, partAttachmentsPreview } from './effects-preview.ts'
import {
  selectedPartTransfers,
  observePartTransfers,
  type ManualAttachmentRead,
} from './part-attachments.ts'
import type { PartTransfer } from '../execution/part-attachment-plan.ts'
import { knownPartBindings, knownRecordBindings, supportedPlan } from './effects-plan.ts'
import { partSpecReferences } from '../capture/part-spec.ts'
import type { InventoryModelDto, InventoryMappingDto } from '@invimport/contracts'
import {
  MAX_PLAN_BYTES,
  MAX_PLAN_EFFECTS,
  MAX_PLAN_OPERATIONS,
  MAX_PLAN_PARTS,
  type PartBinding,
} from '../execution/effects-plan.ts'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ManualEffectDto,
  type ManualScopeDto,
  type ManualIssueDto,
  type ManualPreviewDto,
  type ManualPreparationResultDto,
} from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { transaction } from '../db/database.ts'
import { idempotent, appendEvent, sha256, verifyBytes } from '../db/authority.ts'
import { fail } from '../capture/repository.ts'
import type { CaptureRead } from '../capture/routes.ts'
import { loadRun, reserveApprovedStock } from '../execution/authority.ts'
import { encodeExecutablePlan, type ExecutablePlan } from '../execution/media-plan.ts'
import { mediaPreview } from './media-preview.ts'
import { retainPreparationMedia } from './media-preparation.ts'
import { preparedPlan } from './media-plan.ts'
import { issue, unresolvedWarnings, type ManualMaterial } from './model.ts'
import {
  lockedCapture,
  deploymentBinding,
  historyIssues,
  currentReviews,
  requireReviews,
  type ManualConfig,
  isEffectsBinding,
  type DeploymentBinding,
  type ReviewBinding,
} from './authority.ts'
import { materializeWithMedia } from './media-material.ts'
import { retainedPreparation } from './runs.ts'

function scope(config: ManualConfig, action: string, batchId: string, key: string) {
  return {
    actorId: config.actorId,
    action,
    resourceKey: `${config.targetId}:${config.targetContextId}:${batchId}`,
    key,
  }
}

function normalized(input: ManualScopeDto) {
  return { ...input, selected_lot_ids: [...input.selected_lot_ids].sort() }
}

/** Report an oversized selection as a typed issue before the plan decoder refuses it. */
export function planCapacityIssue(plan: ExecutablePlan) {
  const effectsExceeded =
    isEffectsPlan(plan) &&
    (plan.parts.length > MAX_PLAN_PARTS ||
      plan.effects.length > MAX_PLAN_EFFECTS ||
      plan.operations.length > MAX_PLAN_OPERATIONS)
  if (effectsExceeded || Buffer.byteLength(canonical(plan)) > MAX_PLAN_BYTES) {
    return issue(
      'effects_capacity',
      `Choose fewer lots, Parts or parameters: one preparation supports at most ${MAX_PLAN_OPERATIONS} lots, ${MAX_PLAN_PARTS} Parts created by this intake, ${MAX_PLAN_EFFECTS} inventory effects and 256 KiB of approved plan.`,
    )
  }
  return null
}

/** A warning blocks review and preparation until fixed or dismissed with a reason. */
export function warningIssues(material: ManualMaterial) {
  return unresolvedWarnings(material).map((warning) =>
    issue('warning_unresolved', warning.message, warning.lotId),
  )
}

async function checkedSelection(
  client: PoolClient,
  config: ManualConfig,
  batchId: string,
  input: ManualScopeDto,
) {
  const capture = await lockedCapture(client, config, batchId)
  if (capture.snapshot.revision !== input.expected_batch_revision) {
    fail('revision_conflict', 412)
  }
  const material = await materializeWithMedia(
    client,
    config,
    capture.snapshot,
    input.selected_lot_ids,
  )
  const binding = await deploymentBinding(client, config)
  const issues = [...material.issues, ...warningIssues(material)]
  if (!binding) {
    issues.push(
      issue(
        'unsupported_capability',
        'Stock execution is available only for a separately configured owned fake target.',
      ),
    )
  }
  if (
    (material.locations?.length || material.companies?.length) &&
    binding?.capability !== RECORD_EFFECTS_CAPABILITY
  ) {
    issues.push(
      issue(
        'record_creation_unavailable',
        'Creating a new location or supplier is not available for this target. Choose an existing record, or keep the draft for later.',
      ),
    )
  }
  if (material.parts.length && !effectsCapable(binding?.capability)) {
    issues.push(
      issue(
        'unsupported_part_creation',
        'This deployment does not support explicit Part creation.',
      ),
    )
  }
  if (
    material.mediaInputs?.size &&
    binding?.capability !== 'owned-fake-media/1' &&
    !effectsCapable(binding?.capability)
  ) {
    issues.push(
      issue(
        'unsupported_media_capability',
        'This retained media scope needs the separately qualified owned fake media capability.',
      ),
    )
  }
  const partAttachmentSelected = [...(material.mediaInputs?.values() ?? [])].some((inputs) =>
    inputs.attachments.some((selection) => selection.destination === 'part_attachment'),
  )
  if (partAttachmentSelected && !effectsCapable(binding?.capability)) {
    issues.push(
      issue(
        'unsupported_part_attachment',
        'This deployment does not support Part attachments. Decline the Part attachment or use the owned fake effects capability.',
      ),
    )
  }
  issues.push(...(await historyIssues(client, capture.source, material, capture.guard.activeRunId)))
  return { capture, material, binding, issues }
}

export async function markReviewed(
  pool: Pool,
  config: ManualConfig,
  batchId: string,
  key: string,
  input: ManualScopeDto,
) {
  return transaction(pool, (client) =>
    idempotent(
      client,
      scope(config, 'manual_review', batchId, key),
      normalized(input),
      async () => {
        const selected = await checkedSelection(client, config, batchId, input)
        if (selected.issues.length) {
          fail(selected.issues[0].code, 409)
        }
        for (const subject of selected.material.subjects) {
          await executeDatabaseQuery(
            queryDatabase(client).insert(manualReviews).values({
              id: randomUUID(),
              batchId,
              subjectId: subject.subjectId,
              actorId: config.actorId,
              dependencyBytes: subject.bytes,
              dependencyDigest: subject.digest,
            }),
          )
        }
        const sequence = await appendEvent(client, selected.capture.streamId, 'manual_reviewed', {
          batch_id: batchId,
          selected_lot_ids: selected.material.selected,
        })
        return {
          reviewed_subject_ids: selected.material.subjects.map((value) => value.subjectId),
          cursor: { stream_id: selected.capture.streamId, sequence },
        }
      },
    ),
  )
}

interface PreparationContext {
  commandId: string
  capture: Awaited<ReturnType<typeof lockedCapture>>
  material: ManualMaterial
  binding: DeploymentBinding
  reviews: ReviewBinding[]
  reviewBytes: Buffer
  parts: PartBinding[]
  partTransfers: PartTransfer[]
}

async function boundedRead(
  read: CaptureRead,
  model: InventoryModelDto,
  pk: string,
  deadline: number,
  includeTags = false,
) {
  const remaining = Math.min(10000, deadline - Date.now())
  if (remaining <= 0) {
    throw new Error('preparation_read_budget_exceeded')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read({ model, pk, ...(includeTags ? { includeTags: true as const } : {}) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('preparation_read_budget_exceeded')), remaining)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function observePreparation(
  pool: Pool,
  read: CaptureRead | undefined,
  context: PreparationContext,
  deadline: number,
) {
  const requests = new Map<
    string,
    {
      model: InventoryModelDto
      pk: string
      label: string
      mapping?: InventoryMappingDto
      partIdentity?: { category_id: string; tags?: string[] }
    }
  >()
  for (const effect of context.material.effects) {
    if (effect.part_id !== null) {
      requests.set(`part:${effect.part_id}`, {
        model: 'part',
        pk: effect.part_id,
        label: effect.part_label,
      })
    }
    if (effect.location_id) {
      requests.set(`location:${effect.location_id}`, {
        model: 'location',
        pk: effect.location_id,
        label: effect.location_label,
      })
    }
  }
  // A new location's parent must still exist on the bound target before approval.
  for (const location of context.material.locations ?? []) {
    const parent = location.spec.parent
    if (parent) {
      const observation = context.capture.snapshot.observations.find(
        (item) => item.model === 'location' && item.pk === parent,
      )
      requests.set(`location:${parent}`, {
        model: 'location',
        pk: parent,
        label: observation?.label ?? location.spec.name,
      })
    }
  }
  for (const part of context.parts) {
    for (const reference of partSpecReferences(part.spec)) {
      const observation = context.capture.snapshot.observations.find(
        (item) => item.id === reference.observation_id,
      )!
      requests.set(`${reference.model}:${reference.pk}`, {
        model: reference.model,
        pk: reference.pk,
        label: observation.label,
        mapping: observation.mapping,
      })
    }
    if (part.prior) {
      requests.set(`part:${part.prior.pk}`, {
        model: 'part',
        pk: part.prior.pk,
        label: part.spec.name,
        partIdentity: { category_id: part.spec.category.pk, tags: part.spec.tags },
      })
    }
  }
  const issues: ManualIssueDto[] = []
  const bounded = [...requests.values()]
  for (let offset = 0; offset < bounded.length; offset += 3) {
    await Promise.all(
      bounded.slice(offset, offset + 3).map(async (request) => {
        if (Date.now() >= deadline) {
          issues.push(
            issue(
              'inventory_read_unavailable',
              'Preparation exceeded its bounded target-read budget.',
            ),
          )
          return
        }
        const intentId = randomUUID()
        await transaction(pool, async (client) => {
          await executeDatabaseQuery(
            queryDatabase(client).insert(manualReadIntents).values({
              id: intentId,
              batchId: context.capture.snapshot.id,
              prepareCommandId: context.commandId,
              model: request.model,
              pk: request.pk,
            }),
          )
        })
        let outcome: 'found' | 'unavailable' = 'unavailable'
        let label: string | null = null
        let mapping: InventoryMappingDto | undefined
        let partIdentity: { category_id: string; tags?: string[] } | undefined
        try {
          if (!read) {
            throw new Error('inventory_read_unavailable')
          }
          const observed = await boundedRead(
            read,
            request.model,
            request.pk,
            deadline,
            request.partIdentity?.tags !== undefined,
          )
          label = observed.label
          mapping = observed.mapping
          if (request.partIdentity) {
            partIdentity = observed.partIdentity
          }
          outcome = 'found'
          if (
            label !== request.label ||
            canonical(observed.mapping ?? null) !== canonical(request.mapping ?? null) ||
            (request.partIdentity &&
              !partIdentitySatisfies(observed.partIdentity, request.partIdentity))
          ) {
            issues.push(
              issue(
                'target_choice_changed',
                'An existing-record identity changed. Read it again in Capture and review the choice.',
              ),
            )
          }
        } catch {
          issues.push(
            issue(
              'inventory_read_unavailable',
              'A complete target read could not be verified. No executable preparation was created.',
            ),
          )
        }
        const receipt = Buffer.from(
          canonical({
            model: request.model,
            pk: request.pk,
            outcome,
            label,
            ...(mapping ? { mapping } : {}),
            ...(partIdentity ? { partIdentity } : {}),
          }),
        )
        await transaction(pool, async (client) => {
          await executeDatabaseQuery(
            queryDatabase(client)
              .insert(manualReadResults)
              .values({ intentId, outcome, receiptBytes: receipt, receiptDigest: sha256(receipt) }),
          )
        })
      }),
    )
  }
  return issues
}

export async function prepareSelection(
  pool: Pool,
  config: ManualConfig,
  read: CaptureRead | undefined,
  batchId: string,
  key: string,
  input: ManualScopeDto,
  attachmentRead?: ManualAttachmentRead,
): Promise<ManualPreparationResultDto> {
  let context: PreparationContext | undefined
  const started = (await transaction(pool, (client) =>
    idempotent(
      client,
      scope(config, 'manual_prepare', batchId, key),
      normalized(input),
      async () => {
        const selected = await checkedSelection(client, config, batchId, input)
        if (selected.issues.length) {
          return { issues: selected.issues }
        }
        const reviews = await currentReviews(client, batchId, selected.material)
        if (reviews.length !== selected.material.subjects.length) {
          return {
            issues: [
              issue(
                'current_review_required',
                'Review every selected lot and its shared Part before preparing.',
              ),
            ],
          }
        }
        const commandId = randomUUID()
        const reviewBytes = Buffer.from(canonical(reviews))
        const binding = selected.binding!
        const parts = effectsCapable(binding.capability)
          ? await knownPartBindings(client, selected.capture.source, selected.material)
          : []
        const partTransfers = effectsCapable(binding.capability)
          ? await selectedPartTransfers(client, selected.capture.source, selected.material, parts)
          : []
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(manualPrepareCommands)
            .values({
              id: commandId,
              batchId,
              actorId: config.actorId,
              deploymentId: binding.deploymentId,
              targetId: binding.targetId,
              contextId: binding.contextId,
              dependencyBytes: selected.material.bytes,
              dependencyDigest: selected.material.digest,
              reviewBytes,
              reviewDigest: sha256(reviewBytes),
            }),
        )
        context = {
          commandId,
          capture: selected.capture,
          material: selected.material,
          binding,
          reviews,
          reviewBytes,
          parts,
          partTransfers,
        }
        await appendEvent(client, selected.capture.streamId, 'manual_preparation_started', {
          batch_id: batchId,
          command_id: commandId,
        })
        return { command_id: commandId }
      },
    ),
  )) as { command_id?: string; issues?: ManualIssueDto[] }
  if (started.issues) {
    return { status: 'blocked', issues: started.issues }
  }
  const previous = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        response_bytes: manualPrepareOutcomes.responseBytes,
        response_digest: manualPrepareOutcomes.responseDigest,
      })
      .from(manualPrepareOutcomes)
      .where(sql`${manualPrepareOutcomes.commandId} = ${started.command_id ?? null}`),
  )
  if (previous[0]) {
    verifyBytes(previous[0].response_bytes, previous[0].response_digest)
    const retained: unknown = strictJson(previous[0].response_bytes.toString('utf8'))
    validate('ManualPreparationResult', retained)
    return retained as ManualPreparationResultDto
  }
  if (!context) {
    fail('preparation_in_progress', 409)
  }
  const retained = context
  const deadline = Date.now() + 30000
  const readIssues = await observePreparation(pool, read, retained, deadline)
  readIssues.push(
    ...(await observePartTransfers(
      pool,
      attachmentRead,
      {
        batchId,
        commandId: retained.commandId,
        targetId: config.targetId,
        contextId: config.targetContextId,
        originalSourceKey: retained.capture.originalSourceKey,
        transfers: retained.partTransfers,
      },
      deadline,
    )),
  )
  return transaction(pool, async (client) => {
    const capture = await lockedCapture(client, config, batchId)
    const material = await materializeWithMedia(
      client,
      config,
      capture.snapshot,
      retained.material.selected,
    )
    const binding = await deploymentBinding(client, config)
    const reviews = await currentReviews(client, batchId, material)
    const issues = [...readIssues, ...material.issues, ...warningIssues(material)]
    issues.push(
      ...(await historyIssues(client, capture.source, material, capture.guard.activeRunId)),
    )
    const changed =
      !material.bytes.equals(retained.material.bytes) ||
      canonical(reviews) !== retained.reviewBytes.toString('utf8') ||
      canonical(binding) !== canonical(retained.binding)
    if (changed) {
      issues.push(
        issue(
          'stale_preparation',
          'Selected facts, reviews or target binding changed while preparation was reading. Review the current values.',
        ),
      )
    }
    let plan: ExecutablePlan | null = null
    if (!issues.length) {
      requireReviews(material, reviews)
      plan = isEffectsBinding(binding)
        ? supportedPlan(
            binding,
            capture.sourceId,
            capture.originalSourceKey,
            material,
            retained.parts,
            retained.partTransfers,
            await knownRecordBindings(client, capture.source, material),
          )
        : preparedPlan(binding!, capture.sourceId, capture.originalSourceKey, material)
      const capacity = planCapacityIssue(plan)
      if (capacity) {
        issues.push(capacity)
      }
    }
    let response: ManualPreparationResultDto
    if (issues.length || !plan) {
      response = { status: 'blocked', issues }
    } else {
      const encoded = encodeExecutablePlan(plan)
      const preparationId = randomUUID()
      const evidenceLabels = new Map<string, string>()
      if (plan.version !== 'bench-stock-plan/1' && plan.attachments.length) {
        const labels = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: mediaEvidence.id, label: mediaEvidence.label })
            .from(mediaEvidence)
            .where(
              and(
                eq(mediaEvidence.batchId, batchId),
                inArray(
                  mediaEvidence.id,
                  plan.attachments.map((attachment) => attachment.evidenceId),
                ),
              ),
            ),
        )
        for (const evidence of labels) {
          evidenceLabels.set(evidence.id, evidence.label)
        }
      }
      const preview: ManualPreviewDto = {
        id: preparationId,
        batch_id: batchId,
        selected_lot_ids: material.selected,
        remaining_lot_ids: capture.snapshot.lots
          .filter((value) => !material.selected.includes(value.id))
          .map((value) => value.id)
          .sort(),
        plan_sha256: encoded.digest.toString('hex'),
        review_fingerprint: sha256(retained.reviewBytes).toString('hex'),
        target_revision: binding!.targetRevision,
        capability: plan.capability,
        effects: isEffectsPlan(plan)
          ? material.effects.map((effect) => {
              const operation = plan.operations.find(
                (operation) => operation.operationKey === effect.lot_id,
              )!
              // A reused Part or new-location output is shown as the exact PK the plan binds.
              let shown: ManualEffectDto = effect
              if (operation.part !== null && shown.part_id === null) {
                const { part_operation_key: _key, ...fields } = shown
                shown = { ...fields, part_id: operation.part }
              }
              if (operation.location !== null && shown.location_operation_key) {
                const { location_operation_key: _location, ...fields } = shown
                shown = { ...fields, location_id: operation.location } as ManualEffectDto
              }
              return shown
            })
          : material.effects,
        ...(isEffectsPlan(plan)
          ? {
              supported_effects: supportedEffectsPreview(plan),
              part_attachments: partAttachmentsPreview(plan, material.effects),
            }
          : {}),
        ...mediaPreview(plan, capture.snapshot, evidenceLabels),
      }
      validate('ManualPreview', preview)
      await executeDatabaseQuery(
        queryDatabase(client)
          .insert(manualPreparations)
          .values({
            id: preparationId,
            batchId,
            prepareCommandId: retained.commandId,
            actorId: config.actorId,
            targetRevision: BigInt(binding!.targetRevision),
            planBytes: encoded.bytes,
            planDigest: encoded.digest,
            reviewBytes: retained.reviewBytes,
            reviewDigest: sha256(retained.reviewBytes),
            dependencyBytes: material.bytes,
            dependencyDigest: material.digest,
            previewBytes: Buffer.from(canonical(preview)),
          }),
      )
      if (plan.version !== 'bench-stock-plan/1') {
        await retainPreparationMedia(client, batchId, preparationId, config.actorId, material)
      }
      for (const review of reviews) {
        await executeDatabaseQuery(
          queryDatabase(client).insert(manualPreparationReviews).values({
            batchId,
            preparationId,
            subjectId: review.subjectId,
            reviewId: review.reviewId,
          }),
        )
      }
      for (const effect of material.effects) {
        const review = reviews.find((value) => value.subjectId === effect.lot_id)!
        await executeDatabaseQuery(
          queryDatabase(client).insert(manualPreparationLots).values({
            batchId,
            preparationId,
            lotId: effect.lot_id,
            reviewId: review.reviewId,
            sourceId: capture.sourceId,
            contributionKey: effect.contribution_key,
          }),
        )
      }
      response = { status: 'prepared', preparation: preview }
    }
    const bytes = Buffer.from(canonical(response))
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(manualPrepareOutcomes)
        .values({
          commandId: retained.commandId,
          responseBytes: bytes,
          responseDigest: sha256(bytes),
        }),
    )
    await appendEvent(
      client,
      capture.streamId,
      response.status === 'prepared' ? 'manual_prepared' : 'manual_preparation_blocked',
      { batch_id: batchId, command_id: retained.commandId },
    )
    return response
  })
}

export interface ApprovalInput {
  preparation_id: string
  expected_plan_sha256: string
  expected_review_fingerprint: string
  selected_lot_ids: string[]
  expected_target_revision: string
}

export async function approvePreparation(
  pool: Pool,
  config: ManualConfig,
  key: string,
  input: ApprovalInput,
) {
  const payload = { ...input, selected_lot_ids: [...input.selected_lot_ids].sort() }
  return transaction(pool, (client) =>
    idempotent(
      client,
      scope(config, 'manual_approve', input.preparation_id, key),
      payload,
      async () => {
        const preparation = await retainedPreparation(client, config, input.preparation_id)
        const preview = preparation.preview
        if (
          input.expected_plan_sha256 !== preview.plan_sha256 ||
          input.expected_review_fingerprint !== preview.review_fingerprint ||
          input.expected_target_revision !== preview.target_revision ||
          canonical(payload.selected_lot_ids) !== canonical(preview.selected_lot_ids)
        ) {
          fail('approval_binding_mismatch', 409)
        }
        const capture = await lockedCapture(client, config, preview.batch_id)
        const previous = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: manualApprovals.id })
            .from(manualApprovals)
            .where(
              and(
                eq(manualApprovals.preparationId, preview.id),
                eq(manualApprovals.actorId, config.actorId),
              ),
            ),
        )
        if (previous[0]) {
          const runResult = await executeDatabaseQuery(
            queryDatabase(client)
              .select({ id: manualRuns.id })
              .from(manualRuns)
              .where(eq(manualRuns.approvalId, previous[0].id)),
          )
          if (!runResult[0]) {
            fail('run_authority_missing', 409)
          }
          const original = await loadRun(client, runResult[0].id)
          await reserveApprovedStock(client, {
            approvalId: original.approvalId,
            preparationId: preview.id,
            runId: original.runId,
            commandId: original.commandId,
            actorId: config.actorId,
            bytes: preparation.row.plan_bytes,
            digest: preparation.row.plan_digest,
          })
          return {
            run_id: original.runId,
            approval_id: original.approvalId,
            preparation_id: preview.id,
          }
        }
        const material = await materializeWithMedia(
          client,
          config,
          capture.snapshot,
          preview.selected_lot_ids,
        )
        const binding = await deploymentBinding(client, config)
        const reviews = await currentReviews(client, preview.batch_id, material)
        const problems = [
          ...material.issues,
          ...warningIssues(material),
          ...(await historyIssues(client, capture.source, material, capture.guard.activeRunId)),
        ]
        if (problems.length) {
          fail(problems[0].code, 409)
        }
        if (
          !binding ||
          binding.targetRevision !== preview.target_revision ||
          !material.bytes.equals(preparation.row.dependency_bytes) ||
          canonical(reviews) !== preparation.row.review_bytes.toString('utf8')
        ) {
          fail('stale_preparation', 409)
        }
        requireReviews(material, reviews)
        const currentPlan = encodeExecutablePlan(
          isEffectsBinding(binding)
            ? supportedPlan(
                binding,
                capture.sourceId,
                capture.originalSourceKey,
                material,
                await knownPartBindings(client, capture.source, material),
                await selectedPartTransfers(
                  client,
                  capture.source,
                  material,
                  await knownPartBindings(client, capture.source, material),
                ),
                await knownRecordBindings(client, capture.source, material),
              )
            : preparedPlan(binding, capture.sourceId, capture.originalSourceKey, material),
        )
        if (!currentPlan.bytes.equals(preparation.row.plan_bytes)) {
          fail('stale_preparation', 409)
        }
        const approved = await reserveApprovedStock(client, {
          approvalId: randomUUID(),
          preparationId: preview.id,
          runId: randomUUID(),
          commandId: randomUUID(),
          actorId: config.actorId,
          bytes: preparation.row.plan_bytes,
          digest: preparation.row.plan_digest,
        })
        const roundResult = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ next: sql<string>`(count(*)+1)::text` })
            .from(manualApprovals)
            .where(eq(manualApprovals.batchId, preview.batch_id)),
        )
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(manualApprovals)
            .values({
              id: approved.approvalId,
              batchId: preview.batch_id,
              preparationId: preview.id,
              actorId: config.actorId,
              roundNumber: BigInt(roundResult[0].next),
            }),
        )
        await executeDatabaseQuery(
          queryDatabase(client).insert(manualRuns).values({
            id: approved.runId,
            batchId: preview.batch_id,
            approvalId: approved.approvalId,
            actorId: config.actorId,
            streamId: capture.streamId,
          }),
        )
        await appendEvent(client, capture.streamId, 'manual_approved', {
          batch_id: preview.batch_id,
          run_id: approved.runId,
          approval_id: approved.approvalId,
        })
        return {
          run_id: approved.runId,
          approval_id: approved.approvalId,
          preparation_id: preview.id,
        }
      },
    ),
  )
}
