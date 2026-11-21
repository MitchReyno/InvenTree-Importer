import type {
  CaptureSnapshotDto,
  ManualAttachmentDto,
  ManualMediaEvidenceDto,
  ManualPreviewDto,
} from '@invimport/contracts'
import type { ExecutablePlan, MediaPlanEvidence } from '#/execution/media-plan.ts'

export function evidencePreview(version: MediaPlanEvidence): ManualMediaEvidenceDto {
  return {
    version_id: version.versionId,
    evidence_id: version.evidenceId,
    blob_sha256: version.blobDigest,
    byte_size: version.byteSize,
    media_type: version.mediaType,
    kind: version.kind,
    original_version_id: version.originalVersionId,
    original_sha256: version.originalDigest,
    recipe_sha256: version.recipeDigest,
  }
}

/** Preview fields come only from the exact validated plan and retained display context. */
export function mediaPreview(
  plan: ExecutablePlan,
  capture: CaptureSnapshotDto,
  evidenceLabels: ReadonlyMap<string, string>,
): Pick<ManualPreviewDto, 'attachments' | 'evidence' | 'media_inputs_sha256'> {
  if (plan.version === 'bench-stock-plan/1') {
    return {}
  }
  const attachments: ManualAttachmentDto[] = plan.attachments.map((attachment) => {
    const lot = capture.lots.find((candidate) => candidate.id === attachment.stockOperationKey)
    const evidenceLabel = evidenceLabels.get(attachment.evidenceId)
    if (!lot || !evidenceLabel) {
      throw new Error('media_preview_context_missing')
    }
    return {
      ...evidencePreview(attachment),
      artifact_key: attachment.artifactKey,
      lot_id: lot.id,
      lot_label: lot.label,
      evidence_label: evidenceLabel,
      destination: attachment.destination,
    }
  })
  return {
    attachments,
    evidence: plan.evidence.map(evidencePreview),
    media_inputs_sha256: plan.mediaInputsDigest,
  }
}
