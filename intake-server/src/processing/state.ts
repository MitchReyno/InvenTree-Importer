import type { PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import type { ProcessingStateDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { fail, type Stage } from './model.ts'
import { processingAttempts, processingJobs, processingLanes } from './schema.ts'

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

export const processingJobColumns = {
  id: processingJobs.id,
  batch_id: processingJobs.batchId,
  subject_id: processingJobs.subjectId,
  stage: processingJobs.stage,
  revision: sql<string>`${processingJobs.revision}::text`,
  current_attempt_id: processingJobs.currentAttemptId,
  state: processingJobs.state,
}

const processingAttemptColumns = {
  id: processingAttempts.id,
  batch_id: processingAttempts.batchId,
  job_id: processingAttempts.jobId,
  number: sql<string>`${processingAttempts.number}::text`,
  input_id: processingAttempts.inputId,
  command_id: processingAttempts.commandId,
  state: processingAttempts.state,
  last_sequence: sql<string>`${processingAttempts.lastSequence}::text`,
}

/** Caller already owns batch and actor lane locks. Jobs precede attempts and questions. */
export async function lockProcessingAttempt(client: PoolClient, jobId: string, attemptId: string) {
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
      .select(processingJobColumns)
      .from(processingJobs)
      .where(eq(processingJobs.id, jobId))
      .for('update'),
  )
  const job = jobs[0] ?? fail('job_not_found', 404)

  const attempts = await executeDatabaseQuery(
    queryDatabase(client)
      .select(processingAttemptColumns)
      .from(processingAttempts)
      .where(and(eq(processingAttempts.jobId, jobId), eq(processingAttempts.id, attemptId)))
      .for('update'),
  )
  const attempt = attempts[0] ?? fail('attempt_not_found', 404)

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
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(processingJobs)
        .set({ state, revision: sql`${processingJobs.revision}+1` })
        .where(eq(processingJobs.id, job.id)),
    )
  }

  if (state !== 'running') {
    await releaseProcessingLane(client, attempt.id)
  }
}

/** Exact-attempt compare prevents old settlement from releasing a newer claim. */
export async function releaseProcessingLane(client: PoolClient, attemptId: string): Promise<void> {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingLanes)
      .set({ attemptId: null })
      .where(eq(processingLanes.attemptId, attemptId)),
  )
}
