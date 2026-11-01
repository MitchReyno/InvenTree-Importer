import type { PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { decodeMediaInputs, type MediaInputs } from '../media/inputs.ts'
import type { ExecutablePlan } from '../execution/media-plan.ts'
import { mediaManifestDigest, retainedEvidence } from './media-plan.ts'
import type { ManualMaterial } from './model.ts'

export async function retainPreparationMedia(
  client: PoolClient,
  batchId: string,
  preparationId: string,
  actorId: string,
  material: ManualMaterial,
) {
  for (const [subjectId, inputs] of material.mediaInputs ?? []) {
    await client.query(
      `INSERT INTO manual_preparation_media(batch_id,preparation_id,subject_id,actor_id,manifest_bytes,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [batchId, preparationId, subjectId, actorId, inputs.bytes, inputs.digest],
    )
  }
}

/** Retained manifests, not today's evidence links, explain an old approved media scope. */
export async function requirePreparationMedia(
  client: PoolClient,
  batchId: string,
  preparationId: string,
  plan: ExecutablePlan,
  reviewedSubjectIds: readonly string[],
) {
  if (plan.version === 'bench-stock-plan/1') {
    return
  }
  const result = await client.query<{
    subject_id: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
  }>(
    `SELECT subject_id,manifest_bytes,manifest_digest FROM manual_preparation_media
     WHERE batch_id=$1 AND preparation_id=$2 ORDER BY subject_id`,
    [batchId, preparationId],
  )
  const inputsBySubject = new Map<string, MediaInputs>()
  for (const retained of result.rows) {
    const inputs = decodeMediaInputs(retained.manifest_bytes, retained.manifest_digest)
    const sameSubject =
      inputs.subjectIds.length === 1 && inputs.subjectIds[0] === retained.subject_id
    if (
      inputs.batchId !== batchId ||
      !sameSubject ||
      !reviewedSubjectIds.includes(retained.subject_id)
    ) {
      throw new Error('prepared_media_scope_mismatch')
    }
    inputsBySubject.set(retained.subject_id, inputs)
  }
  const sameManifest = mediaManifestDigest(inputsBySubject) === plan.mediaInputsDigest
  const sameEvidence = canonical(retainedEvidence(inputsBySubject)) === canonical(plan.evidence)
  if (!sameManifest || !sameEvidence) {
    throw new Error('prepared_media_authority_changed')
  }
  for (const attachment of plan.attachments) {
    const inputs = inputsBySubject.get(attachment.stockOperationKey)
    const selection = inputs?.attachments.find(
      (candidate) => candidate.id === attachment.artifactKey,
    )
    if (
      !selection ||
      selection.mode !== 'selected' ||
      selection.version_id !== attachment.versionId ||
      selection.subject_id !== attachment.stockOperationKey ||
      selection.destination !== 'lot_attachment'
    ) {
      throw new Error('prepared_attachment_selection_changed')
    }
  }
}
