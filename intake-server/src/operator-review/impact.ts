import type { PoolClient } from 'pg'
import type { OperatorImpactDto } from '@invimport/contracts'
import { verifyBytes } from '../db/authority.ts'
import type { BatchDependencies } from './review-state.ts'
import { subjectReviewState } from './review-state.ts'

/** The workspace lists at most this many unapproved preparations; impact uses the same window. */
const MAX_LISTED_PREPARATIONS = 20

interface PreparationRow {
  id: string
  dependency_bytes: Buffer
  dependency_digest: Buffer
}

export interface PendingPreparation {
  id: string
  dependencyBytes: Buffer
  lotIds: string[]
}

export async function pendingPreparations(
  client: PoolClient,
  batchId: string,
  actorId: string,
): Promise<PendingPreparation[]> {
  const result = await client.query<PreparationRow>(
    `SELECT p.id,p.dependency_bytes,p.dependency_digest
FROM manual_preparation p
LEFT JOIN manual_approval a ON a.preparation_id=p.id
WHERE p.batch_id=$1 AND p.actor_id=$2 AND a.id IS NULL
ORDER BY p.created_at DESC,p.id DESC
LIMIT $3`,
    [batchId, actorId, MAX_LISTED_PREPARATIONS],
  )
  const preparations: PendingPreparation[] = []
  for (const row of result.rows) {
    verifyBytes(row.dependency_bytes, row.dependency_digest)
    const lots = await client.query<{ lot_id: string }>(
      'SELECT lot_id FROM manual_preparation_lot WHERE preparation_id=$1 ORDER BY lot_id',
      [row.id],
    )
    preparations.push({
      id: row.id,
      dependencyBytes: row.dependency_bytes,
      lotIds: lots.rows.map((lot) => lot.lot_id),
    })
  }
  return preparations
}

export interface ImpactInput {
  before: BatchDependencies
  after: BatchDependencies
  reviews: ReadonlyMap<string, Buffer[]>
  /** Preparation → whether its exact selection bytes still match, before and after. */
  preparationsBefore: ReadonlyMap<string, boolean>
  preparationsAfter: ReadonlyMap<string, boolean>
  retiredLotIds: string[]
  createdLots: OperatorImpactDto['created_lots']
  createdPart: OperatorImpactDto['created_part']
}

function changedDigest(input: ImpactInput, subjectId: string) {
  const before = input.before.subjects.get(subjectId)
  const after = input.after.subjects.get(subjectId)
  return !before || !after || !before.digest.equals(after.digest)
}

/** Exact difference between committed facts and the same command applied in a savepoint. */
export function operatorImpact(input: ImpactInput): OperatorImpactDto {
  const invalidated = [...input.before.subjects.values()]
    .filter((subject) => subjectReviewState(input.reviews, subject) === 'reviewed')
    .filter((subject) => changedDigest(input, subject.subjectId))
    .map((subject) => subject.subjectId)
    .sort()
  const affectedLots = [...input.before.lots.keys()]
    .filter((lotId) => changedDigest(input, lotId))
    .sort()
  const partIds = new Set<string>()
  for (const { material } of input.before.lots.values()) {
    for (const subject of material.subjects) {
      if (!input.before.lots.has(subject.subjectId)) {
        partIds.add(subject.subjectId)
      }
    }
  }
  const affectedParts = [...partIds].filter((partId) => changedDigest(input, partId)).sort()
  const stalePreparations = [...input.preparationsBefore.entries()]
    .filter(([id, current]) => current && !input.preparationsAfter.get(id))
    .map(([id]) => id)
  return {
    invalidated_review_subject_ids: invalidated,
    affected_lot_ids: affectedLots,
    affected_part_ids: affectedParts,
    stale_preparation_ids: stalePreparations,
    retired_lot_ids: [...input.retiredLotIds].sort(),
    created_lots: input.createdLots,
    created_part: input.createdPart,
  }
}
