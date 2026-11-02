import type { CaptureObservationDto, InventoryModelDto } from '@invimport/contracts'
import { decodeInventoryObservation, readKind } from '../capture/read.ts'
import { partSpecReferences, validatePartSpec } from '../capture/part-spec.ts'
import { approvedTagsPresent } from '../inventory/tags.ts'
import type { ReadOperation } from '../inventory/transport.ts'
import { logicalEffectKey, type EffectsPlan } from './effects-plan.ts'
import type { SupportedCreateBody } from './effects-body.ts'
import type { SupportedJournalContext, SupportedRecovery } from './effects-journal.ts'
import { performSupportedRequest } from './effects-request.ts'
import type { EffectStep } from './effects-step.ts'
import { effectStepKind } from './effects-step.ts'
import { verifyPartAttachment } from './part-attachment-apply.ts'
import { responseObject, responsePk } from './response.ts'
import type { ApplyDependencies } from './apply.ts'
import type { inventoryTransport } from '../inventory/transport.ts'

type Transport = ReturnType<typeof inventoryTransport>

export async function cataloguePreconditionsComplete(
  deps: ApplyDependencies,
  context: SupportedJournalContext,
  transport: Transport,
  step: EffectStep,
  body: SupportedCreateBody,
  recovery: SupportedRecovery | undefined,
): Promise<boolean> {
  const kind = effectStepKind(step)
  const reads = catalogueReads(context.plan, step, body, kind)
  const mappings: CaptureObservationDto[] = []
  for (const read of reads) {
    const result = await performSupportedRequest(
      deps,
      context,
      step,
      'read',
      read,
      () => transport.read(context.plan, read),
      recovery,
    )
    try {
      if (
        !result ||
        result.status !== 200 ||
        responsePk(responseObject(result.bytes).pk) !== read.pk
      ) {
        return false
      }
      if (!mappingAllowsCreate(kind, read, result.bytes, context.plan, step, mappings)) {
        return false
      }
    } catch {
      return false
    }
  }
  if (kind === 'create_part') {
    const part = context.plan.parts.find(
      (part) => part.subjectId === ('partSubjectId' in step ? step.partSubjectId : null),
    )!
    try {
      validatePartSpec(part.spec, context.plan.contextId, mappings)
    } catch {
      return false
    }
  }
  if (kind === 'create_stock') {
    return knownPartAttachmentsMatch(deps, context, transport, step, body, recovery)
  }
  return true
}

function catalogueReads(
  plan: EffectsPlan,
  step: EffectStep,
  body: SupportedCreateBody,
  kind: ReturnType<typeof effectStepKind>,
): ReadOperation[] {
  const reads: ReadOperation[] = []
  if (kind === 'create_part') {
    const part = plan.parts.find(
      (part) => part.subjectId === ('partSubjectId' in step ? step.partSubjectId : null),
    )!
    for (const reference of partSpecReferences(part.spec)) {
      const read = { kind: readKind(reference.model), pk: reference.pk }
      if (!reads.some((existing) => existing.kind === read.kind && existing.pk === read.pk)) {
        reads.push(read)
      }
    }
    return reads
  }
  if (kind === 'create_stock') {
    reads.push({ kind: 'get_tagged_part', pk: body.part as string })
    if (body.location !== null) {
      reads.push({ kind: 'get_location', pk: body.location as string })
    }
    return reads
  }
  if (kind === 'parameter') {
    reads.push({ kind: 'get_parameter_template', pk: body.template as string })
    return reads
  }
  reads.push({ kind: 'get_company', pk: (body.manufacturer ?? body.supplier) as string })
  return reads
}

function mappingAllowsCreate(
  kind: ReturnType<typeof effectStepKind>,
  read: ReadOperation,
  bytes: Buffer,
  plan: EffectsPlan,
  step: EffectStep,
  mappings: CaptureObservationDto[],
) {
  const model = read.kind.slice(4) as InventoryModelDto
  if (kind === 'parameter') {
    const observed = decodeInventoryObservation({ model: 'parameter_template', pk: read.pk }, bytes)
    return (
      observed.mapping?.kind === 'parameter_template' &&
      observed.mapping.enabled &&
      (observed.mapping.model_type === null || observed.mapping.model_type === 'part.part')
    )
  }
  if (kind === 'manufacturer' || kind === 'supplier') {
    const observed = decodeInventoryObservation({ model: 'company', pk: read.pk }, bytes)
    return (
      observed.mapping?.kind === 'company' &&
      (kind !== 'manufacturer' || observed.mapping.manufacturer) &&
      (kind !== 'supplier' || observed.mapping.supplier)
    )
  }
  if (kind === 'create_stock' && read.kind === 'get_tagged_part') {
    const binding = plan.parts.find(
      (part) =>
        part.prior?.pk === read.pk ||
        logicalEffectKey(part.subjectId, 'create_part') ===
          ('partOperationKey' in step ? step.partOperationKey : null),
    )
    if (!binding) {
      return true
    }
    const identity = decodeInventoryObservation(
      { model: 'part', pk: read.pk, includeTags: true },
      bytes,
    )
    return (
      identity.label === binding.spec.name &&
      identity.partIdentity?.category_id === binding.spec.category.pk &&
      approvedTagsPresent(binding.spec.tags, identity.partIdentity?.tags)
    )
  }
  if (kind === 'create_part') {
    const part = plan.parts.find(
      (part) => part.subjectId === ('partSubjectId' in step ? step.partSubjectId : null),
    )!
    const references = partSpecReferences(part.spec).filter(
      (reference) => reference.pk === read.pk && reference.model === model,
    )
    const observed = decodeInventoryObservation({ model, pk: read.pk }, bytes)
    for (const reference of references) {
      mappings.push({
        id: reference.observation_id,
        model,
        pk: read.pk,
        target_context_id: plan.contextId,
        observed_at: 'retained-request',
        ...observed,
      })
    }
  }
  return true
}

async function knownPartAttachmentsMatch(
  deps: ApplyDependencies,
  context: SupportedJournalContext,
  transport: Transport,
  step: EffectStep,
  body: SupportedCreateBody,
  recovery: SupportedRecovery | undefined,
) {
  for (const transfer of context.plan.partAttachments.filter(
    (transfer) => transfer.prior !== null && transfer.part === body.part,
  )) {
    const prior = transfer.prior!
    const verified = await verifyPartAttachment({
      transfer,
      partPk: body.part as string,
      remotePk: prior.pk,
      artifactKey: prior.artifactKey,
      request: (_requestKind, spec, send, max) =>
        performSupportedRequest(
          deps,
          context,
          step,
          'read',
          {
            ...(spec as Record<string, unknown>),
            originalRunId: prior.runId,
            originalIntentId: prior.intentId,
          },
          send,
          recovery,
          max,
        ),
      metadata: (pk) => transport.readPartAttachmentMetadata(context.plan, pk),
      file: (input) => transport.readPartAttachmentFile(context.plan, input),
    })
    if (verified?.outcome !== 'matches') {
      return false
    }
  }
  return true
}
