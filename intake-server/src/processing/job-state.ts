import type { PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import type {
  CaptureSnapshotDto,
  ProcessingBlockerDto,
  ProcessingStateDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import type { ProcessingConfig } from './attempts.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { processingDependencyStatus } from './dependencies.ts'
import {
  readProcessingMediaScopes,
  processingMediaFor,
  type ProcessingMediaAvailability,
} from './media.ts'
import { fail, mediaProfileId } from './model.ts'
import { decodeJobInput, isSessionInput } from './session-input.ts'
import { processingAttempts, processingInputs, processingJobs } from './schema.ts'

/**
 * Each job's state as the Processing read shows it: its stored state while its input is current,
 * superseded otherwise. The Processing read and a session's brief both read it from here.
 */

/** The job and current-attempt columns every job-state read selects. */
export const jobColumns = {
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

export async function selectedJobs(client: PoolClient, batchId: string) {
  return executeDatabaseQuery(
    queryDatabase(client)
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
      .orderBy(processingJobs.subjectId, processingJobs.stage),
  )
}

export type SelectedJob = Awaited<ReturnType<typeof selectedJobs>>[number]

export interface InputCurrency {
  current: boolean
  blockedCode?: ProcessingBlockerDto
}

/** The Examine lead job's media is the whole batch, pinned by its own manifest. */
const BATCH_SCOPED = { available: true as const, batchScoped: true as const }
export type JobMedia = ProcessingMediaAvailability | typeof BATCH_SCOPED

export const lotSubjects = (jobs: readonly SelectedJob[]) =>
  jobs.flatMap((job) => (job.subjectId === null ? [] : [job.subjectId]))

export function jobMedia(
  scopes: ReadonlyMap<string, ProcessingMediaAvailability>,
  job: SelectedJob,
): JobMedia {
  return job.subjectId === null ? BATCH_SCOPED : processingMediaFor(scopes, job.subjectId)
}

export async function inputCurrency(
  client: PoolClient,
  config: ProcessingConfig,
  job: SelectedJob,
  capture: CaptureSnapshotDto,
  media: JobMedia,
): Promise<InputCurrency> {
  const input = decodeJobInput(job.inputBytes, job.inputDigest)
  if (isSessionInput(input)) {
    // Per-proposal currentness replaces whole-input sealing for sessions (design D5).
    if (!media.available) {
      return { current: false, blockedCode: media.blockedCode }
    }
    const current = job.currentAttemptId === job.attemptId && !capture.archived
    const incompatibleQueued =
      job.attemptState === 'queued' &&
      input.profile_id !== String(config.profileId ?? mediaProfileId)
    return incompatibleQueued ? { current, blockedCode: 'worker_version_conflict' } : { current }
  }
  if ('batchScoped' in media) {
    fail('unsupported_processing_stage')
  }
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
    processingInputIsCurrent(manifest, capture, media.inputs, config.approvedSourceUrls)
  const selectedProfile = config.profileId ?? mediaProfileId
  const incompatibleQueued =
    job.attemptState === 'queued' && manifest.profile_id !== selectedProfile
  return incompatibleQueued ? { current, blockedCode: 'worker_version_conflict' } : { current }
}

export function currentJobState(job: SelectedJob, currency: InputCurrency): ProcessingStateDto {
  return currency.current ? job.state : 'superseded'
}

/**
 * Whether an open question reads as superseded: its job's input is no longer current, or a later
 * attempt replaced the one that asked it. The Processing read and the session brief share it.
 */
export function staleOpenQuestion(
  question: { state: string; attemptId: string },
  job: { state: ProcessingStateDto; attemptId: string },
) {
  return (
    question.state === 'open' &&
    (job.state === 'superseded' || question.attemptId !== job.attemptId)
  )
}

/** Each job's state as the Processing read shows it, with its current attempt. */
export async function effectiveJobStates(
  client: PoolClient,
  config: ProcessingConfig,
  capture: CaptureSnapshotDto,
) {
  const jobs = await selectedJobs(client, capture.id)
  const media = await readProcessingMediaScopes(client, config, capture, lotSubjects(jobs))
  const states = new Map<string, { state: ProcessingStateDto; attemptId: string }>()
  for (const job of jobs) {
    const currency = await inputCurrency(client, config, job, capture, jobMedia(media, job))
    states.set(job.id, { state: currentJobState(job, currency), attemptId: job.attemptId })
  }
  return states
}
