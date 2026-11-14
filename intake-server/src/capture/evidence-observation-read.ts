import type { PoolClient } from 'pg'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { CaptureEvidenceObservationDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { captureEvidenceObservations, captureLotEvidenceObservations } from './schema.ts'
import { versionRemovedSql } from '#/media/removal.ts'

/** True while the observation's evidence item is removed; it then leaves the snapshot. */
const onRemovedEvidence = sql.raw(
  `EXISTS (SELECT 1 FROM public.media_version v
    WHERE v.id=capture_evidence_observation.evidence_version_id AND ${versionRemovedSql('v')})`,
)

export interface EvidenceObservationRead {
  observations: CaptureEvidenceObservationDto[]
  /** Active members per lot, in observation order. */
  activeByLot: Map<string, string[]>
}

/**
 * Evidence observations of a batch with their lot membership, for the capture snapshot. Those on
 * removed evidence are left out, so Review and its counts stop using them.
 */
export async function readEvidenceObservations(
  client: PoolClient,
  batchId: string,
): Promise<EvidenceObservationRead> {
  const db = queryDatabase(client)
  const rows = await executeDatabaseQuery(
    db
      .select()
      .from(captureEvidenceObservations)
      .where(and(eq(captureEvidenceObservations.batchId, batchId), sql`NOT ${onRemovedEvidence}`))
      .orderBy(asc(captureEvidenceObservations.createdAt), asc(captureEvidenceObservations.id)),
  )
  const visible = new Set(rows.map((row) => row.id))
  const allMembers = await executeDatabaseQuery(
    db
      .select({
        lotId: captureLotEvidenceObservations.lotId,
        observationId: captureLotEvidenceObservations.evidenceObservationId,
        status: captureLotEvidenceObservations.status,
      })
      .from(captureLotEvidenceObservations)
      .where(eq(captureLotEvidenceObservations.batchId, batchId))
      .orderBy(
        asc(captureLotEvidenceObservations.lotId),
        asc(captureLotEvidenceObservations.evidenceObservationId),
      ),
  )
  const members = allMembers.filter((member) => visible.has(member.observationId))
  const activeByLot = new Map<string, string[]>()
  const lotOf = new Map<string, string>()
  const suggested = new Map<string, string[]>()
  for (const member of members) {
    if (member.status === 'active') {
      lotOf.set(member.observationId, member.lotId)
      activeByLot.set(member.lotId, [
        ...(activeByLot.get(member.lotId) ?? []),
        member.observationId,
      ])
    } else {
      suggested.set(member.observationId, [
        ...(suggested.get(member.observationId) ?? []),
        member.lotId,
      ])
    }
  }

  // A mark counts only while both observations are active in the same lot.
  const sameItem = (row: (typeof rows)[number]) =>
    row.sameItemAs && lotOf.get(row.id) && lotOf.get(row.id) === lotOf.get(row.sameItemAs)
      ? { same_item_as: row.sameItemAs }
      : {}

  return {
    activeByLot,
    observations: rows.map((row) => ({
      id: row.id,
      evidence_version_id: row.evidenceVersionId,
      page: row.page,
      region: row.region as CaptureEvidenceObservationDto['region'],
      readings: row.readings as CaptureEvidenceObservationDto['readings'],
      visible_count: row.visibleCount,
      status: row.status,
      supersedes_observation_id: row.supersedesObservationId,
      origin: row.origin,
      agent_session_id: row.agentSessionId,
      operator_edited: row.operatorEdited,
      revision: row.revision.toString(),
      lot_id: lotOf.get(row.id) ?? null,
      suggested_lot_ids: suggested.get(row.id) ?? [],
      ...sameItem(row),
    })),
  }
}
