import type {
  ManualEffectDto,
  ManualPartAttachmentDto,
  SupportedEffectPreviewDto,
} from '@invimport/contracts'
import type { EffectsPlan, EffectKind } from '../execution/effects-plan.ts'
import { evidencePreview } from './media-preview.ts'

const labels: Record<EffectKind, string> = {
  create_part: 'Create one shared Part',
  parameter: 'Create mapped parameter',
  manufacturer: 'Create manufacturer relationship',
  supplier: 'Create supplier relationship',
  part_attachment: 'Attach selected file to Part',
}

export function supportedEffectsPreview(plan: EffectsPlan): SupportedEffectPreviewDto[] {
  return plan.effects.map((effect) => ({
    operation_key: effect.operationKey,
    part_subject_id: effect.partSubjectId,
    kind: effect.kind,
    label: labels[effect.kind],
    dependencies: effect.dependencies,
    inputs: effect.input,
  }))
}

export function partAttachmentsPreview(
  plan: EffectsPlan,
  effects: ManualEffectDto[],
): ManualPartAttachmentDto[] {
  return plan.partAttachments.map((transfer) => {
    const binding = plan.parts.find((part) => part.subjectId === transfer.partSubjectId)
    const label =
      binding?.spec.name ??
      effects.find((effect) => effect.part_id === transfer.part)?.part_label ??
      `Part #${transfer.part}`
    const fields = {
      ...evidencePreview(transfer.version),
      artifact_key: transfer.artifactKey,
      part_subject_id: transfer.partSubjectId,
      part_label: label,
      destination: 'part_attachment' as const,
      prior_run_id: transfer.prior?.runId ?? null,
      prior_remote_pk: transfer.prior?.pk ?? null,
    }
    return transfer.part !== null
      ? { ...fields, part_id: transfer.part }
      : { ...fields, part_id: null, part_operation_key: transfer.partOperationKey! }
  })
}
