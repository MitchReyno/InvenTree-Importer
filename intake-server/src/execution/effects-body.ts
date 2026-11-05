import type { Pool } from 'pg'
import { logicalEffectKey, type EffectsPlan, type EffectOperation } from './effects-plan.ts'
import { partTransferKey } from './part-attachment-plan.ts'
import { supportedStates } from './effects-state.ts'
import { requirePriorRecord } from './effects-index.ts'
import type { EffectStep } from './effects-step.ts'

export type SupportedCreateBody = Record<string, string | string[] | null | boolean>

export async function confirmedPartPk(
  pool: Pool,
  runId: string,
  plan: EffectsPlan,
  subjectId: string,
) {
  const binding = plan.parts.find((part) => part.subjectId === subjectId)
  if (!binding) {
    throw new Error('part_binding_missing')
  }
  if (binding.prior) {
    return binding.prior.pk
  }
  const states = await supportedStates(pool, runId, plan)
  const output = states.find(
    (state) => state.operationKey === logicalEffectKey(subjectId, 'create_part'),
  )
  return output?.certainty === 'confirmed' &&
    output.verification !== 'missing_or_changed' &&
    output.verification !== 'unavailable' &&
    output.remotePks.length === 1
    ? output.remotePks[0]
    : null
}

export async function supportedCreateBody(
  pool: Pool,
  runId: string,
  plan: EffectsPlan,
  step: EffectStep,
): Promise<SupportedCreateBody | null> {
  if (!('kind' in step)) {
    const location = await stockLocation(pool, runId, plan, step)
    if (location === undefined) {
      return null
    }
    return stockCreateBody(pool, runId, plan, step.part, step.partOperationKey, {
      ...step,
      location,
    })
  }
  if (step.kind === 'create_location') {
    const binding = plan.locations!.find((item) => item.draftId === step.partSubjectId)!
    return {
      name: binding.spec.name,
      description: binding.spec.description,
      parent: binding.spec.parent,
    }
  }
  if (step.kind === 'create_company') {
    const binding = plan.companies!.find((item) => item.draftId === step.partSubjectId)!
    return {
      name: binding.spec.name,
      description: binding.spec.description,
      is_supplier: true,
      is_manufacturer: binding.spec.isManufacturer,
      // Sent as a file in the multipart create; confirmation needs a retained image in the output.
      ...(binding.spec.logo ? { image: true } : {}),
    }
  }
  if (step.kind === 'create_part') {
    const binding = plan.parts.find((part) => part.subjectId === step.partSubjectId)!
    return {
      name: binding.spec.name,
      category: binding.spec.category.pk,
      tags: binding.spec.tags,
      copy_category_parameters: false,
    }
  }
  if (step.kind === 'part_attachment') {
    const transfer = plan.partAttachments.find(
      (transfer) => partTransferKey(transfer) === step.operationKey,
    )!
    const part = transfer.part ?? (await confirmedPartPk(pool, runId, plan, step.partSubjectId))
    return part ? { ...step.input, model_type: 'part', model_id: part } : null
  }
  const part = await confirmedPartPk(pool, runId, plan, step.partSubjectId)
  if (!part) {
    return null
  }
  if (step.kind === 'parameter') {
    return { ...step.input, model_type: 'part.part', model_id: part }
  }
  if (step.kind === 'supplier' && step.dependencies.length > 1) {
    return supplierCreateBody(pool, runId, plan, step, part)
  }
  return { ...step.input, part }
}

async function stockCreateBody(
  pool: Pool,
  runId: string,
  plan: EffectsPlan,
  part: string | null,
  partOperationKey: string | null,
  step: { quantity: string; location: string | null; barcode: string },
): Promise<SupportedCreateBody | null> {
  let resolved = part
  if (resolved === null) {
    const state = (await supportedStates(pool, runId, plan)).find(
      (item) => item.operationKey === partOperationKey,
    )
    if (state?.certainty === 'confirmed' && state.remotePks.length === 1) {
      resolved = state.remotePks[0]
    }
  }
  return resolved
    ? { part: resolved, quantity: step.quantity, location: step.location, barcode: step.barcode }
    : null
}

async function supplierCreateBody(
  pool: Pool,
  runId: string,
  plan: EffectsPlan,
  step: EffectOperation,
  part: string,
): Promise<SupportedCreateBody | null> {
  const manufacturer = (await supportedStates(pool, runId, plan)).find(
    (state) => state.operationKey === logicalEffectKey(step.partSubjectId, 'manufacturer'),
  )
  if (manufacturer?.certainty !== 'confirmed' || manufacturer.remotePks.length !== 1) {
    return null
  }
  return { ...step.input, part, manufacturer_part: manufacturer.remotePks[0] }
}

/** A new location's PK comes only from a usable confirmed single-PK create; `undefined` waits. */
async function stockLocation(
  pool: Pool,
  runId: string,
  plan: EffectsPlan,
  step: { location: string | null; locationOperationKey?: string | null },
): Promise<string | null | undefined> {
  if (!step.locationOperationKey) {
    // A reused new location must still be its original run's usable confirmed output.
    const reused = plan.locations?.find(
      (binding) => binding.prior && binding.prior.pk === step.location,
    )
    if (reused?.prior) {
      try {
        await requirePriorRecord(pool, plan, reused.draftId, reused.specDigest, reused.prior)
      } catch {
        return undefined
      }
    }
    return step.location
  }
  const state = (await supportedStates(pool, runId, plan)).find(
    (item) => item.operationKey === step.locationOperationKey,
  )
  return state?.certainty === 'confirmed' &&
    state.verification !== 'missing_or_changed' &&
    state.verification !== 'unavailable' &&
    state.remotePks.length === 1
    ? state.remotePks[0]
    : undefined
}
