import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { supersedeJobAttempts } from './jobs.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail } from './model.ts'
import { lockProcessingAttempt } from './state.ts'
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
    const dependents = await client.query<{ id: string; job_id: string }>(
      `SELECT attempt.id,attempt.job_id
       FROM processing_dependency dependency
       JOIN processing_attempt attempt ON attempt.id=dependency.attempt_id
       JOIN processing_job job ON job.current_attempt_id=attempt.id
       WHERE dependency.dependency_attempt_id=$1 AND job.batch_id=$2
       ORDER BY job.id`,
      [completedParent, snapshot.id],
    )

    for (const dependent of dependents.rows) {
      if (replacements.has(dependent.id)) {
        continue
      }
      if (replacements.size > MAX_JOBS_PER_BATCH) {
        fail('processing_dependency_cycle')
      }

      const { job, attempt } = await lockProcessingAttempt(client, dependent.job_id, dependent.id)
      const dependencyRows = await client.query<{ dependency_attempt_id: string }>(
        'SELECT dependency_attempt_id FROM processing_dependency WHERE attempt_id=$1 ORDER BY dependency_attempt_id',
        [attempt.id],
      )
      const dependencies = dependencyRows.rows.map(
        (dependency) =>
          replacements.get(dependency.dependency_attempt_id) ?? dependency.dependency_attempt_id,
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
      await client.query(
        "UPDATE processing_job SET current_attempt_id=$2,state='queued',revision=revision+1 WHERE id=$1",
        [job.id, continuation.attemptId],
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
