import type { Pool, PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import {
  validate,
  type ProcessingStartDto,
  type ProcessingCancellationDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { processingAttempts, processingJobs } from './schema.ts'
import { appendEvent, idempotent } from '../db/authority.ts'
import { captureInTransaction, lockCaptureForInputs } from '../capture/repository.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob, supersedeJobAttempts } from './jobs.ts'
import { fail, stageOrder } from './model.ts'
import { commandScope, lockLane } from './scope.ts'
import { canCancelProcessingAttempt, lockProcessingAttempt, processingJobColumns } from './state.ts'

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
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    return idempotent(
      client,
      commandScope(config, 'processing_start', batchId, key),
      input,
      async () => {
        const capture = await lockCaptureForInputs(
          client,
          config,
          batchId,
          input.expected_capture_revision,
        )
        const retired = capture.snapshot.lots.filter(
          (lot) => lot.retired === true && input.subject_ids.includes(lot.id),
        )
        if (retired.length) {
          fail('subject_retired', 409)
        }
        const media = await reserveProcessingMedia(
          client,
          config,
          capture.snapshot,
          input.subject_ids,
        )
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
              reservedMediaFor(media, subjectId),
            )
            jobIds.push(attempt.jobId)
            attemptIds.push(attempt.attemptId)
            dependencies = [attempt.attemptId]
          }
        }
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
        return { batch_id: batchId, job_ids: jobIds, attempt_ids: attemptIds }
      },
    )
  })
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
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    return idempotent(
      client,
      commandScope(config, 'processing_cancel', `${batchId}:${jobId}`, key),
      input,
      async () => {
        const capture = await lockedSnapshot(client, config, batchId)
        await lockLane(client, config.actorId)
        const result = await executeDatabaseQuery(
          queryDatabase(client)
            .select(processingJobColumns)
            .from(processingJobs)
            .where(and(eq(processingJobs.batchId, batchId), eq(processingJobs.id, jobId)))
            .for('update'),
        )
        const job = result[0] ?? fail('not_found', 404)
        if (
          job.revision !== input.expected_revision ||
          job.current_attempt_id !== input.attempt_id
        ) {
          fail('stale_attempt', 412)
        }
        const locked = await lockProcessingAttempt(client, jobId, input.attempt_id)
        if (!canCancelProcessingAttempt(locked.job, locked.attempt, capture.snapshot.archived)) {
          fail('attempt_terminal')
        }
        await supersedeJobAttempts(client, jobId)
        await executeDatabaseQuery(
          queryDatabase(client)
            .update(processingAttempts)
            .set({ state: 'cancelled' })
            .where(eq(processingAttempts.id, input.attempt_id)),
        )
        await executeDatabaseQuery(
          queryDatabase(client)
            .update(processingJobs)
            .set({ state: 'cancelled', revision: sql`${processingJobs.revision}+1` })
            .where(eq(processingJobs.id, jobId)),
        )
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
        return { batch_id: batchId, job_ids: [jobId], attempt_ids: [input.attempt_id] }
      },
    )
  })
}

export { answerQuestion } from './answers.ts'
