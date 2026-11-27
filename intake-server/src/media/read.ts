import { activeMediaGroups, enrichMediaNotes } from './context.ts'
import { prepareMediaTransaction } from './transaction.ts'
import type { PoolClient } from 'pg'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { validate, type MediaRemovalImpactDto, type MediaSnapshotDto } from '@invimport/contracts'
import { captureInTransaction } from '#/capture/repository.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { captureEvidenceObservations, captureLotEvidenceObservations } from '#/capture/schema.ts'
import {
  mediaAttachmentSelections,
  mediaBatches,
  mediaBlobs,
  mediaDecodeCommands,
  mediaDecodeResults,
  mediaDerivations,
  mediaEvidence,
  mediaLinks,
  mediaMemberships,
  mediaPreviews,
  mediaVersions,
} from './schema.ts'
import { projectMediaSnapshot, type MediaRows } from './projection.ts'
import { currentRemovals, versionRemovedSql } from './removal.ts'
import { combinedRemovalImpact, removalImpacts } from './removal-impact.ts'
import { loadReviewContext } from '#/capture/review-context.ts'

async function readMediaRows(client: PoolClient, batchId: string): Promise<MediaRows> {
  const db = queryDatabase(client)
  const revision = await executeDatabaseQuery(
    db
      .select({ revision: mediaBatches.revision })
      .from(mediaBatches)
      .where(eq(mediaBatches.batchId, batchId)),
  )
  const evidence = await executeDatabaseQuery(
    db
      .select({ id: mediaEvidence.id, label: mediaEvidence.label })
      .from(mediaEvidence)
      .where(eq(mediaEvidence.batchId, batchId))
      .orderBy(asc(mediaEvidence.createdAt), asc(mediaEvidence.id)),
  )
  const versions = await executeDatabaseQuery(
    db
      .select({
        id: mediaVersions.id,
        evidence_id: mediaVersions.evidenceId,
        kind: mediaVersions.kind,
        blob_digest: mediaVersions.blobDigest,
        media_type: mediaVersions.mediaType,
        recipe_bytes: mediaVersions.recipeBytes,
        recipe_digest: mediaVersions.recipeDigest,
        byte_size: mediaBlobs.byteSize,
        state: mediaDecodeResults.state,
        decoder_build: mediaDecodeResults.decoderBuild,
      })
      .from(mediaVersions)
      .innerJoin(mediaBlobs, eq(mediaBlobs.digest, mediaVersions.blobDigest))
      .leftJoin(
        mediaDecodeCommands,
        or(
          and(
            eq(mediaVersions.kind, 'original'),
            eq(mediaDecodeCommands.versionId, mediaVersions.id),
            isNull(mediaDecodeCommands.derivationId),
          ),
          and(
            eq(mediaVersions.kind, 'derived'),
            eq(mediaDecodeCommands.derivationId, mediaVersions.id),
          ),
        ),
      )
      .leftJoin(mediaDecodeResults, eq(mediaDecodeResults.commandId, mediaDecodeCommands.id))
      .where(eq(mediaVersions.batchId, batchId))
      .orderBy(asc(mediaVersions.createdAt), asc(mediaVersions.id)),
  )
  const previews = await executeDatabaseQuery(
    db
      .select({
        id: mediaPreviews.id,
        version_id: mediaPreviews.versionId,
        page: mediaPreviews.page,
        width: mediaPreviews.width,
        height: mediaPreviews.height,
      })
      .from(mediaPreviews)
      .where(eq(mediaPreviews.batchId, batchId))
      .orderBy(asc(mediaPreviews.page)),
  )
  const groups = await activeMediaGroups(client, batchId)
  const membership = await executeDatabaseQuery(
    db
      .selectDistinctOn([mediaMemberships.evidenceId], {
        evidence_id: mediaMemberships.evidenceId,
        group_id: mediaMemberships.groupId,
      })
      .from(mediaMemberships)
      .where(eq(mediaMemberships.batchId, batchId))
      .orderBy(asc(mediaMemberships.evidenceId), desc(mediaMemberships.revision)),
  )
  const links = await executeDatabaseQuery(
    db
      .selectDistinctOn([mediaLinks.evidenceId, mediaLinks.subjectId], {
        evidence_id: mediaLinks.evidenceId,
        subject_id: mediaLinks.subjectId,
        linked: mediaLinks.linked,
      })
      .from(mediaLinks)
      .where(eq(mediaLinks.batchId, batchId))
      .orderBy(asc(mediaLinks.evidenceId), asc(mediaLinks.subjectId), desc(mediaLinks.revision)),
  )
  const observationLinks = await executeDatabaseQuery(
    db
      .selectDistinct({
        evidence_id: mediaVersions.evidenceId,
        subject_id: captureLotEvidenceObservations.lotId,
      })
      .from(captureLotEvidenceObservations)
      .innerJoin(
        captureEvidenceObservations,
        eq(captureEvidenceObservations.id, captureLotEvidenceObservations.evidenceObservationId),
      )
      .innerJoin(mediaVersions, eq(mediaVersions.id, captureEvidenceObservations.evidenceVersionId))
      .where(
        and(
          eq(captureLotEvidenceObservations.batchId, batchId),
          eq(captureLotEvidenceObservations.status, 'active'),
          eq(captureEvidenceObservations.status, 'active'),
        ),
      )
      .orderBy(asc(mediaVersions.evidenceId), asc(captureLotEvidenceObservations.lotId)),
  )
  const attachments = await executeDatabaseQuery(
    db
      .selectDistinctOn([mediaAttachmentSelections.subjectId], {
        id: mediaAttachmentSelections.id,
        subject_id: mediaAttachmentSelections.subjectId,
        mode: mediaAttachmentSelections.mode,
        version_id: mediaAttachmentSelections.versionId,
        destination: mediaAttachmentSelections.destination,
      })
      .from(mediaAttachmentSelections)
      .where(eq(mediaAttachmentSelections.batchId, batchId))
      .orderBy(asc(mediaAttachmentSelections.subjectId), desc(mediaAttachmentSelections.revision)),
  )
  const derivations = await executeDatabaseQuery(
    db
      .select({
        id: mediaDerivations.id,
        evidence_id: mediaDerivations.evidenceId,
        recipe_bytes: mediaDerivations.recipeBytes,
        recipe_digest: mediaDerivations.recipeDigest,
        state: mediaDecodeResults.state,
        produced_version_id: mediaVersions.id,
      })
      .from(mediaDerivations)
      .innerJoin(mediaDecodeCommands, eq(mediaDecodeCommands.derivationId, mediaDerivations.id))
      .leftJoin(mediaDecodeResults, eq(mediaDecodeResults.commandId, mediaDecodeCommands.id))
      .leftJoin(mediaVersions, eq(mediaVersions.id, mediaDerivations.id))
      .where(eq(mediaDerivations.batchId, batchId))
      .orderBy(asc(mediaDerivations.createdAt), asc(mediaDerivations.id)),
  )
  const removals = [...(await currentRemovals(client, batchId)).values()].map((state) => ({
    evidence_id: state.evidenceId,
    removed: state.removed,
    revision: state.revision,
    created_at: state.createdAt,
  }))
  return {
    revision: revision[0]?.revision ?? '1',
    removals,
    evidence,
    versions,
    previews,
    groups,
    membership,
    links,
    observation_links: observationLinks,
    attachments,
    derivations,
  }
}

