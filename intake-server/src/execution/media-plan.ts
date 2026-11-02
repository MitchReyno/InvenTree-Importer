import { decodeEffectsPlan, type EffectsPlan } from './effects-plan.ts'
import { Digest } from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { CAPABILITY, EXECUTOR_BUILD, decodePlan, id, type StockPlan } from './plan.ts'

export const MEDIA_EXECUTOR_BUILD = 'bench-media/1'
export const MEDIA_CAPABILITY = 'owned-fake-media/1'

export interface MediaPlanEvidence {
  versionId: string
  evidenceId: string
  blobDigest: string
  byteSize: string
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf'
  kind: 'original' | 'derived'
  originalVersionId: string
  originalDigest: string
  recipeDigest: string | null
}

export interface AttachmentOperation extends MediaPlanEvidence {
  artifactKey: string
  stockOperationKey: string
  destination: 'stock_attachment'
}

export interface MediaPlan extends Omit<StockPlan, 'version' | 'build' | 'capability'> {
  version: 'bench-media-plan/1'
  build: typeof MEDIA_EXECUTOR_BUILD
  capability: typeof MEDIA_CAPABILITY
  attachments: AttachmentOperation[]
  mediaInputsDigest: string
  evidence: MediaPlanEvidence[]
}

export type ExecutablePlan = StockPlan | MediaPlan | EffectsPlan

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_media_plan')
  }
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('invalid_media_plan')
  }
  return value as Record<string, unknown>
}

function digest(value: unknown) {
  if (typeof value !== 'string' || !new RegExp(Digest.pattern!).test(value)) {
    throw new Error('invalid_media_plan_digest')
  }
}

const evidenceKeys = [
  'versionId',
  'evidenceId',
  'blobDigest',
  'byteSize',
  'mediaType',
  'kind',
  'originalVersionId',
  'originalDigest',
  'recipeDigest',
] as const

function validateVersionFields(version: Record<string, unknown>) {
  id(version.versionId)
  id(version.evidenceId)
  id(version.originalVersionId)
  digest(version.blobDigest)
  digest(version.originalDigest)
  const validByteSize =
    typeof version.byteSize === 'string' &&
    /^[1-9][0-9]{0,7}$/.test(version.byteSize) &&
    BigInt(version.byteSize) <= 20971520n
  if (!validByteSize) {
    throw new Error('invalid_media_plan_size')
  }
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(String(version.mediaType))) {
    throw new Error('unsupported_attachment_type')
  }
  if (version.kind === 'original') {
    const sameOriginal =
      version.versionId === version.originalVersionId &&
      version.blobDigest === version.originalDigest
    if (!sameOriginal || version.recipeDigest !== null) {
      throw new Error('invalid_original_attachment')
    }
  } else if (version.kind === 'derived') {
    digest(version.recipeDigest)
    if (version.mediaType !== 'image/png' || version.versionId === version.originalVersionId) {
      throw new Error('invalid_derived_attachment')
    }
  } else {
    throw new Error('unsupported_attachment_kind')
  }
}

export function validateEvidence(value: unknown): MediaPlanEvidence {
  const version = record(value, evidenceKeys)
  validateVersionFields(version)
  return version as unknown as MediaPlanEvidence
}

function validateAttachment(value: unknown, stockKeys: Set<string>): AttachmentOperation {
  const attachment = record(value, [
    ...evidenceKeys,
    'artifactKey',
    'stockOperationKey',
    'destination',
  ])
  validateVersionFields(attachment)
  id(attachment.artifactKey)
  id(attachment.stockOperationKey)
  if (attachment.destination !== 'stock_attachment') {
    throw new Error('invalid_attachment_effect')
  }
  if (!stockKeys.has(attachment.stockOperationKey as string)) {
    throw new Error('attachment_destination_not_selected')
  }
  return attachment as unknown as AttachmentOperation
}

/** V1 is delegated byte-exact to its original decoder; no media fields are added to old plans. */
export function decodeExecutablePlan(bytes: Buffer, expectedDigest: Buffer): ExecutablePlan {
  verifyBytes(bytes, expectedDigest)
  const parsed = strictJson(bytes.toString('utf8'))
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).version === 'bench-stock-plan/1'
  ) {
    return decodePlan(bytes, expectedDigest)
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).version === 'bench-effects-plan/1'
  ) {
    return decodeEffectsPlan(bytes, expectedDigest)
  }
  const value = record(parsed, [
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
    'attachments',
    'mediaInputsDigest',
    'evidence',
  ])
  if (
    canonical(value) !== bytes.toString('utf8') ||
    value.version !== 'bench-media-plan/1' ||
    value.build !== MEDIA_EXECUTOR_BUILD ||
    value.capability !== MEDIA_CAPABILITY
  ) {
    throw new Error('unsupported_media_plan')
  }
  const { attachments, mediaInputsDigest, evidence, ...stockFields } = value
  digest(mediaInputsDigest)
  // Reuse frozen stock validation without storing translated bytes as authority.
  const stockBytes = Buffer.from(
    canonical({
      ...stockFields,
      version: 'bench-stock-plan/1',
      build: EXECUTOR_BUILD,
      capability: CAPABILITY,
    }),
  )
  const stock = decodePlan(stockBytes, sha256(stockBytes))
  if (!Array.isArray(attachments) || attachments.length > stock.operations.length) {
    throw new Error('invalid_attachment_scope')
  }
  if (!Array.isArray(evidence) || evidence.length > 64) {
    throw new Error('invalid_media_evidence_scope')
  }
  const evidenceByVersion = new Map<string, MediaPlanEvidence>()
  let totalBytes = 0n
  for (const item of evidence) {
    const version = validateEvidence(item)
    if (evidenceByVersion.has(version.versionId)) {
      throw new Error('duplicate_media_evidence')
    }
    evidenceByVersion.set(version.versionId, version)
    totalBytes += BigInt(version.byteSize)
  }
  if (totalBytes > 256n * 1024n * 1024n) {
    throw new Error('media_plan_byte_limit')
  }
  for (const version of evidenceByVersion.values()) {
    const original = evidenceByVersion.get(version.originalVersionId)
    if (
      !original ||
      original.kind !== 'original' ||
      original.blobDigest !== version.originalDigest ||
      original.evidenceId !== version.evidenceId
    ) {
      throw new Error('media_original_authority_missing')
    }
  }
  const stockKeys = new Set(stock.operations.map((operation) => operation.operationKey))
  const artifactKeys = new Set<string>()
  const destinations = new Set<string>()
  for (const item of attachments) {
    const attachment = validateAttachment(item, stockKeys)
    if (
      artifactKeys.has(attachment.artifactKey) ||
      destinations.has(attachment.stockOperationKey)
    ) {
      throw new Error('duplicate_attachment_scope')
    }
    const { artifactKey, stockOperationKey, destination, ...version } = attachment
    const retainedVersion = evidenceByVersion.get(attachment.versionId)
    if (!retainedVersion || canonical(version) !== canonical(retainedVersion)) {
      throw new Error('attachment_evidence_binding_mismatch')
    }
    artifactKeys.add(artifactKey)
    destinations.add(attachment.stockOperationKey)
  }
  return value as unknown as MediaPlan
}

export function encodeExecutablePlan(plan: ExecutablePlan) {
  const bytes = Buffer.from(canonical(plan))
  const digest = sha256(bytes)
  decodeExecutablePlan(bytes, digest)
  return { bytes, digest }
}

export function attachmentOperations(plan: ExecutablePlan): readonly AttachmentOperation[] {
  return plan.version === 'bench-stock-plan/1' ? [] : plan.attachments
}
