import type { PoolClient } from 'pg'
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { canonicalRecord } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingJobDto,
  type ProcessingSnapshotDto,
  type ProcessingStateDto,
  type ProcessingActivityDto,
  type ProcessingBlockerDto,
} from '@invimport/contracts'
import { commands } from '#/db/schema.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from './attempts.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { processingDependencyStatus } from './dependencies.ts'
import {
  readProcessingMediaScopes,
  processingMediaFor,
  type ProcessingMediaAvailability,
} from './media.ts'
import { fail, mediaProfileId } from './model.ts'
import {
  MAX_JOB_RESULTS,
  MAX_JOBS_PER_BATCH,
  MAX_PROCESSING_SNAPSHOT_BYTES,
  MIN_CHANNEL_SECRET_BYTES,
  MAX_ACTIVITY_BATCHES,
} from './limits.ts'
import {
  isSessionMessage,
  retainedQuestionSpec,
  retainedProposalValue,
  retainedSessionProposal,
  retainedSessionQuestion,
} from './retained.ts'
import { decodeJobInput } from './session-input.ts'
import { agentSessions } from '#/agents/schema.ts'
import { mediaVersions } from '#/media/schema.ts'
import { latestStatuses } from '#/agents/tools/outbox.ts'
import { verifyRetainedResearchSources } from './research-sources.ts'
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
import { countSteps } from './steps.ts'
import { pausedAmong } from '#/agents/pause.ts'

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

type SelectedJob = Awaited<ReturnType<typeof selectedJobs>>[number]

interface InputCurrency {
  current: boolean
  blockedCode?: ProcessingBlockerDto
}

/** The Examine lead job's media is the whole batch, pinned by its own manifest. */
const BATCH_SCOPED = { available: true as const, batchScoped: true as const }
type JobMedia = ProcessingMediaAvailability | typeof BATCH_SCOPED

const lotSubjects = (jobs: readonly SelectedJob[]) =>
  jobs.flatMap((job) => (job.subjectId === null ? [] : [job.subjectId]))

function jobMedia(
  scopes: ReadonlyMap<string, ProcessingMediaAvailability>,
  job: SelectedJob,
): JobMedia {
  return job.subjectId === null ? BATCH_SCOPED : processingMediaFor(scopes, job.subjectId)
}

