import type { PoolClient } from 'pg'
import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { manualReviews } from '#/review/schema.ts'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { verifyBytes } from '#/db/authority.ts'
import type { ManualConfig } from '#/review/authority.ts'
import { materializeWithMedia } from '#/review/media-material.ts'
import type { ManualMaterial, SubjectDependency } from '#/review/model.ts'
import type { CaptureReviewContext } from '#/capture/review-context.ts'

export type ReviewState = 'unreviewed' | 'reviewed' | 'changed_after_review'

/** Each active lot's own closure: the lot and its shared Part proposal. */
export interface LotMaterial {
  lotId: string
  material: ManualMaterial
}

/** Exact dependency bytes of every active lot, keyed by lot and by subject. */
export interface BatchDependencies {
  lots: Map<string, LotMaterial>
  subjects: Map<string, SubjectDependency>
}

export async function batchDependencies(
  client: PoolClient,
  config: ManualConfig,
  snapshot: CaptureSnapshotDto,
  context: CaptureReviewContext,
): Promise<BatchDependencies> {
  const lots = new Map<string, LotMaterial>()
  const subjects = new Map<string, SubjectDependency>()
  for (const lot of snapshot.lots) {
    if (context.retiredLotIds.has(lot.id)) {
      continue
    }
    const material = await materializeWithMedia(client, config, snapshot, [lot.id], false)
    lots.set(lot.id, { lotId: lot.id, material })
    for (const subject of material.subjects) {
      subjects.set(subject.subjectId, subject)
    }
  }
  return { lots, subjects }
}

/** Subject → every retained review's exact dependency bytes. */
export async function retainedReviews(
  client: PoolClient,
  batchId: string,
): Promise<Map<string, Buffer[]>> {
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        subjectId: manualReviews.subjectId,
        dependencyBytes: manualReviews.dependencyBytes,
        dependencyDigest: manualReviews.dependencyDigest,
      })
      .from(manualReviews)
      .where(eq(manualReviews.batchId, batchId)),
  )
  const reviews = new Map<string, Buffer[]>()
  for (const row of result) {
    verifyBytes(row.dependencyBytes, row.dependencyDigest)
    const existing = reviews.get(row.subjectId) ?? []
    existing.push(row.dependencyBytes)
    reviews.set(row.subjectId, existing)
  }
  return reviews
}

/** Matches preparation: a review is current only when its exact bytes still match. */
export function subjectReviewState(
  reviews: ReadonlyMap<string, Buffer[]>,
  subject: SubjectDependency,
): ReviewState {
  const retained = reviews.get(subject.subjectId) ?? []
  if (retained.some((bytes) => bytes.equals(subject.bytes))) {
    return 'reviewed'
  }
  return retained.length ? 'changed_after_review' : 'unreviewed'
}

export function lotReviewState(
  reviews: ReadonlyMap<string, Buffer[]>,
  material: ManualMaterial,
): ReviewState {
  const states = material.subjects.map((subject) => subjectReviewState(reviews, subject))
  if (states.length && states.every((state) => state === 'reviewed')) {
    return 'reviewed'
  }
  if (states.includes('changed_after_review')) {
    return 'changed_after_review'
  }
  return 'unreviewed'
}
