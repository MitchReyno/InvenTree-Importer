import { prepareMediaTransaction } from './transaction.ts'
import type { PoolClient } from 'pg'
import { captureInTransaction } from '#/capture/repository.ts'
import { CaptureError } from '#/capture/model.ts'
import { lockMediaRevision } from './commands.ts'
import { lockBlob } from './blob-store.ts'
import type { MediaPlan, MediaPlanEvidence } from '#/execution/media-plan.ts'
import { removedVersionIds } from './removal.ts'

interface RetainedVersion {
  id: string
  evidence_id: string
  kind: string
  blob_digest: Buffer
  byte_size: string
  media_type: string
  source_version_id: string | null
  recipe_digest: Buffer | null
}

function versionMatches(expected: MediaPlanEvidence, retained: RetainedVersion) {
  const sameIdentity =
    retained.id === expected.versionId &&
    retained.evidence_id === expected.evidenceId &&
    retained.kind === expected.kind
  const sameBytes =
    retained.blob_digest.toString('hex') === expected.blobDigest &&
    retained.byte_size === expected.byteSize &&
    retained.media_type === expected.mediaType
  const sameRecipe = (retained.recipe_digest?.toString('hex') ?? null) === expected.recipeDigest
  const expectedSource = expected.kind === 'original' ? null : expected.originalVersionId
  return sameIdentity && sameBytes && sameRecipe && retained.source_version_id === expectedSource
}

/** Acquire capture/media/digest locks before reserving the v2 run's immutable journal. */
export async function lockApprovedMedia(
  client: PoolClient,
  actorId: string,
  plan: Pick<MediaPlan, 'sourceId' | 'targetId' | 'contextId' | 'originalSourceKey' | 'evidence'>,
) {
  await prepareMediaTransaction(client)
  const batch = await client.query<{ id: string }>(
    `SELECT id FROM capture_batch
     WHERE source_id=$1 AND actor_id=$2 AND target_id=$3 AND target_context_id=$4`,
    [plan.sourceId, actorId, plan.targetId, plan.contextId],
  )
  const batchId = batch.rows[0]?.id
  if (!batchId) {
    throw new Error('media_source_authority_missing')
  }
  await captureInTransaction(
    client,
    { actorId, targetId: plan.targetId, targetContextId: plan.contextId },
    batchId,
    true,
  )
  await lockMediaRevision(client, batchId)
  for (const digest of [...new Set(plan.evidence.map((version) => version.blobDigest))].sort()) {
    await lockBlob(client, digest)
  }
  const versions = await client.query<RetainedVersion>(
    `SELECT v.id,v.evidence_id,v.kind,v.blob_digest,b.byte_size,v.media_type,
            v.source_version_id,v.recipe_digest
     FROM public.media_version v JOIN public.media_blob b ON b.digest=v.blob_digest
     JOIN public.media_decode_command c ON
       (v.kind='original' AND c.version_id=v.id AND c.derivation_id IS NULL)
       OR (v.kind='derived' AND c.derivation_id=v.id)
     JOIN public.media_decode_result r ON r.command_id=c.id AND r.state='ready'
     WHERE v.batch_id=$1 AND v.id=ANY($2::uuid[])`,
    [batchId, plan.evidence.map((version) => version.versionId)],
  )
  if (versions.rows.length !== plan.evidence.length) {
    throw new Error('approved_media_not_ready')
  }
  // Approval refuses removed evidence first; this keeps a pin from ever naming one.
  const removed = await removedVersionIds(
    client,
    batchId,
    plan.evidence.map((version) => version.versionId),
  )
  if (removed.size) {
    throw new CaptureError(409, 'approval_evidence_removed')
  }
  for (const expected of plan.evidence) {
    const retained = versions.rows.find((version) => version.id === expected.versionId)
    if (!retained || !versionMatches(expected, retained)) {
      throw new Error('approved_media_binding_mismatch')
    }
  }
  return batchId
}

export async function retainApprovedMediaPins(
  client: PoolClient,
  approvalId: string,
  batchId: string,
  plan: Pick<MediaPlan, 'sourceId' | 'targetId' | 'contextId' | 'originalSourceKey' | 'evidence'>,
) {
  for (const version of plan.evidence) {
    await client.query(
      `INSERT INTO public.media_approval_pin(approval_id,batch_id,source_id,target_id,original_key,version_id,blob_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        approvalId,
        batchId,
        plan.sourceId,
        plan.targetId,
        plan.originalSourceKey,
        version.versionId,
        Buffer.from(version.blobDigest, 'hex'),
      ],
    )
  }
}

/** Missing pins are lost authority, never permission to reconstruct scope from current selections. */
export async function requireApprovedMediaPins(
  client: Pick<PoolClient, 'query'>,
  approvalId: string,
  plan: Pick<MediaPlan, 'sourceId' | 'targetId' | 'contextId' | 'originalSourceKey' | 'evidence'>,
) {
  const result = await client.query<RetainedVersion>(
    `SELECT v.id,v.evidence_id,v.kind,v.blob_digest,b.byte_size,v.media_type,
            v.source_version_id,v.recipe_digest
     FROM public.media_approval_pin p JOIN public.media_version v ON v.id=p.version_id AND v.batch_id=p.batch_id
     JOIN public.media_blob b ON b.digest=p.blob_digest AND b.digest=v.blob_digest
     WHERE p.approval_id=$1`,
    [approvalId],
  )
  if (result.rows.length !== plan.evidence.length) {
    throw new Error('approved_media_pin_missing')
  }
  for (const expected of plan.evidence) {
    const retained = result.rows.find((version) => version.id === expected.versionId)
    if (!retained || !versionMatches(expected, retained)) {
      throw new Error('approved_media_pin_changed')
    }
  }
}