async function inputCurrency(
  client: PoolClient,
  config: ProcessingConfig,
  job: SelectedJob,
  capture: CaptureSnapshotDto,
  media: JobMedia,
): Promise<InputCurrency> {
  const input = decodeJobInput(job.inputBytes, job.inputDigest)
  if (input.schema_version === 'bench-intake-input/6') {
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

function currentJobState(job: SelectedJob, currency: InputCurrency): ProcessingStateDto {
  return currency.current ? job.state : 'superseded'
}

async function proposalsForJob(
  client: PoolClient,
  config: ProcessingConfig,
  job: SelectedJob,
  batchLots: ReadonlySet<string>,
): Promise<ProcessingJobDto['proposals']> {
  const manifest = decodeJobInput(job.inputBytes, job.inputDigest)
  const proposals = await executeDatabaseQuery(
    queryDatabase(client)
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
      .limit(MAX_JOB_RESULTS + 1),
  )
  if (proposals.length > MAX_JOB_RESULTS) {
    fail('processing_capacity')
  }
  const projected: ProcessingJobDto['proposals'] = []
  let batchVersions: Parameters<typeof retainedSessionProposal>[4] | undefined
  for (const proposal of proposals) {
    if (isSessionMessage(proposal)) {
      if (manifest.schema_version !== 'bench-intake-input/6') {
        fail('retained_proposal_binding_invalid')
      }
      // The propose tool checked delivery; a citation still names a real version of this batch.
      batchVersions ??= (
        await executeDatabaseQuery(
          queryDatabase(client)
            .select({
              versionId: mediaVersions.id,
              evidenceId: mediaVersions.evidenceId,
              blobDigest: mediaVersions.blobDigest,
            })
            .from(mediaVersions)
            .where(eq(mediaVersions.batchId, manifest.batch_id)),
        )
      ).map(({ blobDigest, ...version }) => ({ ...version, digest: blobDigest.toString('hex') }))
      const value = retainedSessionProposal(
        proposal,
        job.subjectId,
        manifest,
        batchLots,
        batchVersions,
      )
      projected.push({ id: proposal.id, message_id: proposal.messageId, value })
      continue
    }
    if (manifest.schema_version === 'bench-intake-input/6') {
      fail('retained_proposal_binding_invalid')
    }
    const value = retainedProposalValue(
      proposal,
      job.subjectId ?? fail('retained_proposal_binding_invalid'),
      manifest,
    )
    await verifyRetainedResearchSources(
      client,
      config,
      manifest,
      {
        attemptId: proposal.attemptId,
        commandId: proposal.commandId,
        inputSha256: proposal.manifestDigest.toString('hex'),
      },
      value,
    )
    projected.push({ id: proposal.id, message_id: proposal.messageId, value })
  }
  return projected
}

async function questionsForJob(
  client: PoolClient,
  job: SelectedJob,
  currentState: ProcessingStateDto,
  batchSubjects: ReadonlySet<string>,
): Promise<ProcessingJobDto['questions']> {
  const questions = await executeDatabaseQuery(
    queryDatabase(client)
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
      // Oldest first; questions retained before the time was kept come last.
      .orderBy(sql`${processingQuestions.askedAt} ASC NULLS LAST`, processingQuestions.id)
      .limit(MAX_JOB_RESULTS + 1),
  )
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
      ...questionSpec(question, job.subjectId, batchSubjects),
      ...(question.askedAt ? { asked_at: question.askedAt.toISOString() } : {}),
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
  const media = await readProcessingMediaScopes(client, config, capture, lotSubjects(retainedJobs))
  const batchLots = new Set(capture.lots.map((lot) => lot.id))
  const batchSubjects = new Set([...batchLots, ...capture.parts.map((part) => part.id)])
  const sessionStates = new Map(
    retainedJobs.length
      ? (
          await executeDatabaseQuery(
            queryDatabase(client)
              .select({ attemptId: agentSessions.attemptId, state: agentSessions.sessionState })
              .from(agentSessions)
              .where(
                inArray(
                  agentSessions.attemptId,
                  retainedJobs.map((job) => job.attemptId),
                ),
              ),
          )
        ).map((row) => [row.attemptId, row.state])
      : [],
  )
  const currentness = await proposalCurrentness(client, capture.id)
  const statuses = await latestStatuses(client, [...sessionStates.keys()])
  const jobs: ProcessingJobDto[] = []
  for (const job of retainedJobs) {
    const sessionState = sessionStates.get(job.attemptId)
    const latestStatus = statuses.get(job.attemptId)
    const currency = await inputCurrency(client, config, job, capture, jobMedia(media, job))
    const state = currentJobState(job, currency)
    const proposals = (await proposalsForJob(client, config, job, batchLots)).map((proposal) => {
      const state = currentness.get(proposal.id)
      return state ? { ...proposal, currentness: state } : proposal
    })
    const questions = await questionsForJob(client, job, state, batchSubjects)
    jobs.push({
      id: job.id,
      subject_id: job.subjectId,
      stage: job.stage,
      revision: job.revision.toString(),
      state,
      attempt_id: job.attemptId,
      input_sha256: job.inputDigest.toString('hex'),
      attempt_number: job.attemptNumber.toString(),
      qualification: jobManifestQualification(job.inputBytes, job.inputDigest),
      can_cancel: canCancelProcessingAttempt(
        { current_attempt_id: job.currentAttemptId, state: job.state },
        { id: job.attemptId, state: job.attemptState },
        capture.archived,
      ),
      ...(currency.blockedCode ? { blocked_code: currency.blockedCode } : {}),
      ...(sessionState ? { session_state: sessionState } : {}),
      ...(latestStatus ? { latest_status: latestStatus } : {}),
      proposals,
      questions,
    })
  }
  const configured = Buffer.byteLength(config.channelSecret) >= MIN_CHANNEL_SECRET_BYTES
  const snapshot: ProcessingSnapshotDto = {
    runner_status: configuredRunnerStatus(configured, config),
    batch_id: capture.id,
    capture_revision: capture.revision,
    jobs,
    cursor: capture.cursor,
    ...((await pausedAmong(client, [capture.id])).size ? { paused: true as const } : {}),
  }
  validate('ProcessingSnapshot', snapshot)
  if (Buffer.byteLength(canonicalRecord(snapshot)) > MAX_PROCESSING_SNAPSHOT_BYTES) {
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
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
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
  const laneRows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ attemptId: processingLanes.attemptId })
      .from(processingLanes)
      .where(eq(processingLanes.actorId, config.actorId)),
  )
  const heldAttemptId = laneRows[0]?.attemptId ?? null
  const jobs: ProcessingActivityDto['jobs'] = []

  // Put the held lane first so truncation never hides an account claim. A foreign target/context
  // contributes only the safe aggregate busy flag, never its batch or attempt identifiers.
  if (heldAttemptId) {
    const held = await heldLaneJob(client, config, heldAttemptId)
    if (held) {
      const capture = await captureInTransaction(client, config, held.batchId)
      const media = await readProcessingMediaScopes(
        client,
        config,
        capture.snapshot,
        lotSubjects([held]),
      )
      const currency = await inputCurrency(
        client,
        config,
        held,
        capture.snapshot,
        jobMedia(media, held),
      )
      jobs.push(activityJob(held, currency, true))
    }
  }

  const batches = await executeDatabaseQuery(
    queryDatabase(client)
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
      .limit(MAX_ACTIVITY_BATCHES + 1),
  )
  let truncated = batches.length > MAX_ACTIVITY_BATCHES

  for (const batch of batches.slice(0, MAX_ACTIVITY_BATCHES)) {
    const capture = await captureInTransaction(client, config, batch.batchId)
    const retainedJobs = await selectedJobs(client, batch.batchId)
    const media = await readProcessingMediaScopes(
      client,
      config,
      capture.snapshot,
      lotSubjects(retainedJobs),
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
        jobMedia(media, job),
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

/** Inbox observations reuse the destination's exact currentness and supersession policy. */
export async function inboxProcessing(
  client: PoolClient,
  config: ProcessingConfig,
  capture: CaptureSnapshotDto,
) {
  const activeSubjects = new Set(
    [...capture.lots.filter((lot) => !lot.retired), ...capture.parts].map((subject) => subject.id),
  )
  const retained = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: processingJobs.id })
      .from(processingJobs)
      .where(eq(processingJobs.batchId, capture.id))
      .limit(1),
  )
  if (!retained.length) {
    return { open_questions: 0, active_jobs: 0 }
  }
  const snapshot = await processingSnapshot(client, config, capture)
  const jobs = snapshot.jobs.filter(
    // The batch-level Examine lead job counts alongside the jobs of active subjects.
    (job) => job.subject_id === null || activeSubjects.has(job.subject_id),
  )
  return {
    open_questions: jobs
      .flatMap((job) => job.questions)
      .filter((question) => question.state === 'open').length,
    active_jobs: jobs.filter((job) => job.state === 'running' || job.state === 'queued').length,
    steps: countSteps(jobs),
  }
}

