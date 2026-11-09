import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { MediaSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { mediaEvidenceNotes, mediaEvidenceRemovals, mediaVersions } from './schema.ts'

/**
 * SQL that is true while the evidence item owning the `media_version` row aliased `alias` is
 * removed: its latest removal row says so. The alias is a fixed identifier, never input.
 */
export function versionRemovedSql(alias: string) {
  return `COALESCE((SELECT r.removed FROM public.media_evidence_removal r
    WHERE r.batch_id=${alias}.batch_id AND r.evidence_id=${alias}.evidence_id
    ORDER BY r.revision DESC LIMIT 1), false)`
}

export interface RemovalState {
  evidenceId: string
  removed: boolean
  revision: string
  createdAt: Date
}

/** Each item's latest removal row; items with none are present. */
export async function currentRemovals(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([mediaEvidenceRemovals.evidenceId], {
        evidenceId: mediaEvidenceRemovals.evidenceId,
        removed: mediaEvidenceRemovals.removed,
        revision: mediaEvidenceRemovals.revision,
        createdAt: mediaEvidenceRemovals.createdAt,
      })
      .from(mediaEvidenceRemovals)
      .where(eq(mediaEvidenceRemovals.batchId, batchId))
      .orderBy(asc(mediaEvidenceRemovals.evidenceId), desc(mediaEvidenceRemovals.revision)),
  )
  return new Map<string, RemovalState>(rows.map((row) => [row.evidenceId, row]))
}

export async function removedEvidenceIds(client: PoolClient, batchId: string) {
  const states = await currentRemovals(client, batchId)
  return new Set([...states.values()].filter((state) => state.removed).map((s) => s.evidenceId))
}

/** Refuses an edit that acts on a removed item until it is restored. */
export async function requirePresentEvidence(
  client: PoolClient,
  batchId: string,
  evidenceIds: readonly string[],
) {
  const removed = await removedEvidenceIds(client, batchId)
  if (evidenceIds.some((id) => removed.has(id))) {
    fail('media_evidence_removed', 409)
  }
}

/** Refuses a version whose evidence item is removed; an unknown version is left to the caller. */
export async function requirePresentVersion(
  client: PoolClient,
  batchId: string,
  versionId: string,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ evidenceId: mediaVersions.evidenceId })
      .from(mediaVersions)
      .where(and(eq(mediaVersions.batchId, batchId), eq(mediaVersions.id, versionId))),
  )
  if (rows[0]) {
    await requirePresentEvidence(client, batchId, [rows[0].evidenceId])
  }
}

/** Versions of the batch whose evidence item is removed now. */
export async function removedVersionIds(
  client: PoolClient,
  batchId: string,
  versionIds: readonly string[],
) {
  if (!versionIds.length) {
    return new Set<string>()
  }
  const removed = await removedEvidenceIds(client, batchId)
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: mediaVersions.id, evidenceId: mediaVersions.evidenceId })
      .from(mediaVersions)
      .where(and(eq(mediaVersions.batchId, batchId), inArray(mediaVersions.id, [...versionIds]))),
  )
  return new Set(rows.filter((row) => removed.has(row.evidenceId)).map((row) => row.id))
}

export async function retainRemoval(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  evidenceId: string,
  removed: boolean,
) {
  await executeDatabaseQuery(
    queryDatabase(client).insert(mediaEvidenceRemovals).values({
      id: randomUUID(),
      batchId,
      evidenceId,
      revision,
      actorId: binding.actorId,
      removed,
    }),
  )
}

/** Current attachment selections that name one of these versions. */
export function selectionsOfVersions(
  attachments: readonly MediaSnapshotDto['attachments'][number][],
  versionIds: ReadonlySet<string>,
) {
  return attachments.filter(
    (selection) =>
      selection.mode === 'selected' &&
      selection.version_id !== null &&
      versionIds.has(selection.version_id),
  )
}

/**
 * The batch's removed items and every version of their evidence notes, for inputs sealed before
 * a removal: neither may reach an agent.
 */
export async function removedEvidenceAndNotes(client: PoolClient, batchId: string) {
  const evidence = await removedEvidenceIds(client, batchId)
  if (!evidence.size) {
    return { evidence, notes: new Set<string>() }
  }
  const notes = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: mediaEvidenceNotes.id })
      .from(mediaEvidenceNotes)
      .where(
        and(
          eq(mediaEvidenceNotes.batchId, batchId),
          inArray(mediaEvidenceNotes.evidenceId, [...evidence]),
        ),
      ),
  )
  return { evidence, notes: new Set(notes.map((row) => row.id)) }
}
