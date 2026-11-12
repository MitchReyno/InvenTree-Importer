import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { MediaSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { evidenceRemoved, evidenceRestored } from '#/processing/currentness.ts'
import { activeMediaGroups } from './context.ts'
import {
  mediaAttachmentSelections,
  mediaEvidence,
  mediaMemberships,
  mediaVersions,
} from './schema.ts'
import { mediaSnapshot } from './read.ts'
import { currentRemovals, retainRemoval, selectionsOfVersions } from './removal.ts'

interface RemovalChange {
  batchId: string
  revision: string
  evidenceIds: readonly string[]
}

async function requireBatchEvidence(client: PoolClient, batchId: string, ids: readonly string[]) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: mediaEvidence.id })
      .from(mediaEvidence)
      .where(and(eq(mediaEvidence.batchId, batchId), inArray(mediaEvidence.id, [...ids]))),
  )
  if (rows.length !== ids.length) {
    fail('not_found', 404)
  }
}

/** An approval that used a version of the item keeps it as the record of what was added. */
async function requireUnpinned(client: PoolClient, batchId: string, ids: readonly string[]) {
  const pinned = await client.query(
    `SELECT 1 FROM public.media_approval_pin p
     JOIN public.media_version v ON v.id=p.version_id AND v.batch_id=p.batch_id
     WHERE p.batch_id=$1 AND v.evidence_id = ANY($2::uuid[]) LIMIT 1`,
    [batchId, [...ids]],
  )
  if (pinned.rowCount) {
    fail('media_removal_refused', 409)
  }
}

/** Lots the items feed, through subject links or active observations, before removal. */
function affectedLots(snapshot: MediaSnapshotDto, ids: ReadonlySet<string>, lotIds: Set<string>) {
  return [
    ...new Set(
      snapshot.evidence
        .filter((item) => ids.has(item.id))
        .flatMap((item) => item.linked_subject_ids.filter((subjectId) => lotIds.has(subjectId))),
    ),
  ].sort()
}

/**
 * Records the removal of present items, clears attachment selections of their versions, and
 * marks what relied on them stale. Bytes, history and notes stay; reads leave the items out.
 */
export async function removeEvidence(
  client: PoolClient,
  binding: CaptureBinding,
  lotIds: Set<string>,
  change: RemovalChange,
) {
  await requireBatchEvidence(client, change.batchId, change.evidenceIds)
  const states = await currentRemovals(client, change.batchId)
  if (change.evidenceIds.some((id) => states.get(id)?.removed === true)) {
    fail('media_evidence_removed', 409)
  }
  await requireUnpinned(client, change.batchId, change.evidenceIds)
  const before = await mediaSnapshot(client, binding, change.batchId)
  const ids = new Set(change.evidenceIds)
  const versionIds = new Set(
    before.evidence
      .filter((item) => ids.has(item.id))
      .flatMap((item) => item.versions.map((v) => v.id)),
  )
  for (const evidenceId of [...ids].sort()) {
    await retainRemoval(client, binding, change.batchId, change.revision, evidenceId, true)
  }
  // A new preparation must not silently drop a chosen attachment, so the choice is cleared.
  for (const selection of selectionsOfVersions(before.attachments, versionIds)) {
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(mediaAttachmentSelections)
        .values({
          id: randomUUID(),
          batchId: change.batchId,
          subjectId: selection.subject_id,
          subjectKind: selection.destination === 'part_attachment' ? 'part' : 'lot',
          mode: 'unset',
          versionId: null,
          destination: selection.destination,
          revision: change.revision,
          actorId: binding.actorId,
        }),
    )
  }
  await evidenceRemoved(client, {
    batchId: change.batchId,
    evidenceIds: [...ids].sort(),
    lotIds: affectedLots(before, ids, lotIds),
    revision: change.revision,
  })
}

/** The group an item was in, if it is still active; otherwise it returns ungrouped. */
async function restoreGrouping(client: PoolClient, binding: CaptureBinding, change: RemovalChange) {
  const active = new Set((await activeMediaGroups(client, change.batchId)).map((group) => group.id))
  const memberships = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([mediaMemberships.evidenceId], {
        evidenceId: mediaMemberships.evidenceId,
        groupId: mediaMemberships.groupId,
      })
      .from(mediaMemberships)
      .where(
        and(
          eq(mediaMemberships.batchId, change.batchId),
          inArray(mediaMemberships.evidenceId, [...change.evidenceIds]),
        ),
      )
      .orderBy(asc(mediaMemberships.evidenceId), desc(mediaMemberships.revision)),
  )
  for (const membership of memberships) {
    if (membership.groupId !== null && !active.has(membership.groupId)) {
      await executeDatabaseQuery(
        queryDatabase(client).insert(mediaMemberships).values({
          id: randomUUID(),
          batchId: change.batchId,
          evidenceId: membership.evidenceId,
          groupId: null,
          revision: change.revision,
          actorId: binding.actorId,
        }),
      )
    }
  }
}

/**
 * Restores removed items as a new event. Stale proposals stay stale; the Examine lead receives
 * each restored original as new evidence. A cleared attachment selection stays cleared.
 */
export async function restoreEvidence(
  client: PoolClient,
  binding: CaptureBinding,
  change: RemovalChange,
) {
  await requireBatchEvidence(client, change.batchId, change.evidenceIds)
  const states = await currentRemovals(client, change.batchId)
  if (change.evidenceIds.some((id) => states.get(id)?.removed !== true)) {
    fail('media_evidence_not_removed', 409)
  }
  for (const evidenceId of [...change.evidenceIds].sort()) {
    await retainRemoval(client, binding, change.batchId, change.revision, evidenceId, false)
  }
  await restoreGrouping(client, binding, change)
  const originals = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ evidenceId: mediaVersions.evidenceId, versionId: mediaVersions.id })
      .from(mediaVersions)
      .where(
        and(
          eq(mediaVersions.batchId, change.batchId),
          eq(mediaVersions.kind, 'original'),
          inArray(mediaVersions.evidenceId, [...change.evidenceIds]),
        ),
      )
      .orderBy(asc(mediaVersions.evidenceId), asc(mediaVersions.createdAt)),
  )
  await evidenceRestored(client, {
    batchId: change.batchId,
    versions: originals,
    revision: change.revision,
  })
}
