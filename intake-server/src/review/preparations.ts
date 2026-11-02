import {partIdentitySatisfies} from '../inventory/part-identity.ts'
import { supportedEffectsPreview,partAttachmentsPreview } from './effects-preview.ts'
import { selectedPartTransfers,observePartTransfers,type ManualAttachmentRead } from './part-attachments.ts'
import type { PartTransfer } from '../execution/part-attachment-plan.ts'
import { knownPartBindings, supportedPlan } from './effects-plan.ts'
import { partSpecReferences } from '../capture/part-spec.ts'
import type { InventoryModelDto, InventoryMappingDto } from '@invimport/contracts'
import type { PartBinding } from '../execution/effects-plan.ts'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
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
import { encodeExecutablePlan } from '../execution/media-plan.ts'
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
  if (material.parts.length && binding?.capability !== 'owned-fake-effects/1') {
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
    binding?.capability !== 'owned-fake-effects/1'
  ) {
    issues.push(
      issue(
        'unsupported_media_capability',
        'This retained media scope needs the separately qualified owned fake media capability.',
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
          await client.query(
            'INSERT INTO manual_review(id,batch_id,subject_id,actor_id,dependency_bytes,dependency_digest) VALUES($1,$2,$3,$4,$5,$6)',
            [
              randomUUID(),
              batchId,
              subject.subjectId,
              config.actorId,
              subject.bytes,
              subject.digest,
            ],
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
  partTransfers:PartTransfer[]
}

async function boundedRead(
  read: CaptureRead,
  model: InventoryModelDto,
  pk: string,
  deadline: number,
  includeTags=false,
) {
  const remaining = Math.min(10000, deadline - Date.now())
  if (remaining <= 0) {
    throw new Error('preparation_read_budget_exceeded')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read({ model, pk,...(includeTags?{includeTags:true as const}:{}) }),
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
  deadline:number,
) {
  const requests = new Map<
    string,
    {
      model: InventoryModelDto
      pk: string
      label: string
      mapping?: InventoryMappingDto
      partIdentity?: { category_id: string;tags?:string[] }
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
        partIdentity: { category_id: part.spec.category.pk,tags:part.spec.tags },
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
          await client.query(
            'INSERT INTO manual_read_intent(id,batch_id,prepare_command_id,model,pk) VALUES($1,$2,$3,$4,$5)',
            [intentId, context.capture.snapshot.id, context.commandId, request.model, request.pk],
          )
        })
        let outcome: 'found' | 'unavailable' = 'unavailable'
        let label: string | null = null
        let mapping: InventoryMappingDto | undefined
        let partIdentity: { category_id: string;tags?:string[] } | undefined
        try {
          if (!read) {
            throw new Error('inventory_read_unavailable')
          }
          const observed = await boundedRead(read, request.model, request.pk, deadline,request.partIdentity?.tags!==undefined)
          label = observed.label
          mapping = observed.mapping
          if (request.partIdentity) {
            partIdentity = observed.partIdentity
          }
          outcome = 'found'
          if (
            label !== request.label ||
            canonical(observed.mapping ?? null) !== canonical(request.mapping ?? null) ||
            (request.partIdentity&&!partIdentitySatisfies(observed.partIdentity,request.partIdentity))
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
          await client.query(
            'INSERT INTO manual_read_result(intent_id,outcome,receipt_bytes,receipt_digest) VALUES($1,$2,$3,$4)',
            [intentId, outcome, receipt, sha256(receipt)],
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
  attachmentRead?:ManualAttachmentRead,
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
        const parts =
          binding.capability === 'owned-fake-effects/1'
            ? await knownPartBindings(client, selected.capture.source, selected.material)
            : []
        const partTransfers=binding.capability==='owned-fake-effects/1'?await selectedPartTransfers(client,selected.capture.source,selected.material,parts):[]
        await client.query(
          `INSERT INTO manual_prepare_command(id,batch_id,actor_id,deployment_id,target_id,context_id,dependency_bytes,dependency_digest,review_bytes,review_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            commandId,
            batchId,
            config.actorId,
            binding.deploymentId,
            binding.targetId,
            binding.contextId,
            selected.material.bytes,
            selected.material.digest,
            reviewBytes,
            sha256(reviewBytes),
          ],
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
  const previous = await pool.query(
    'SELECT response_bytes,response_digest FROM manual_prepare_outcome WHERE command_id=$1',
    [started.command_id],
  )
  if (previous.rows[0]) {
    verifyBytes(previous.rows[0].response_bytes, previous.rows[0].response_digest)
    const retained: unknown = strictJson(previous.rows[0].response_bytes.toString('utf8'))
    validate('ManualPreparationResult', retained)
    return retained as ManualPreparationResultDto
  }
  if (!context) {
    fail('preparation_in_progress', 409)
  }
  const retained = context
  const deadline=Date.now()+30000
  const readIssues = await observePreparation(pool, read, retained,deadline)
  readIssues.push(...await observePartTransfers(pool,attachmentRead,{batchId,commandId:retained.commandId,targetId:config.targetId,contextId:config.targetContextId,originalSourceKey:retained.capture.originalSourceKey,transfers:retained.partTransfers},deadline))
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
    let response: ManualPreparationResultDto
    if (issues.length) {
      response = { status: 'blocked', issues }
    } else {
      requireReviews(material, reviews)
      const plan =
        binding?.capability === 'owned-fake-effects/1'
          ? supportedPlan(
              binding,
              capture.sourceId,
              capture.originalSourceKey,
              material,
              retained.parts,
              retained.partTransfers,
            )
          : preparedPlan(binding!, capture.sourceId, capture.originalSourceKey, material)
      const encoded = encodeExecutablePlan(plan)
      const preparationId = randomUUID()
      const evidenceLabels = new Map<string, string>()
      if (plan.version !== 'bench-stock-plan/1' && plan.attachments.length) {
        const labels = await client.query<{ id: string; label: string }>(
          'SELECT id,label FROM media_evidence WHERE batch_id=$1 AND id=ANY($2::uuid[])',
          [batchId, plan.attachments.map((attachment) => attachment.evidenceId)],
        )
        for (const evidence of labels.rows) {
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
        effects:
          plan.version === 'bench-effects-plan/1'
            ? material.effects.map((effect) => {
                const operation = plan.operations.find(
                  (operation) => operation.operationKey === effect.lot_id,
                )!
                if (operation.part !== null && effect.part_id === null) {
                  const { part_operation_key, ...fields } = effect
                  return { ...fields, part_id: operation.part }
                }
                return effect
              })
            : material.effects,
        ...(plan.version === 'bench-effects-plan/1'?{supported_effects:supportedEffectsPreview(plan),part_attachments:partAttachmentsPreview(plan,material.effects)}:{}),
        ...mediaPreview(plan, capture.snapshot, evidenceLabels),
      }
      validate('ManualPreview', preview)
      await client.query(
        `INSERT INTO manual_preparation(id,batch_id,prepare_command_id,actor_id,target_revision,plan_bytes,plan_digest,review_bytes,review_digest,dependency_bytes,dependency_digest,preview_bytes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          preparationId,
          batchId,
          retained.commandId,
          config.actorId,
          binding!.targetRevision,
          encoded.bytes,
          encoded.digest,
          retained.reviewBytes,
          sha256(retained.reviewBytes),
          material.bytes,
          material.digest,
          Buffer.from(canonical(preview)),
        ],
      )
      if (plan.version !== 'bench-stock-plan/1') {
        await retainPreparationMedia(client, batchId, preparationId, config.actorId, material)
      }
      for (const review of reviews) {
        await client.query('INSERT INTO manual_preparation_review VALUES($1,$2,$3,$4)', [
          batchId,
          preparationId,
          review.subjectId,
          review.reviewId,
        ])
      }
      for (const effect of material.effects) {
        const review = reviews.find((value) => value.subjectId === effect.lot_id)!
        await client.query('INSERT INTO manual_preparation_lot VALUES($1,$2,$3,$4,$5,$6)', [
          batchId,
          preparationId,
          effect.lot_id,
          review.reviewId,
          capture.sourceId,
          effect.contribution_key,
        ])
      }
      response = { status: 'prepared', preparation: preview }
    }
    const bytes = Buffer.from(canonical(response))
    await client.query('INSERT INTO manual_prepare_outcome VALUES($1,$2,$3)', [
      retained.commandId,
      bytes,
      sha256(bytes),
    ])
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
        const previous = await client.query(
          'SELECT id FROM manual_approval WHERE preparation_id=$1 AND actor_id=$2',
          [preview.id, config.actorId],
        )
        if (previous.rows[0]) {
          const runResult = await client.query('SELECT id FROM manual_run WHERE approval_id=$1', [
            previous.rows[0].id,
          ])
          if (!runResult.rows[0]) {
            fail('run_authority_missing', 409)
          }
          const original = await loadRun(client, runResult.rows[0].id)
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
          binding.capability === 'owned-fake-effects/1'
            ? supportedPlan(
                binding,
                capture.sourceId,
                capture.originalSourceKey,
                material,
                await knownPartBindings(client, capture.source, material),
                await selectedPartTransfers(client,capture.source,material,await knownPartBindings(client,capture.source,material)),
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
        const roundResult = await client.query(
          'SELECT (count(*)+1)::text AS next FROM manual_approval WHERE batch_id=$1',
          [preview.batch_id],
        )
        await client.query(
          'INSERT INTO manual_approval(id,batch_id,preparation_id,actor_id,round_number) VALUES($1,$2,$3,$4,$5)',
          [
            approved.approvalId,
            preview.batch_id,
            preview.id,
            config.actorId,
            roundResult.rows[0].next,
          ],
        )
        await client.query(
          'INSERT INTO manual_run(id,batch_id,approval_id,actor_id,stream_id) VALUES($1,$2,$3,$4,$5)',
          [approved.runId, preview.batch_id, approved.approvalId, config.actorId, capture.streamId],
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