/** Approvals that pinned a version of each item, with when they were approved. */
async function approvalPins(client: PoolClient, batchId: string) {
  const pins = await client.query<{ evidence_id: string; approval_id: string }>(
    `SELECT DISTINCT v.evidence_id, p.approval_id FROM public.media_approval_pin p
     JOIN public.media_version v ON v.id=p.version_id AND v.batch_id=p.batch_id
     WHERE p.batch_id=$1`,
    [batchId],
  )
  // Only a deployment that approved media holds pins, and it can read its runs.
  if (!pins.rows.length) {
    return new Map<string, { approval_id: string; approved_at: string }>()
  }
  const approvals = await client.query<{ approval_id: string; approved_at: Date }>(
    `SELECT r.approval_id, c.created_at AS approved_at FROM public.executor_run r
     JOIN public.command c ON c.id=r.command_id WHERE r.approval_id = ANY($1::uuid[])`,
    [[...new Set(pins.rows.map((row) => row.approval_id))]],
  )
  const approvedAt = new Map(approvals.rows.map((row) => [row.approval_id, row.approved_at]))
  // A pin is written in its approval's transaction, beside the run that names the approval.
  if (approvedAt.size !== new Set(pins.rows.map((row) => row.approval_id)).size) {
    throw new Error('media_pin_without_run')
  }
  const byEvidence = new Map<string, { approval_id: string; approved_at: string }>()
  // The earliest approval names the item; any one of them refuses the removal.
  const ordered = [...pins.rows].sort(
    (left, right) =>
      approvedAt.get(left.approval_id)!.getTime() - approvedAt.get(right.approval_id)!.getTime(),
  )
  for (const row of ordered) {
    if (!byEvidence.has(row.evidence_id)) {
      byEvidence.set(row.evidence_id, {
        approval_id: row.approval_id,
        approved_at: approvedAt.get(row.approval_id)!.toISOString(),
      })
    }
  }
  return byEvidence
}

