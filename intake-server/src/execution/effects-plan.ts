import {
  partTransferEffects,
  partTransferKey,
  partDestinationKey,
  type PartTransfer,
} from './part-attachment-plan.ts'
import { approvedTagNamesValid } from '../inventory/tags.ts'
import { SUPPORTED_EFFECTS_MANIFEST } from './effects-capability.ts'
import { createHash } from 'node:crypto'
import { Quantity, validate, type InventoryPartSpecDto } from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { id, pk, contributionBarcode, type StockPlan } from './plan.ts'
import { validateEvidence, type MediaPlanEvidence, type AttachmentOperation } from './media-plan.ts'

export const EFFECTS_BUILD = 'bench-effects/1'
export const EFFECTS_CAPABILITY = 'owned-fake-effects/1'
export type EffectKind =
  'create_part' | 'parameter' | 'manufacturer' | 'supplier' | 'part_attachment'
export interface PartBinding {
  subjectId: string
  spec: InventoryPartSpecDto
  specDigest: string
  prior: null | { runId: string; intentId: string; pk: string }
}
export interface EffectOperation {
  operationKey: string
  partSubjectId: string
  kind: EffectKind
  dependencies: string[]
  input: Record<string, string>
}
export interface EffectsStockOperation {
  operationKey: string
  contributionKey: string
  part: string | null
  partOperationKey: string | null
  location: string | null
  quantity: string
  barcode: string
}
export interface EffectsPlan extends Omit<
  StockPlan,
  'version' | 'build' | 'capability' | 'operations'
> {
  version: 'bench-effects-plan/1'
  build: typeof EFFECTS_BUILD
  capability: typeof EFFECTS_CAPABILITY
  mediaConfigured: boolean
  manifestDigest: string
  parts: PartBinding[]
  partAttachments: PartTransfer[]
  effects: EffectOperation[]
  operations: EffectsStockOperation[]
  evidence: MediaPlanEvidence[]
  attachments: AttachmentOperation[]
  mediaInputsDigest: string
}

export function logicalEffectKey(subjectId: string, kind: string, discriminator = '') {
  const hex = createHash('sha256')
    .update(canonical({ subjectId, kind, discriminator }))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function partSpecDigest(spec: InventoryPartSpecDto) {
  return sha256(canonical(spec)).toString('hex')
}

export function partEffects(binding: PartBinding): EffectOperation[] {
  if (binding.prior) {
    return []
  }
  const subject = binding.subjectId
  const createKey = logicalEffectKey(subject, 'create_part')
  const effects: EffectOperation[] = [
    {
      operationKey: createKey,
      partSubjectId: subject,
      kind: 'create_part',
      dependencies: [],
      input: {
        name: binding.spec.name,
        category: binding.spec.category.pk,
        tags: canonical(binding.spec.tags),
      },
    },
  ]
  for (const parameter of binding.spec.parameters) {
    effects.push({
      operationKey: logicalEffectKey(subject, 'parameter', parameter.template.pk),
      partSubjectId: subject,
      kind: 'parameter',
      dependencies: [createKey],
      input: { template: parameter.template.pk, data: parameter.value },
    })
  }
  if (binding.spec.manufacturer) {
    effects.push({
      operationKey: logicalEffectKey(subject, 'manufacturer'),
      partSubjectId: subject,
      kind: 'manufacturer',
      dependencies: [createKey],
      input: {
        manufacturer: binding.spec.manufacturer.company.pk,
        MPN: binding.spec.manufacturer.mpn,
      },
    })
  }
  if (binding.spec.supplier) {
    effects.push({
      operationKey: logicalEffectKey(subject, 'supplier'),
      partSubjectId: subject,
      kind: 'supplier',
      dependencies: binding.spec.manufacturer
        ? [createKey, logicalEffectKey(subject, 'manufacturer')]
        : [createKey],
      input: { supplier: binding.spec.supplier.company.pk, SKU: binding.spec.supplier.sku },
    })
  }
  return effects
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
  ) {
    throw new Error('invalid_effects_plan')
  }
  return value as Record<string, unknown>
}

