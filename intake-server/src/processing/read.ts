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
  type ProcessingBlockerDto,
} from '@invimport/contracts'
import { commands } from '../db/schema.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { ProcessingConfig } from './attempts.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { processingDependencyStatus } from './dependencies.ts'
import {
  readProcessingMediaScopes,
  processingMediaFor,
  type ProcessingMediaAvailability,
} from './media.ts'
import { decodeProcessingInput, fail } from './model.ts'
import {
  MAX_JOB_RESULTS,
  MAX_JOBS_PER_BATCH,
  MAX_PROCESSING_SNAPSHOT_BYTES,
  MIN_CHANNEL_SECRET_BYTES,
  MAX_ACTIVITY_BATCHES,
} from './limits.ts'
import { retainedQuestionSpec, retainedProposalValue } from './retained.ts'
import { canCancelProcessingAttempt } from './state.ts'
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
  commandId: processingAttempts.commandId,
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

interface InputCurrency {
  current: boolean
  blockedCode?: ProcessingBlockerDto
}

async function inputCurrency(
  client: PoolClient,
  config: ProcessingConfig,
  job: SelectedJob,
  capture: CaptureSnapshotDto,
  media: ProcessingMediaAvailability,
): Promise<InputCurrency> {
  const authority = await loadProcessingAuthority(client, config, job.attemptId)
  const manifest = authority.manifest
  const dependencies = await processingDependencyStatus(client, config, authority)
  if (!media.available) {
    return { current: false, blockedCode: media.blockedCode }
  }
  const current =
    job.currentAttemptId === job.attemptId &&
    !capture.archived &&
    dependencies.current &&
    (job.attemptState === 'queued' || dependencies.ready) &&
    processingInputIsCurrent(manifest, capture, media.inputs)
  const legacyQueued =
    manifest.schema_version === 'bench-intake-input/1' && job.attemptState === 'queued'
  return legacyQueued ? { current, blockedCode: 'worker_version_conflict' } : { current }
}

function currentJobState(job: SelectedJob, currency: InputCurrency): ProcessingStateDto {
  return currency.current ? job.state : 'superseded'
}

async function proposalsForJob(
  client: PoolClient,
  job: SelectedJob,
): Promise<ProcessingJobDto['proposals']> {
  const manifest = decodeProcessingInput(job.inputBytes, job.inputDigest)
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
    value: retainedProposalValue(proposal, job.subjectId, manifest),
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
  const media = await readProcessingMediaScopes(
    client,
    config,
    capture,
    retainedJobs.map((job) => job.subjectId),
  )
  const jobs: ProcessingJobDto[] = []
  for (const job of retainedJobs) {
    const currency = await inputCurrency(
      client,
      config,
      job,
      capture,
      processingMediaFor(media, job.subjectId),
    )
    const state = currentJobState(job, currency)
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
      can_cancel: canCancelProcessingAttempt(
        { current_attempt_id: job.currentAttemptId, state: job.state },
        { id: job.attemptId, state: job.attemptState },
        capture.archived,
      ),
      ...(currency.blockedCode ? { blocked_code: currency.blockedCode } : {}),
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
  currency: InputCurrency,
  occupiesLane: boolean,
): ProcessingActivityDto['jobs'][number] {
  return {
    batch_id: job.batchId,
    job_id: job.id,
    attempt_id: job.attemptId,
    state: occupiesLane ? job.attemptState : currentJobState(job, currency),
    input_current: currency.current,
    ...(currency.blockedCode ? { blocked_code: currency.blockedCode } : {}),
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
      const media = await readProcessingMediaScopes(client, config, capture.snapshot, [
        held.subjectId,
      ])
      const currency = await inputCurrency(
        client,
        config,
        held,
        capture.snapshot,
        processingMediaFor(media, held.subjectId),
      )
      jobs.push(activityJob(held, currency, true))
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
    const media = await readProcessingMediaScopes(
      client,
      config,
      capture.snapshot,
      retainedJobs.map((job) => job.subjectId),
    )
    for (const job of retainedJobs) {
      if (job.attemptId === heldAttemptId) {
        continue
      }
      const currency = await inputCurrency(
        client,
        config,
        job,
        capture.snapshot,
        processingMediaFor(media, job.subjectId),
      )
      if (activeStates.has(currentJobState(job, currency))) {
        jobs.push(activityJob(job, currency, false))
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