/**
 * Authorization precedes relational reads; schema validation checks the complete projection.
 * Every evidence consumer reads this, so removed items are already left out of `evidence`.
 */
export async function mediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
): Promise<MediaSnapshotDto> {
  return (await authorizedMediaSnapshot(client, binding, batchId)).snapshot
}

async function authorizedMediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
) {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId)
  const snapshot = await enrichMediaNotes(
    client,
    projectMediaSnapshot(batchId, await readMediaRows(client, batchId)),
  )
  validate('MediaSnapshot', snapshot)
  return { snapshot, capture: capture.snapshot }
}

/**
 * The operator's snapshot: each item also says which approval used it and what removing it
 * would change, for the delete dialog and its refusal state.
 */
export async function operatorMediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
): Promise<MediaSnapshotDto> {
  const { snapshot: projected, capture } = await authorizedMediaSnapshot(client, binding, batchId)
  const pins = await approvalPins(client, batchId)
  const context = await loadReviewContext(client, batchId)
  const impacts = removalImpacts({
    capture,
    predecessors: context.predecessors,
    evidence: projected.evidence,
    attachments: projected.attachments,
  })
  const snapshot = {
    ...projected,
    evidence: projected.evidence.map((item) => {
      const pinnedBy = pins.get(item.id)
      return { ...item, ...(pinnedBy ? { pinned_by: pinnedBy } : {}), ...impacts.get(item.id) }
    }),
  }
  validate('MediaSnapshot', snapshot)
  return snapshot
}

/**
 * What removing these present items together would change: a bulk delete can leave a lot without
 * evidence that no single item's own impact names.
 */
export async function mediaRemovalImpact(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  evidenceIds: readonly string[],
): Promise<MediaRemovalImpactDto> {
  const { snapshot, capture } = await authorizedMediaSnapshot(client, binding, batchId)
  const present = new Set(snapshot.evidence.map((item) => item.id))
  const removed = new Set(snapshot.removed?.map((item) => item.id) ?? [])
  if (evidenceIds.some((id) => removed.has(id))) {
    fail('media_evidence_removed', 409)
  }
  if (evidenceIds.some((id) => !present.has(id))) {
    fail('not_found', 404)
  }
  const context = await loadReviewContext(client, batchId)
  const impact = combinedRemovalImpact(
    {
      capture,
      predecessors: context.predecessors,
      evidence: snapshot.evidence,
      attachments: snapshot.attachments,
    },
    new Set(evidenceIds),
  )
  const result = { evidence_ids: [...evidenceIds].sort(), ...impact }
  validate('MediaRemovalImpact', result)
  return result
}

/** First decoded original page for an already scoped batch, inside the caller's read transaction. */
/** A batch's evidence files by what their original holds: photos, documents and anything else. */
export async function inboxEvidenceCounts(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ mediaType: mediaVersions.mediaType })
      .from(mediaEvidence)
      .innerJoin(
        mediaVersions,
        and(eq(mediaVersions.evidenceId, mediaEvidence.id), eq(mediaVersions.kind, 'original')),
      )
      .where(
        and(
          eq(mediaEvidence.batchId, batchId),
          sql.raw(`NOT ${versionRemovedSql('media_version')}`),
        ),
      ),
  )
  const photos = rows.filter((row) => row.mediaType.startsWith('image/')).length
  const documents = rows.filter((row) => row.mediaType === 'application/pdf').length
  return { photos, documents, other: rows.length - photos - documents }
}

export async function inboxThumbnail(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ preview_id: mediaPreviews.id, label: mediaEvidence.label })
      .from(mediaEvidence)
      .innerJoin(
        mediaVersions,
        and(eq(mediaVersions.evidenceId, mediaEvidence.id), eq(mediaVersions.kind, 'original')),
      )
      .innerJoin(mediaPreviews, eq(mediaPreviews.versionId, mediaVersions.id))
      .innerJoin(
        mediaDecodeResults,
        and(
          eq(mediaDecodeResults.commandId, mediaPreviews.commandId),
          eq(mediaDecodeResults.state, 'ready'),
        ),
      )
      .where(
        and(
          eq(mediaEvidence.batchId, batchId),
          sql.raw(`NOT ${versionRemovedSql('media_version')}`),
        ),
      )
      .orderBy(mediaEvidence.createdAt, mediaEvidence.id, mediaPreviews.page, mediaPreviews.id)
      .limit(1),
  )
  return rows[0] ?? null
}
