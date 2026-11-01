import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ProcessingStartDto,
  type ProcessingCancellationDto,
} from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { appendEvent, idempotent } from '../db/authority.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob, supersedeJobAttempts } from './jobs.ts'
import { fail, stageOrder } from './model.ts'
import { commandScope, lockLane } from './scope.ts'

async function lockedSnapshot(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  revision?: string,
) {
  const capture = await captureInTransaction(client, config, batchId, true)
  if (capture.snapshot.archived) {
    fail('batch_archived')
  }
  if (revision && capture.snapshot.revision !== revision) {
    fail('revision_conflict', 412)
  }
  return capture
}

export async function startProcessing(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  key: string,
  input: ProcessingStartDto,
) {
  validate('ProcessingStart', input)
  return transaction(pool, (client) =>
    idempotent(client, commandScope(config, 'processing_start', batchId, key), input, async () => {
      const capture = await lockedSnapshot(client, config, batchId, input.expected_capture_revision)
      // Account then jobs is the common processing lock order for every state mutation.
      await lockLane(client, config.actorId)
      const jobIds: string[] = []
      const attemptIds: string[] = []
      const stages = stageOrder.filter((stage) => input.stages.includes(stage))
      await checkJobCapacity(client, batchId, input.subject_ids, stages)
      for (const subjectId of [...input.subject_ids].sort()) {
        let dependencies: string[] = []
        for (const stage of stages) {
          const attempt = await queueJob(
            client,
            config,
            capture.snapshot,
            subjectId,
            stage,
            dependencies,
          )
          jobIds.push(attempt.jobId)
          attemptIds.push(attempt.attemptId)
          dependencies = [attempt.attemptId]
        }
      }
      await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
      return { batch_id: batchId, job_ids: jobIds, attempt_ids: attemptIds }
    }),
  )
}

export async function cancelProcessing(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  jobId: string,
  key: string,
  input: ProcessingCancellationDto,
) {
  validate('ProcessingCancellation', input)
  return transaction(pool, (client) =>
    idempotent(
      client,
      commandScope(config, 'processing_cancel', `${batchId}:${jobId}`, key),
      input,
      async () => {
        const capture = await lockedSnapshot(client, config, batchId)
        await lockLane(client, config.actorId)
        const result = await client.query(
          'SELECT * FROM processing_job WHERE batch_id=$1 AND id=$2 FOR UPDATE',
          [batchId, jobId],
        )
        const job = result.rows[0] ?? fail('not_found', 404)
        if (
          job.revision !== input.expected_revision ||
          job.current_attempt_id !== input.attempt_id
        ) {
          fail('stale_attempt', 412)
        }
        if (
          ![
            'queued',
            'running',
            'waiting_for_user',
            'waiting_for_login',
            'waiting_for_capacity',
            'interrupted',
          ].includes(job.state)
        ) {
          fail('attempt_terminal')
        }
        await supersedeJobAttempts(client, jobId)
        await client.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
          input.attempt_id,
        ])
        await client.query(
          "UPDATE processing_job SET state='cancelled',revision=revision+1 WHERE id=$1",
          [jobId],
        )
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
        return { batch_id: batchId, job_ids: [jobId], attempt_ids: [input.attempt_id] }
      },
    ),
  )
}

export { answerQuestion } from './answers.ts'
