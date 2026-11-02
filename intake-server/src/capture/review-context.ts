import type { PoolClient } from 'pg'

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

interface LineageRow {
  predecessor_lot_id: string
  successor_lot_id: string
  action: 'split' | 'merge'
}

interface RetirementRow {
  lot_id: string
  revision: string
}

interface DispositionRow {
  id: string
  subject_id: string
  code: string
  dependency_digest: Buffer
  reason: string
  actor_id: string
  created_at: Date
}

function appendTo<V>(map: Map<string, V[]>, key: string, value: V) {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
  } else {
    map.set(key, [value])
  }
}

function retiredRecords(retirements: RetirementRow[], lineage: LineageRow[]): RetiredLotRecord[] {
  return retirements.map((retirement) => {
    const edges = lineage.filter((edge) => edge.predecessor_lot_id === retirement.lot_id)
    if (!edges.length) {
      throw new Error('capture_retirement_without_lineage')
    }
    return {
      lotId: retirement.lot_id,
      action: edges[0].action,
      revision: retirement.revision,
      successorLotIds: edges.map((edge) => edge.successor_lot_id).sort(),
    }
  })
}

export async function loadReviewContext(
  client: PoolClient,
  batchId: string,
): Promise<CaptureReviewContext> {
  const lineageResult = await client.query<LineageRow>(
    `SELECT predecessor_lot_id,successor_lot_id,action
FROM capture_lot_lineage
WHERE batch_id=$1
ORDER BY successor_lot_id,predecessor_lot_id`,
    [batchId],
  )
  const retirementResult = await client.query<RetirementRow>(
    'SELECT lot_id,revision FROM capture_lot_retirement WHERE batch_id=$1 ORDER BY lot_id',
    [batchId],
  )
  const dispositionResult = await client.query<DispositionRow>(
    `SELECT id,subject_id,code,dependency_digest,reason,actor_id,created_at
FROM capture_issue_disposition
WHERE batch_id=$1
ORDER BY subject_id,code,created_at DESC,id DESC`,
    [batchId],
  )

  const predecessors = new Map<string, string[]>()
  for (const edge of lineageResult.rows) {
    appendTo(predecessors, edge.successor_lot_id, edge.predecessor_lot_id)
  }
  const dispositions = new Map<string, IssueDispositionRecord[]>()
  for (const row of dispositionResult.rows) {
    appendTo(dispositions, row.subject_id, {
      id: row.id,
      subjectId: row.subject_id,
      code: row.code,
      dependencyDigest: row.dependency_digest.toString('hex'),
      reason: row.reason,
      actorId: row.actor_id,
      createdAt: row.created_at.toISOString(),
    })
  }
  return {
    retiredLotIds: new Set(retirementResult.rows.map((row) => row.lot_id)),
    retired: retiredRecords(retirementResult.rows, lineageResult.rows),
    predecessors,
    dispositions,
  }
}

interface InstructionRow {
  group_id: string | null
  version: string
  text: string
  actor_id: string
  created_at: Date
}

/** Latest instruction per batch (null group) and evidence group. */
export async function latestInstructions(
  client: PoolClient,
  batchId: string,
): Promise<InstructionRecord[]> {
  const result = await client.query<InstructionRow>(
    `SELECT DISTINCT ON (group_id) group_id,version,text,actor_id,created_at
FROM capture_instruction
WHERE batch_id=$1
ORDER BY group_id NULLS FIRST,version DESC`,
    [batchId],
  )
  return result.rows.map((row) => ({
    groupId: row.group_id,
    version: row.version,
    text: row.text,
    actorId: row.actor_id,
    createdAt: row.created_at.toISOString(),
  }))
}
