import type { PoolClient } from 'pg'
import { desc, eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import {
  captureInstructions,
  captureIssueDispositions,
  captureLotLineages,
  captureLotRetirements,
} from './schema.ts'

export interface IssueDispositionRecord {
  id: string
  subjectId: string
  code: string
  dependencyDigest: string
  reason: string
  actorId: string
  createdAt: string
}

export interface RetiredLotRecord {
  lotId: string
  action: 'split' | 'merge'
  revision: string
  successorLotIds: string[]
}

export interface InstructionRecord {
  id: string
  groupId: string | null
  version: string
  text: string
  actorId: string
  createdAt: string
}

/** Capture-owned review facts: lineage, retirement and recorded warning dispositions. */
export interface CaptureReviewContext {
  retiredLotIds: ReadonlySet<string>
  retired: RetiredLotRecord[]
  /** Successor lot → its direct predecessors, sorted. */
  predecessors: ReadonlyMap<string, string[]>
  /** Subject → dispositions, newest first. */
  dispositions: ReadonlyMap<string, IssueDispositionRecord[]>
}

export const EMPTY_REVIEW_CONTEXT: CaptureReviewContext = {
  retiredLotIds: new Set(),
  retired: [],
  predecessors: new Map(),
  dispositions: new Map(),
}

interface LineageEdge {
  predecessorLotId: string
  successorLotId: string
  action: 'split' | 'merge'
}

interface RetirementRecord {
  lotId: string
  revision: bigint
}

function appendTo<V>(map: Map<string, V[]>, key: string, value: V) {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
  } else {
    map.set(key, [value])
  }
}

function retiredRecords(
  retirements: RetirementRecord[],
  lineage: LineageEdge[],
): RetiredLotRecord[] {
  return retirements.map((retirement) => {
    const edges = lineage.filter((edge) => edge.predecessorLotId === retirement.lotId)
    if (!edges.length) {
      throw new Error('capture_retirement_without_lineage')
    }
    return {
      lotId: retirement.lotId,
      action: edges[0].action,
      revision: retirement.revision.toString(),
      successorLotIds: edges.map((edge) => edge.successorLotId).sort(),
    }
  })
}

export async function loadReviewContext(
  client: PoolClient,
  batchId: string,
): Promise<CaptureReviewContext> {
  const database = queryDatabase(client)
  const lineage = await executeDatabaseQuery(
    database
      .select({
        predecessorLotId: captureLotLineages.predecessorLotId,
        successorLotId: captureLotLineages.successorLotId,
        action: captureLotLineages.action,
      })
      .from(captureLotLineages)
      .where(eq(captureLotLineages.batchId, batchId))
      .orderBy(captureLotLineages.successorLotId, captureLotLineages.predecessorLotId),
  )
  const retirements = await executeDatabaseQuery(
    database
      .select({
        lotId: captureLotRetirements.lotId,
        revision: captureLotRetirements.revision,
      })
      .from(captureLotRetirements)
      .where(eq(captureLotRetirements.batchId, batchId))
      .orderBy(captureLotRetirements.lotId),
  )
  const dispositionRows = await executeDatabaseQuery(
    database
      .select({
        id: captureIssueDispositions.id,
        subjectId: captureIssueDispositions.subjectId,
        code: captureIssueDispositions.code,
        dependencyDigest: captureIssueDispositions.dependencyDigest,
        reason: captureIssueDispositions.reason,
        actorId: captureIssueDispositions.actorId,
        createdAt: captureIssueDispositions.createdAt,
      })
      .from(captureIssueDispositions)
      .where(eq(captureIssueDispositions.batchId, batchId))
      .orderBy(
        captureIssueDispositions.subjectId,
        captureIssueDispositions.code,
        desc(captureIssueDispositions.createdAt),
        desc(captureIssueDispositions.id),
      ),
  )

  const predecessors = new Map<string, string[]>()
  for (const edge of lineage) {
    appendTo(predecessors, edge.successorLotId, edge.predecessorLotId)
  }
  const dispositions = new Map<string, IssueDispositionRecord[]>()
  for (const row of dispositionRows) {
    appendTo(dispositions, row.subjectId, {
      id: row.id,
      subjectId: row.subjectId,
      code: row.code,
      dependencyDigest: row.dependencyDigest.toString('hex'),
      reason: row.reason,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    })
  }
  return {
    retiredLotIds: new Set(retirements.map((row) => row.lotId)),
    retired: retiredRecords(retirements, lineage),
    predecessors,
    dispositions,
  }
}

/** Latest instruction per batch (null group) and evidence group. */
export async function latestInstructions(
  client: PoolClient,
  batchId: string,
): Promise<InstructionRecord[]> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureInstructions.groupId], {
        id: captureInstructions.id,
        groupId: captureInstructions.groupId,
        version: captureInstructions.version,
        text: captureInstructions.text,
        actorId: captureInstructions.actorId,
        createdAt: captureInstructions.createdAt,
      })
      .from(captureInstructions)
      .where(eq(captureInstructions.batchId, batchId))
      .orderBy(
        sql`${captureInstructions.groupId} ASC NULLS FIRST`,
        desc(captureInstructions.version),
      ),
  )
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    version: row.version.toString(),
    text: row.text,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  }))
}