function jobManifestQualification(
  bytes: Buffer,
  digest: Buffer,
): ProcessingJobDto['qualification'] {
  const profileId = decodeJobInput(bytes, digest).profile_id
  return profileId === 'native-agent/1' ||
    profileId === 'native-agent/2' ||
    profileId === 'shared-vm-agent/2' ||
    profileId === 'shared-vm-agent/1'
    ? 'native_unverified'
    : 'fixture_only'
}

/** Session questions also carry the fields they affect and the assumption in use. */
function questionSpec(
  question: Parameters<typeof retainedQuestionSpec>[0],
  subjectId: string | null,
  batchSubjects: ReadonlySet<string>,
): Pick<ProcessingJobDto['questions'][number], 'spec' | 'fields' | 'assumption'> {
  if (!isSessionMessage(question)) {
    return {
      spec: retainedQuestionSpec(question, subjectId ?? fail('retained_question_binding_invalid')),
    }
  }
  const ask = retainedSessionQuestion(question, subjectId, batchSubjects)
  return {
    spec: {
      kind: ask.kind,
      // Only the lead session may ask about the whole batch.
      subject_id:
        ask.subject_id ?? (subjectId === null ? null : fail('retained_question_binding_invalid')),
      prompt: ask.prompt,
      reason: ask.reason,
    },
    fields: ask.fields,
    assumption: ask.assumption,
  }
}

function configuredRunnerStatus(
  configured: boolean,
  config: ProcessingConfig,
): ProcessingSnapshotDto['runner_status'] {
  if (!configured) {
    return 'unconfigured'
  }
  return config.profileId === 'native-agent/1' ||
    config.profileId === 'native-agent/2' ||
    config.profileId === 'shared-vm-agent/2' ||
    config.profileId === 'shared-vm-agent/1'
    ? 'native_unverified'
    : 'fixture_only'
}

type Currentness = NonNullable<ProcessingJobDto['proposals'][number]['currentness']>

/**
 * Each session proposal's currentness, in one bounded query per batch: stale when a relied-on
 * source changed, provisional while an open question shares one of its fields and subject.
 */
async function proposalCurrentness(client: PoolClient, batchId: string) {
  const rows = await client.query<{ id: string; stale: string | null; provisional: boolean }>(
    `SELECT p.id, s.reason AS stale,
       EXISTS (
         SELECT 1 FROM public.processing_question q JOIN public.processing_job qj ON qj.id=q.job_id
         WHERE q.batch_id=$1 AND q.state='open' AND q.attempt_id=qj.current_attempt_id
           AND (convert_from(q.spec_bytes,'UTF8')::jsonb->'fields')
               ?| ARRAY(SELECT jsonb_array_elements_text(p.relies_on->'fields'))
           AND COALESCE((convert_from(q.spec_bytes,'UTF8')::jsonb->>'subject_id')::uuid, qj.subject_id)
               = COALESCE(j.subject_id, (convert_from(p.value_bytes,'UTF8')::jsonb->>'subject_id')::uuid)
       ) AS provisional
     FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id
     LEFT JOIN public.processing_proposal_stale s ON s.proposal_id=p.id
     WHERE j.batch_id=$1 AND p.relies_on IS NOT NULL`,
    [batchId],
  )
  return new Map<string, Currentness>(
    rows.rows.map((row) => [
      row.id,
      row.stale
        ? ({ state: 'stale', reason: row.stale } as Currentness)
        : row.provisional
          ? { state: 'provisional' }
          : { state: 'current' },
    ]),
  )
}
