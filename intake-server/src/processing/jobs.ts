import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail, type Stage } from './model.ts'
import type { ProcessingJobRow } from './state.ts'

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
  await client.query(
    `UPDATE processing_lane SET attempt_id=NULL WHERE attempt_id IN
     (SELECT id FROM processing_attempt WHERE job_id=$1)`,
    [jobId],
  )
}

export async function queueJob(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
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
    const attempts = await client.query<{ number: string; input_id: string }>(
      'SELECT number,input_id FROM processing_attempt WHERE id=$1',
      [priorJob.current_attempt_id],
    )
    parentInputId = attempts.rows[0].input_id
    attemptNumber = (BigInt(attempts.rows[0].number) + 1n).toString()
  }

  const attempt = await createAttempt(
    client,
    config,
    snapshot,
    job,
    attemptNumber,
    dependencies,
    parentInputId,
  )
  if (priorJob) {
    await client.query(
      "UPDATE processing_job SET current_attempt_id=$2,state='queued',revision=revision+1 WHERE id=$1",
      [job.id, attempt.attemptId],
    )
  } else {
    await client.query(
      `INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state)
       VALUES($1,$2,$3,$4,$5,'queued')`,
      [job.id, snapshot.id, subjectId, stage, attempt.attemptId],
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
  const jobs = await client.query<{ subject_id: string; stage: Stage }>(
    'SELECT subject_id,stage FROM processing_job WHERE batch_id=$1',
    [batchId],
  )
  let newJobs = 0
  for (const subjectId of subjectIds) {
    for (const stage of stages) {
      const exists = jobs.rows.some((job) => job.subject_id === subjectId && job.stage === stage)
      if (!exists) {
        newJobs += 1
      }
    }
  }

  if (jobs.rows.length + newJobs > MAX_JOBS_PER_BATCH) {
    fail('processing_capacity')
  }
}
