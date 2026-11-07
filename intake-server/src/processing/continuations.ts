import type { PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { processingAttempts, processingDependencies, processingJobs } from './schema.ts'
import { supersedeJobAttempts } from './jobs.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail } from './model.ts'
import { lockProcessingAttempt, requireLotJob } from './state.ts'
import type { LockedMediaInputs } from '../media/locked-inputs.ts'
import { reservedMediaFor } from './media.ts'

/** Rebuild the retained downstream closure after an answer; old dependency IDs never redirect. */
export async function continueDependentJobs(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  originalAttemptId: string,
  continuationAttemptId: string,
  answerId: string,
  media: ReadonlyMap<string, LockedMediaInputs>,
) {
  const replacements = new Map([[originalAttemptId, continuationAttemptId]])
  const pending = [originalAttemptId]

  while (pending.length) {
    const completedParent = pending.shift()!
    const dependents = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: processingAttempts.id, jobId: processingAttempts.jobId })
        .from(processingDependencies)
        .innerJoin(processingAttempts, eq(processingAttempts.id, processingDependencies.attemptId))
        .innerJoin(processingJobs, eq(processingJobs.currentAttemptId, processingAttempts.id))
        .where(
          and(
            eq(processingDependencies.dependencyAttemptId, completedParent),
            eq(processingJobs.batchId, snapshot.id),
          ),
        )
        .orderBy(processingJobs.id),
    )

    for (const dependent of dependents) {
      if (replacements.has(dependent.id)) {
        continue
      }
      if (replacements.size > MAX_JOBS_PER_BATCH) {
        fail('processing_dependency_cycle')
      }

      const locked = await lockProcessingAttempt(client, dependent.jobId, dependent.id)
      const job = requireLotJob(locked.job)
      const attempt = locked.attempt
      const dependencyRows = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ dependencyAttemptId: processingDependencies.dependencyAttemptId })
          .from(processingDependencies)
          .where(eq(processingDependencies.attemptId, attempt.id))
          .orderBy(processingDependencies.dependencyAttemptId),
      )
      const dependencies = dependencyRows.map(
        (dependency) =>
          replacements.get(dependency.dependencyAttemptId) ?? dependency.dependencyAttemptId,
      )

      await supersedeJobAttempts(client, job.id)
      const attemptNumber = (BigInt(attempt.number) + 1n).toString()
      const continuation = await createAttempt(
        client,
        config,
        snapshot,
        job,
        attemptNumber,
        dependencies,
        reservedMediaFor(media, job.subject_id),
        attempt.input_id,
        answerId,
      )
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(processingJobs)
          .set({
            currentAttemptId: continuation.attemptId,
            state: 'queued',
            revision: sql`${processingJobs.revision}+1`,
          })
          .where(eq(processingJobs.id, job.id)),
      )

      replacements.set(attempt.id, continuation.attemptId)
      pending.push(attempt.id)
    }
  }
}

/** The capture batch lock serializes this graph before any Processing or media reservation lock. */
export async function continuationSubjectIds(
  client: PoolClient,
  batchId: string,
  originalAttemptId: string,
): Promise<string[]> {
  const closure = await client.query<{ subject_id: string }>(
    `WITH RECURSIVE affected(id, subject_id) AS (
       SELECT attempt.id, job.subject_id
       FROM processing_attempt attempt
       JOIN processing_job job ON job.id = attempt.job_id
       WHERE attempt.id = $1 AND job.batch_id = $2
       UNION
       SELECT attempt.id, job.subject_id
       FROM affected parent
       JOIN processing_dependency dependency ON dependency.dependency_attempt_id = parent.id
       JOIN processing_attempt attempt ON attempt.id = dependency.attempt_id
       JOIN processing_job job ON job.current_attempt_id = attempt.id
       WHERE job.batch_id = $2
     )
     SELECT DISTINCT subject_id FROM affected ORDER BY subject_id`,
    [originalAttemptId, batchId],
  )
  if (closure.rows.length === 0) {
    fail('attempt_not_found', 404)
  }
  if (closure.rows.length > MAX_JOBS_PER_BATCH) {
    fail('processing_capacity')
  }
  return closure.rows.map((row) => row.subject_id)
}
