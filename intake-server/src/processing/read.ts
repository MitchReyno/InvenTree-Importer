import type { PoolClient } from 'pg'
import { and, eq, getTableColumns, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { canonical } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingJobDto,
  type ProcessingSnapshotDto,
  type ProcessingStateDto,
  type ProcessingActivityDto,
} from '@invimport/contracts'
import { commands } from '../db/schema.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { ProcessingConfig } from './attempts.ts'
import { processingInputIsCurrent } from './authority.ts'
import { decodeProcessingInput, fail } from './model.ts'
import {
  MAX_JOB_RESULTS,
  MAX_JOBS_PER_BATCH,
  MAX_PROCESSING_SNAPSHOT_BYTES,
  MIN_CHANNEL_SECRET_BYTES,
  MAX_ACTIVITY_BATCHES,
} from './limits.ts'
import { retainedQuestionSpec, retainedProposalValue } from './retained.ts'
import {
  processingJobs,
  processingAttempts,
  processingInputs,
  processingProposals,
  processingQuestions,
  processingMessages,
  processingLanes,
} from './schema.ts'

const jobColumns = {
  id: processingJobs.id,
  batchId: processingJobs.batchId,
  subjectId: processingJobs.subjectId,
  stage: processingJobs.stage,
  revision: processingJobs.revision,
  state: processingJobs.state,
  currentAttemptId: processingJobs.currentAttemptId,
  attemptId: processingAttempts.id,
  attemptState: processingAttempts.state,
  attemptNumber: processingAttempts.number,
  inputBytes: processingInputs.manifestBytes,
  inputDigest: processingInputs.manifestDigest,
}

async function selectedJobs(client: PoolClient, batchId: string) {
  return drizzle(client)
    .select(jobColumns)
    .from(processingJobs)
    .innerJoin(
      processingAttempts,
      and(
        eq(processingAttempts.id, processingJobs.currentAttemptId),
        eq(processingAttempts.jobId, processingJobs.id),
      ),
    )
    .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
    .where(eq(processingJobs.batchId, batchId))
    .orderBy(processingJobs.subjectId, processingJobs.stage)
}

type SelectedJob = Awaited<ReturnType<typeof selectedJobs>>[number]

function inputIsCurrent(job: SelectedJob, capture: CaptureSnapshotDto) {
  const manifest = decodeProcessingInput(job.inputBytes, job.inputDigest)
  return (
    job.currentAttemptId === job.attemptId &&
    !capture.archived &&
    processingInputIsCurrent(manifest, capture)
  )
}

function currentJobState(job: SelectedJob, capture: CaptureSnapshotDto): ProcessingStateDto {
  return inputIsCurrent(job, capture) ? job.state : 'superseded'
}

async function proposalsForJob(
  client: PoolClient,
  job: SelectedJob,
): Promise<ProcessingJobDto['proposals']> {
  const proposals = await drizzle(client)
    .select({
      ...getTableColumns(processingProposals),
      jobId: processingAttempts.jobId,
      commandId: processingAttempts.commandId,
      manifestDigest: processingInputs.manifestDigest,
      envelopeBytes: processingMessages.envelopeBytes,
      envelopeDigest: processingMessages.envelopeDigest,
      disposition: processingMessages.disposition,
    })
    .from(processingProposals)
    .innerJoin(processingAttempts, eq(processingAttempts.id, processingProposals.attemptId))
    .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
    .innerJoin(processingMessages, eq(processingMessages.id, processingProposals.messageId))
    .where(eq(processingProposals.attemptId, job.attemptId))
    .orderBy(processingProposals.id)
    .limit(MAX_JOB_RESULTS + 1)
  if (proposals.length > MAX_JOB_RESULTS) {
    fail('processing_capacity')
  }
  return proposals.map((proposal) => ({
    id: proposal.id,
    message_id: proposal.messageId,
    value: retainedProposalValue(proposal, job.subjectId),
  }))
}

async function questionsForJob(
  client: PoolClient,
  job: SelectedJob,
  currentState: ProcessingStateDto,
): Promise<ProcessingJobDto['questions']> {
  const questions = await drizzle(client)
    .select({
      ...getTableColumns(processingQuestions),
      commandId: processingAttempts.commandId,
      manifestDigest: processingInputs.manifestDigest,
      envelopeBytes: processingMessages.envelopeBytes,
      envelopeDigest: processingMessages.envelopeDigest,
      disposition: processingMessages.disposition,
    })
    .from(processingQuestions)
    .innerJoin(processingAttempts, eq(processingAttempts.id, processingQuestions.attemptId))
    .innerJoin(processingInputs, eq(processingInputs.id, processingQuestions.inputId))
    .innerJoin(processingMessages, eq(processingMessages.id, processingQuestions.messageId))
    .where(eq(processingQuestions.jobId, job.id))
    .orderBy(processingQuestions.id)
    .limit(MAX_JOB_RESULTS + 1)
  if (questions.length > MAX_JOB_RESULTS) {
    fail('processing_capacity')
  }
  return questions.map((question) => {
    const staleOpenQuestion =
      question.state === 'open' &&
      (currentState === 'superseded' || question.attemptId !== job.attemptId)
    return {
      id: question.id,
      job_id: question.jobId,
      attempt_id: question.attemptId,
      input_sha256: question.manifestDigest.toString('hex'),
      revision: question.revision.toString(),
      state: staleOpenQuestion ? 'superseded' : question.state,
      spec: retainedQuestionSpec(question, job.subjectId),
    }
  })
}

