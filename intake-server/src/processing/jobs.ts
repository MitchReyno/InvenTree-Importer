import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { eq } from 'drizzle-orm'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { processingAttempts, processingJobs } from './schema.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail, type Stage } from './model.ts'
import type { ProcessingJobRow } from './state.ts'
import type { LockedMediaInputs } from '../media/locked-inputs.ts'

/** Caller holds the actor lane and selected job lock before invalidating attempts/questions. */
export async function supersedeJobAttempts(client: PoolClient, jobId: string) {
  await client.query(
    `UPDATE processing_attempt SET state='superseded'
     WHERE job_id=$1 AND state IN (
       'queued','running','waiting_for_user','waiting_for_login','waiting_for_capacity','interrupted')`,
    [jobId],
  )
  await client.query(
    `UPDATE processing_question SET state='superseded',revision=revision+1
     WHERE job_id=$1 AND state='open'`,
    [jobId],
  )
  // Logical supersession does not prove that a held worker command ended.
}

export async function queueJob(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  media: LockedMediaInputs,
) {
  const jobs = await client.query<ProcessingJobRow>(
    'SELECT * FROM processing_job WHERE batch_id=$1 AND subject_id=$2 AND stage=$3 FOR UPDATE',
    [snapshot.id, subjectId, stage],
  )
  const priorJob = jobs.rows[0]
  const job = priorJob ?? { id: randomUUID(), subject_id: subjectId, stage }
  let parentInputId: string | null = null
  let attemptNumber = '1'

  if (priorJob) {
    await supersedeJobAttempts(client, job.id)
    const attempts = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          number: processingAttempts.number,
          inputId: processingAttempts.inputId,
        })
        .from(processingAttempts)
        .where(eq(processingAttempts.id, priorJob.current_attempt_id)),
    )
    const priorAttempt = attempts[0]
    parentInputId = priorAttempt.inputId
    attemptNumber = (priorAttempt.number + 1n).toString()
  }

  const attempt = await createAttempt(
    client,
    config,
    snapshot,
    job,
    attemptNumber,
    dependencies,
    media,
    parentInputId,
  )
  if (priorJob) {
    await client.query(
      "UPDATE processing_job SET current_attempt_id=$2,state='queued',revision=revision+1 WHERE id=$1",
      [job.id, attempt.attemptId],
    )
  } else {
    await executeDatabaseQuery(
      queryDatabase(client).insert(processingJobs).values({
        id: job.id,
        batchId: snapshot.id,
        subjectId,
        stage,
        currentAttemptId: attempt.attemptId,
        state: 'queued',
      }),
    )
  }

  return { jobId: job.id, attemptId: attempt.attemptId }
}

export async function checkJobCapacity(
  client: PoolClient,
  batchId: string,
  subjectIds: string[],
  stages: Stage[],
) {
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ subjectId: processingJobs.subjectId, stage: processingJobs.stage })
      .from(processingJobs)
      .where(eq(processingJobs.batchId, batchId)),
  )
  let newJobs = 0
  for (const subjectId of subjectIds) {
    for (const stage of stages) {
      const exists = jobs.some((job) => job.subjectId === subjectId && job.stage === stage)
      if (!exists) {
        newJobs += 1
      }
    }
  }

  if (jobs.length + newJobs > MAX_JOBS_PER_BATCH) {
    fail('processing_capacity')
  }
}
