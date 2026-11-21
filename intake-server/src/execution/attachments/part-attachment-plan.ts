import { canonical } from '@invimport/contracts/json'
import type { MediaPlanEvidence } from '#/execution/media-plan.ts'
import {
  logicalEffectKey,
  type EffectOperation,
  type PartBinding,
} from '#/execution/effects/effects-plan.ts'

export interface PartTransfer {
  artifactKey: string
  partSubjectId: string
  destinationKey: string
  part: string | null
  partOperationKey: string | null
  version: MediaPlanEvidence
  prior: null | {
    runId: string
    operationKey: string
    intentId: string
    pk: string
    artifactKey: string
  }
}

export function partTransferKey(
  transfer: Pick<PartTransfer, 'partSubjectId' | 'destinationKey' | 'version'>,
) {
  return logicalEffectKey(
    transfer.partSubjectId,
    'part_attachment',
    canonical({
      destinationKey: transfer.destinationKey,
      versionId: transfer.version.versionId,
      digest: transfer.version.blobDigest,
    }),
  )
}

export function partTransferEffects(transfers: readonly PartTransfer[]): EffectOperation[] {
  return transfers
    .filter((transfer) => transfer.prior === null)
    .map((transfer) => ({
      operationKey: partTransferKey(transfer),
      partSubjectId: transfer.partSubjectId,
      kind: 'part_attachment',
      dependencies: transfer.partOperationKey ? [transfer.partOperationKey] : [],
      input: {
        artifact_key: transfer.artifactKey,
        version_id: transfer.version.versionId,
        blob_sha256: transfer.version.blobDigest,
        byte_size: transfer.version.byteSize,
        media_type: transfer.version.mediaType,
        destination_key: transfer.destinationKey,
      },
    }))
}

export function partDestinationKey(
  subjectId: string,
  part: string | null,
  binding: PartBinding | undefined,
) {
  if (binding) {
    return `created:${subjectId}:${binding.specDigest}`
  }
  if (part === null) {
    throw new Error('part_attachment_destination_missing')
  }
  return `existing:${part}`
}
