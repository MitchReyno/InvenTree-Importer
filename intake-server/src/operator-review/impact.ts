import type { PoolClient } from 'pg'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { manualPreparations, manualApprovals, manualPreparationLots } from '#/review/schema.ts'
import type { OperatorImpactDto } from '@invimport/contracts'
import { verifyBytes } from '#/db/authority.ts'
import type { BatchDependencies } from './review-state.ts'
import { subjectReviewState } from './review-state.ts'

/** The workspace lists at most this many unapproved preparations; impact uses the same window. */
const MAX_LISTED_PREPARATIONS = 20

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
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: manualPreparations.id,
        dependencyBytes: manualPreparations.dependencyBytes,
        dependencyDigest: manualPreparations.dependencyDigest,
      })
      .from(manualPreparations)
      .leftJoin(manualApprovals, eq(manualApprovals.preparationId, manualPreparations.id))
      .where(
        and(
          eq(manualPreparations.batchId, batchId),
          eq(manualPreparations.actorId, actorId),
          isNull(manualApprovals.id),
        ),
      )
      .orderBy(desc(manualPreparations.createdAt), desc(manualPreparations.id))
      .limit(MAX_LISTED_PREPARATIONS),
  )
  const preparations: PendingPreparation[] = []
  for (const row of result) {
    verifyBytes(row.dependencyBytes, row.dependencyDigest)
    const lots = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ lotId: manualPreparationLots.lotId })
        .from(manualPreparationLots)
        .where(eq(manualPreparationLots.preparationId, row.id))
        .orderBy(asc(manualPreparationLots.lotId)),
    )
    preparations.push({
      id: row.id,
      dependencyBytes: row.dependencyBytes,
      lotIds: lots.map((lot) => lot.lotId),
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
