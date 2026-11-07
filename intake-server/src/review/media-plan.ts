import { effectsCapable } from '../execution/effects-plan.ts'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import { canonicalMedia } from '../media/encoding.ts'
import type { MediaInputVersion, MediaInputs } from '../media/inputs.ts'
import { CAPABILITY, EXECUTOR_BUILD } from '../execution/plan.ts'
import {
  MEDIA_CAPABILITY,
  MEDIA_EXECUTOR_BUILD,
  type ExecutablePlan,
  type MediaPlanEvidence,
  type AttachmentOperation,
} from '../execution/media-plan.ts'
import type { ManualMaterial } from './model.ts'
import { stockPlan, type DeploymentBinding } from './authority.ts'

export function evidenceVersion(
  version: MediaInputVersion,
  versions: readonly MediaInputVersion[],
): MediaPlanEvidence {
  const originalId = version.recipe?.source_version_id ?? version.versionId
  const original = versions.find((candidate) => candidate.versionId === originalId)
  if (!original || original.kind !== 'original') {
    throw new Error('media_original_authority_missing')
  }
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(version.mediaType)) {
    throw new Error('unsupported_media_evidence_type')
  }
  return {
    versionId: version.versionId,
    evidenceId: version.evidenceId,
    blobDigest: version.digest,
    byteSize: version.byteSize,
    mediaType: version.mediaType as MediaPlanEvidence['mediaType'],
    kind: version.kind,
    originalVersionId: original.versionId,
    originalDigest: original.digest,
    recipeDigest: version.recipe ? sha256(canonicalMedia(version.recipe)).toString('hex') : null,
  }
}

export function retainedEvidence(
  inputsBySubject: ReadonlyMap<string, MediaInputs>,
  extra: readonly MediaInputVersion[] = [],
) {
  const allVersions = new Map<string, MediaInputVersion>()
  for (const inputs of [...inputsBySubject.values(), { versions: extra }]) {
    for (const version of inputs.versions) {
      const existing = allVersions.get(version.versionId)
      if (existing && canonicalMedia(existing) !== canonicalMedia(version)) {
        throw new Error('conflicting_media_version_authority')
      }
      allVersions.set(version.versionId, version)
    }
  }
  const versions = [...allVersions.values()]
  return versions
    .map((version) => evidenceVersion(version, versions))
    .sort((left, right) => left.versionId.localeCompare(right.versionId))
}

export function selectedAttachments(
  material: ManualMaterial,
  evidence: readonly MediaPlanEvidence[],
) {
  const attachments: AttachmentOperation[] = []
  for (const effect of material.effects) {
    const inputs = material.mediaInputs?.get(effect.lot_id)
    const selection = inputs?.attachments.find((item) => item.subject_id === effect.lot_id)
    if (selection?.mode === 'selected') {
      const selected = evidence.find((version) => version.versionId === selection.version_id)
      if (!selected) {
        throw new Error('selected_media_authority_missing')
      }
      attachments.push({
        ...selected,
        artifactKey: selection.id,
        stockOperationKey: effect.lot_id,
        destination: 'stock_attachment',
      })
    }
  }
  return attachments.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
}

export function mediaManifestDigest(inputsBySubject: ReadonlyMap<string, MediaInputs>) {
  const manifest = [...inputsBySubject.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subjectId, input]) => ({
      subjectId,
      bytes: input.bytes.toString('utf8'),
      digest: input.digest.toString('hex'),
    }))
  return sha256(canonical(manifest)).toString('hex')
}

/** New media authority is additive; stock-only deployments retain their original v1 bytes. */
export function preparedPlan(
  binding: DeploymentBinding,
  sourceId: string,
  originalSourceKey: string,
  material: ManualMaterial,
): ExecutablePlan {
  if (effectsCapable(binding.capability)) {
    throw new Error('effects_preparation_requires_retained_bindings')
  }
  if (binding.capability === CAPABILITY) {
    if (material.mediaInputs?.size) {
      throw new Error('unsupported_media_capability')
    }
    return stockPlan(binding, sourceId, originalSourceKey, material)
  }
  const stock = stockPlan(
    { ...binding, build: EXECUTOR_BUILD, capability: CAPABILITY },
    sourceId,
    originalSourceKey,
    material,
  )
  const inputs = material.mediaInputs ?? new Map<string, MediaInputs>()
  const evidence = retainedEvidence(inputs)
  return {
    ...stock,
    version: 'bench-media-plan/1',
    build: MEDIA_EXECUTOR_BUILD,
    capability: MEDIA_CAPABILITY,
    attachments: selectedAttachments(material, evidence),
    evidence,
    mediaInputsDigest: mediaManifestDigest(inputs),
  }
}