/** Rebuild the index from typed specifications; arbitrary handler/body/dependency inputs are refused. */
export function decodeEffectsPlan(bytes: Buffer, digest: Buffer): EffectsPlan {
  verifyBytes(bytes, digest)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const value = record(strictJson(text), [
    'version',
    'deploymentId',
    'targetId',
    'contextId',
    'epoch',
    'build',
    'continuity',
    'capability',
    'sourceId',
    'originalSourceKey',
    'operations',
    'manifestDigest',
    'mediaConfigured',
    'parts',
    'partAttachments',
    'effects',
    'evidence',
    'attachments',
    'mediaInputsDigest',
  ])
  if (
    canonical(value) !== text ||
    value.version !== 'bench-effects-plan/1' ||
    value.build !== EFFECTS_BUILD ||
    value.capability !== EFFECTS_CAPABILITY ||
    typeof value.continuity !== 'string' ||
    !value.continuity ||
    value.continuity.length > 256
  ) {
    throw new Error('unsupported_effects_plan')
  }
  if (typeof value.mediaConfigured !== 'boolean') {
    throw new Error('invalid_media_configuration_binding')
  }
  if (value.manifestDigest !== sha256(canonical(SUPPORTED_EFFECTS_MANIFEST)).toString('hex')) {
    throw new Error('capability_manifest_mismatch')
  }
  for (const key of [
    'deploymentId',
    'targetId',
    'contextId',
    'epoch',
    'sourceId',
    'originalSourceKey',
  ]) {
    id(value[key])
  }
  if (
    !Array.isArray(value.parts) ||
    value.parts.length > 10 ||
    !Array.isArray(value.effects) ||
    value.effects.length > 100 ||
    !Array.isArray(value.operations) ||
    !value.operations.length ||
    value.operations.length > 10
  ) {
    throw new Error('invalid_effects_scope')
  }
  const subjects = new Set<string>()
  const expectedEffects: EffectOperation[] = []
  for (const item of value.parts) {
    const part = record(item, ['subjectId', 'spec', 'specDigest', 'prior'])
    id(part.subjectId)
    validate('InventoryPartSpec', part.spec)
    const spec = part.spec as InventoryPartSpecDto
    if (
      part.specDigest !== partSpecDigest(spec) ||
      !approvedTagNamesValid(spec.tags) ||
      subjects.has(part.subjectId)
    ) {
      throw new Error('unsupported_part_spec')
    }
    subjects.add(part.subjectId)
    if (part.prior !== null) {
      const prior = record(part.prior, ['runId', 'intentId', 'pk'])
      id(prior.runId)
      id(prior.intentId)
      pk(prior.pk)
    }
    expectedEffects.push(...partEffects(part as unknown as PartBinding))
  }

  const operationKeys = new Set<string>()
  const contributions = new Set<string>()
  for (const item of value.operations) {
    const operation = record(item, [
      'operationKey',
      'contributionKey',
      'part',
      'partOperationKey',
      'location',
      'quantity',
      'barcode',
    ])
    id(operation.operationKey)
    id(operation.contributionKey)
    if (
      typeof operation.quantity !== 'string' ||
      !new RegExp(Quantity.pattern!).test(operation.quantity)
    ) {
      throw new Error('invalid_stock_quantity')
    }
    if (operation.location !== null) {
      pk(operation.location)
    }
    if (operation.part === null) {
      id(operation.partOperationKey)
      if (
        !expectedEffects.some(
          (effect) =>
            effect.kind === 'create_part' && effect.operationKey === operation.partOperationKey,
        )
      ) {
        throw new Error('part_output_missing')
      }
    } else {
      pk(operation.part)
      if (operation.partOperationKey !== null) {
        throw new Error('ambiguous_part_identity')
      }
    }
    if (
      operation.barcode !==
        contributionBarcode(value.originalSourceKey as string, operation.contributionKey) ||
      operationKeys.has(operation.operationKey) ||
      contributions.has(operation.contributionKey)
    ) {
      throw new Error('invalid_effects_stock_scope')
    }
    if (expectedEffects.some((effect) => effect.operationKey === operation.operationKey)) {
      throw new Error('duplicate_effect_operation')
    }
    operationKeys.add(operation.operationKey)
    contributions.add(operation.contributionKey)
  }
  for (const item of value.parts) {
    const part = item as PartBinding
    const key = logicalEffectKey(part.subjectId, 'create_part')
    if (
      !value.operations.some((item: unknown) => {
        const operation = item as EffectsStockOperation
        return part.prior ? operation.part === part.prior.pk : operation.partOperationKey === key
      })
    ) {
      throw new Error('unselected_part_effect')
    }
  }
  if (
    typeof value.mediaInputsDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.mediaInputsDigest)
  ) {
    throw new Error('invalid_media_digest')
  }
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length > 64 ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 10
  ) {
    throw new Error('invalid_effects_media')
  }
  if (
    value.mediaConfigured === false &&
    (value.evidence.length > 0 ||
      value.attachments.length > 0 ||
      (Array.isArray(value.partAttachments) && value.partAttachments.length > 0))
  ) {
    throw new Error('unconfigured_approved_media')
  }
  const evidence = value.evidence.map(validateEvidence)
  const versions = new Map(evidence.map((item) => [item.versionId, item]))
  if (
    versions.size !== evidence.length ||
    evidence.reduce((sum, item) => sum + BigInt(item.byteSize), 0n) > 268435456n
  ) {
    throw new Error('invalid_media_scope')
  }
  for (const item of evidence) {
    const original = versions.get(item.originalVersionId)
    if (
      !original ||
      original.kind !== 'original' ||
      original.blobDigest !== item.originalDigest ||
      original.evidenceId !== item.evidenceId
    ) {
      throw new Error('media_original_authority_missing')
    }
  }
  if (!Array.isArray(value.partAttachments) || value.partAttachments.length > 10) {
    throw new Error('invalid_part_attachment_scope')
  }
  const transferKeys = new Set<string>()
  for (const item of value.partAttachments) {
    const transfer = record(item, [
      'artifactKey',
      'partSubjectId',
      'destinationKey',
      'part',
      'partOperationKey',
      'version',
      'prior',
    ])
    id(transfer.artifactKey)
    id(transfer.partSubjectId)
    const version = validateEvidence(transfer.version)
    if (canonical(versions.get(version.versionId)) !== canonical(version)) {
      throw new Error('part_attachment_evidence_missing')
    }
    const binding = (value.parts as PartBinding[]).find(
      (part) => part.subjectId === transfer.partSubjectId,
    )
    if (transfer.part !== null) {
      pk(transfer.part)
    }
    if (
      binding &&
      (binding.prior
        ? transfer.part !== binding.prior.pk || transfer.partOperationKey !== null
        : transfer.part !== null ||
          transfer.partOperationKey !== logicalEffectKey(binding.subjectId, 'create_part'))
    ) {
      throw new Error('part_attachment_destination_changed')
    }
    if (transfer.part === null) {
      id(transfer.partOperationKey)
      if (
        !binding ||
        binding.prior !== null ||
        transfer.partOperationKey !== logicalEffectKey(binding.subjectId, 'create_part')
      ) {
        throw new Error('part_attachment_output_missing')
      }
    } else if (transfer.partOperationKey !== null) {
      throw new Error('ambiguous_part_attachment_identity')
    }
    if (
      transfer.destinationKey !==
      partDestinationKey(transfer.partSubjectId, transfer.part as string | null, binding)
    ) {
      throw new Error('part_attachment_destination_changed')
    }
    if (
      !value.operations.some((item) => {
        const operation = item as EffectsStockOperation
        return transfer.part !== null
          ? operation.part === transfer.part
          : operation.partOperationKey === transfer.partOperationKey
      })
    ) {
      throw new Error('unselected_part_attachment')
    }
    if (transfer.prior !== null) {
      const prior = record(transfer.prior, [
        'runId',
        'operationKey',
        'intentId',
        'pk',
        'artifactKey',
      ])
      id(prior.runId)
      id(prior.operationKey)
      id(prior.intentId)
      id(prior.artifactKey)
      pk(prior.pk)
    }
    const key = partTransferKey(transfer as unknown as PartTransfer)
    if (transferKeys.has(key) || operationKeys.has(key)) {
      throw new Error('duplicate_part_attachment')
    }
    transferKeys.add(key)
  }
  expectedEffects.push(...partTransferEffects(value.partAttachments as unknown as PartTransfer[]))
  if (canonical(value.effects) !== canonical(expectedEffects)) {
    throw new Error('effect_index_mismatch')
  }
  const destinations = new Set<string>()
  const artifactKeys = new Set<string>()
  for (const item of value.attachments) {
    const attachment = record(item, [
      'versionId',
      'evidenceId',
      'blobDigest',
      'byteSize',
      'mediaType',
      'kind',
      'originalVersionId',
      'originalDigest',
      'recipeDigest',
      'artifactKey',
      'stockOperationKey',
      'destination',
    ])
    id(attachment.artifactKey)
    id(attachment.stockOperationKey)
    const { artifactKey, stockOperationKey, destination, ...fields } = attachment
    const version = versions.get(attachment.versionId as string)
    if (
      destination !== 'stock_attachment' ||
      !operationKeys.has(stockOperationKey) ||
      !version ||
      canonical(fields) !== canonical(version) ||
      destinations.has(stockOperationKey) ||
      artifactKeys.has(artifactKey)
    ) {
      throw new Error('invalid_effects_attachment')
    }
    destinations.add(stockOperationKey)
    artifactKeys.add(artifactKey)
  }
  return value as unknown as EffectsPlan
}