/** Caller owns the same repeatable-read transaction as capture authorization and stream cursor. */
export async function processingSnapshot(
  client: PoolClient,
  config: ProcessingConfig,
  capture: CaptureSnapshotDto,
): Promise<ProcessingSnapshotDto> {
  const retainedJobs = await selectedJobs(client, capture.id)
  const jobs: ProcessingJobDto[] = []
  for (const job of retainedJobs) {
    const state = currentJobState(job, capture)
    const proposals = await proposalsForJob(client, job)
    const questions = await questionsForJob(client, job, state)
    jobs.push({
      id: job.id,
      subject_id: job.subjectId,
      stage: job.stage,
      revision: job.revision.toString(),
      state,
      attempt_id: job.attemptId,
      input_sha256: job.inputDigest.toString('hex'),
      attempt_number: job.attemptNumber.toString(),
      qualification: 'fixture_only',
      proposals,
      questions,
    })
  }
  const configured = Buffer.byteLength(config.channelSecret) >= MIN_CHANNEL_SECRET_BYTES
  const snapshot: ProcessingSnapshotDto = {
    runner_status: configured ? 'fixture_only' : 'unconfigured',
    batch_id: capture.id,
    capture_revision: capture.revision,
    jobs,
    cursor: capture.cursor,
  }
  validate('ProcessingSnapshot', snapshot)
  if (Buffer.byteLength(canonical(snapshot)) > MAX_PROCESSING_SNAPSHOT_BYTES) {
    fail('processing_capacity')
  }
  return snapshot
}

const activeStates = new Set<ProcessingStateDto>([
  'queued',
  'running',
  'waiting_for_user',
  'waiting_for_login',
  'waiting_for_capacity',
  'interrupted',
])

async function heldLaneJob(client: PoolClient, config: ProcessingConfig, attemptId: string) {
  const jobs = await drizzle(client)
    .select(jobColumns)
    .from(processingJobs)
    .innerJoin(processingAttempts, eq(processingAttempts.jobId, processingJobs.id))
    .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
    .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
    .where(
      and(
        eq(processingAttempts.id, attemptId),
        eq(commands.actorId, config.actorId),
        eq(commands.targetId, config.targetId),
        eq(commands.targetContextId, config.targetContextId),
      ),
    )
  return jobs[0]
}

function activityJob(
  job: SelectedJob,
  capture: CaptureSnapshotDto,
  occupiesLane: boolean,
): ProcessingActivityDto['jobs'][number] {
  return {
    batch_id: job.batchId,
    job_id: job.id,
    attempt_id: job.attemptId,
    state: occupiesLane ? job.attemptState : currentJobState(job, capture),
    input_current: inputIsCurrent(job, capture),
    occupies_lane: occupiesLane,
  }
}

/** A stale dependency never implies that the observed worker or its account claim has stopped. */
export async function processingActivity(
  client: PoolClient,
  config: ProcessingConfig,
): Promise<ProcessingActivityDto> {
  const laneRows = await drizzle(client)
    .select({ attemptId: processingLanes.attemptId })
    .from(processingLanes)
    .where(eq(processingLanes.actorId, config.actorId))
  const heldAttemptId = laneRows[0]?.attemptId ?? null
  const jobs: ProcessingActivityDto['jobs'] = []

  // Put the held lane first so truncation never hides an account claim. A foreign target/context
  // contributes only the safe aggregate busy flag, never its batch or attempt identifiers.
  if (heldAttemptId) {
    const held = await heldLaneJob(client, config, heldAttemptId)
    if (held) {
      const capture = await captureInTransaction(client, config, held.batchId)
      jobs.push(activityJob(held, capture.snapshot, true))
    }
  }

  const batches = await drizzle(client)
    .selectDistinct({ batchId: processingJobs.batchId })
    .from(processingJobs)
    .innerJoin(processingAttempts, eq(processingAttempts.id, processingJobs.currentAttemptId))
    .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
    .where(
      and(
        inArray(processingJobs.state, [...activeStates]),
        eq(commands.actorId, config.actorId),
        eq(commands.targetId, config.targetId),
        eq(commands.targetContextId, config.targetContextId),
      ),
    )
    .orderBy(processingJobs.batchId)
    .limit(MAX_ACTIVITY_BATCHES + 1)
  let truncated = batches.length > MAX_ACTIVITY_BATCHES

  for (const batch of batches.slice(0, MAX_ACTIVITY_BATCHES)) {
    const capture = await captureInTransaction(client, config, batch.batchId)
    const retainedJobs = await selectedJobs(client, batch.batchId)
    for (const job of retainedJobs) {
      if (job.attemptId === heldAttemptId) {
        continue
      }
      if (activeStates.has(currentJobState(job, capture.snapshot))) {
        jobs.push(activityJob(job, capture.snapshot, false))
      }
    }
    if (jobs.length > MAX_JOBS_PER_BATCH) {
      truncated = true
      break
    }
  }

  const activity = {
    jobs: jobs.slice(0, MAX_JOBS_PER_BATCH),
    lane_occupied: heldAttemptId !== null,
    truncated,
  }
  validate('ProcessingActivity', activity)
  return activity
}
