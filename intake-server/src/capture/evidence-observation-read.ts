import type { PoolClient } from 'pg'
import { asc, eq } from 'drizzle-orm'
import type { CaptureEvidenceObservationDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { captureEvidenceObservations, captureLotEvidenceObservations } from './schema.ts'

export interface EvidenceObservationRead {
  observations: CaptureEvidenceObservationDto[]
  /** Active members per lot, in observation order. */
  activeByLot: Map<string, string[]>
}

/** Evidence observations of a batch with their lot membership, for the capture snapshot. */
export async function readEvidenceObservations(
  client: PoolClient,
  batchId: string,
): Promise<EvidenceObservationRead> {
  const db = queryDatabase(client)
  const rows = await executeDatabaseQuery(
    db
      .select()
      .from(captureEvidenceObservations)
      .where(eq(captureEvidenceObservations.batchId, batchId))
      .orderBy(asc(captureEvidenceObservations.createdAt), asc(captureEvidenceObservations.id)),
  )
  const members = await executeDatabaseQuery(
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
    })),
  }
}
