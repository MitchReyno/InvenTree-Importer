import type { PoolClient } from 'pg'
import { eq } from 'drizzle-orm'
import type { ProcessingStateDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { fail, type Stage } from './model.ts'
import { processingAttempts } from './schema.ts'

type State = ProcessingStateDto

const cancellableStates = new Set<State>([
  'queued',
  'running',
  'waiting_for_user',
  'waiting_for_login',
  'waiting_for_capacity',
  'interrupted',
])

/** Shared action projection and mutation policy; expected revision remains a separate authority check. */
export function canCancelProcessingAttempt(
  job: { current_attempt_id: string; state: State },
  attempt: { id: string; state: State },
  archived: boolean,
): boolean {
  return (
    !archived &&
    job.current_attempt_id === attempt.id &&
    cancellableStates.has(job.state) &&
    cancellableStates.has(attempt.state)
  )
}

export interface ProcessingJobRow {
  id: string
  batch_id: string
  subject_id: string
  stage: Stage
  revision: string
  current_attempt_id: string
  state: State
}

export interface ProcessingAttemptRow {
  id: string
  batch_id: string
  job_id: string
  number: string
  input_id: string
  command_id: string
  state: State
  last_sequence: string
}

/** Caller already owns batch and actor lane locks. Jobs precede attempts and questions. */
export async function lockProcessingAttempt(client: PoolClient, jobId: string, attemptId: string) {
  const jobs = await client.query<ProcessingJobRow>(
    'SELECT * FROM processing_job WHERE id=$1 FOR UPDATE',
    [jobId],
  )
  const job = jobs.rows[0] ?? fail('job_not_found', 404)

  const attempts = await client.query<ProcessingAttemptRow>(
    'SELECT * FROM processing_attempt WHERE job_id=$1 AND id=$2 FOR UPDATE',
    [jobId, attemptId],
  )
  const attempt = attempts.rows[0] ?? fail('attempt_not_found', 404)

  return { job, attempt }
}

/** Update only the selected projection. Old attempts never redirect current job state. */
export async function transitionAttempt(
  client: PoolClient,
  job: ProcessingJobRow,
  attempt: ProcessingAttemptRow,
  state: State,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingAttempts)
      .set({ state })
      .where(eq(processingAttempts.id, attempt.id)),
  )

  if (job.current_attempt_id === attempt.id) {
    await client.query('UPDATE processing_job SET state=$2,revision=revision+1 WHERE id=$1', [
      job.id,
      state,
    ])
  }

  if (state !== 'running') {
    await releaseProcessingLane(client, attempt.id)
  }
}

/** Exact-attempt compare prevents old settlement from releasing a newer claim. */
export async function releaseProcessingLane(client: PoolClient, attemptId: string): Promise<void> {
  await client.query('UPDATE processing_lane SET attempt_id=NULL WHERE attempt_id=$1', [attemptId])
}
