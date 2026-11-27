import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import type { AgentSettingsDto, CaptureSnapshotDto, SealedMatchDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { createAttempt, type ProcessingConfig } from './attempts.ts'
import { supersedeJobAttempts } from './supersede.ts'
import { processingAttempts, processingJobs } from './schema.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail, mediaProfileId, type Stage } from './model.ts'
import { processingJobColumns, requireLotJob } from './state.ts'
import type { LockedMediaInputs } from '#/media/locked-inputs.ts'
import { isSessionProfile } from './session-policy.ts'
import type { SessionInputVersion } from './stage-policy.ts'
import { instructNewSession } from '#/agents/instructions.ts'

export { supersedeJobAttempts } from './supersede.ts'

export async function queueJob(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  media: LockedMediaInputs,
  pinnedProposalIds: readonly string[] = [],
  /** agent_writer reads Agent settings without the row lock it has no privilege for. */
  {
    lockSettings = true,
    settings,
    inputVersion,
    match,
  }: {
    lockSettings?: boolean
    /** Settings already read in this transaction, so several attempts seal the same read. */
    settings?: AgentSettingsDto
    /** A session attempt's input version: the batch's lead's, or the configuration's. */
    inputVersion?: SessionInputVersion
    /** A `/7` lot's Match outcome and stage mode; the stage's full mode when omitted. */
    match?: SealedMatchDto
  } = {},
) {
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
      .select(processingJobColumns)
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.batchId, snapshot.id),
          eq(processingJobs.subjectId, subjectId),
          eq(processingJobs.stage, stage),
        ),
      )
      .for('update'),
  )
  const priorJob = jobs[0] ? requireLotJob(jobs[0]) : undefined
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
    null,
    pinnedProposalIds,
    { lockSettings, settings, inputVersion, match },
  )
  if (priorJob) {
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(processingJobs)
        .set({
          currentAttemptId: attempt.attemptId,
          state: 'queued',
          revision: sql`${processingJobs.revision}+1`,
        })
        .where(eq(processingJobs.id, job.id)),
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
  // A session for a new or restarted job starts with the saved batch instructions.
  if (isSessionProfile(config.profileId ?? mediaProfileId)) {
    await instructNewSession(
      client,
      config,
      snapshot.id,
      job.id,
      priorJob ? attempt.attemptId : undefined,
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
  await checkJobPairCapacity(
    client,
    batchId,
    subjectIds.flatMap((subjectId) => stages.map((stage) => ({ subjectId, stage }))),
  )
}

/** Refuses when queueing every one of these subject stages would pass the batch's job limit. */
export async function checkJobPairCapacity(
  client: PoolClient,
  batchId: string,
  pairs: readonly { subjectId: string; stage: Stage }[],
) {
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ subjectId: processingJobs.subjectId, stage: processingJobs.stage })
      .from(processingJobs)
      .where(eq(processingJobs.batchId, batchId)),
  )
  if (jobsAfter(jobs, pairs) > MAX_JOBS_PER_BATCH) {
    fail('processing_capacity')
  }
}

/** How many jobs a batch holds once every one of these subject stages has one. */
export function jobsAfter(
  jobs: readonly { subjectId: string | null; stage: string }[],
  pairs: readonly { subjectId: string; stage: Stage }[],
) {
  const existing = new Set(jobs.map((job) => `${job.subjectId}:${job.stage}`))
  const fresh = new Set(
    pairs.map((pair) => `${pair.subjectId}:${pair.stage}`).filter((key) => !existing.has(key)),
  )
  return jobs.length + fresh.size
}
