import type { PoolClient } from 'pg'
import { and, asc, eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { manualPreparationMedia } from './schema.ts'
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
    await executeDatabaseQuery(
      queryDatabase(client).insert(manualPreparationMedia).values({
        batchId,
        preparationId,
        subjectId,
        actorId,
        manifestBytes: inputs.bytes,
        manifestDigest: inputs.digest,
      }),
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
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        subjectId: manualPreparationMedia.subjectId,
        manifestBytes: manualPreparationMedia.manifestBytes,
        manifestDigest: manualPreparationMedia.manifestDigest,
      })
      .from(manualPreparationMedia)
      .where(
        and(
          eq(manualPreparationMedia.batchId, batchId),
          eq(manualPreparationMedia.preparationId, preparationId),
        ),
      )
      .orderBy(asc(manualPreparationMedia.subjectId)),
  )
  const inputsBySubject = new Map<string, MediaInputs>()
  for (const retained of result) {
    const inputs = decodeMediaInputs(retained.manifestBytes, retained.manifestDigest)
    const sameSubject =
      inputs.subjectIds.length === 1 && inputs.subjectIds[0] === retained.subjectId
    if (
      inputs.batchId !== batchId ||
      !sameSubject ||
      !reviewedSubjectIds.includes(retained.subjectId)
    ) {
      throw new Error('prepared_media_scope_mismatch')
    }
    inputsBySubject.set(retained.subjectId, inputs)
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
