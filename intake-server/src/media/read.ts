import { prepareMediaTransaction } from './transaction.ts'
import type { PoolClient } from 'pg'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { validate, type MediaSnapshotDto } from '@invimport/contracts'
import { captureInTransaction, type CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import {
  mediaAttachmentSelections,
  mediaBatches,
  mediaBlobs,
  mediaDecodeCommands,
  mediaDecodeResults,
  mediaDerivations,
  mediaEvidence,
  mediaGroups,
  mediaLinks,
  mediaMemberships,
  mediaPreviews,
  mediaVersions,
} from './schema.ts'
import { projectMediaSnapshot, type MediaRows } from './projection.ts'

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
  const groups = await executeDatabaseQuery(
    db
      .select({ id: mediaGroups.id, label: mediaGroups.label })
      .from(mediaGroups)
      .where(eq(mediaGroups.batchId, batchId))
      .orderBy(asc(mediaGroups.id)),
  )
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
  return {
    revision: revision[0]?.revision ?? '1',
    evidence,
    versions,
    previews,
    groups,
    membership,
    links,
    attachments,
    derivations,
  }
}

/** Authorization precedes relational reads; schema validation checks the complete projection. */
export async function mediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
): Promise<MediaSnapshotDto> {
  await prepareMediaTransaction(client)
  await captureInTransaction(client, binding, batchId)
  const snapshot = projectMediaSnapshot(batchId, await readMediaRows(client, batchId))
  validate('MediaSnapshot', snapshot)
  return snapshot
}
