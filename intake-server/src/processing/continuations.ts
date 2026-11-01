import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { supersedeJobAttempts } from './jobs.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail } from './model.ts'
import { lockProcessingAttempt } from './state.ts'

/** Rebuild the retained downstream closure after an answer; old dependency IDs never redirect. */
export async function continueDependentJobs(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  originalAttemptId: string,
  continuationAttemptId: string,
  answerId: string,
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
