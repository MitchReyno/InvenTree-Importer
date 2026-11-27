import type { MatchStage } from './match-outcome.ts'
import type { PoolClient } from 'pg'
import type {
  AgentSettingsDto,
  CaptureSnapshotDto,
  SessionStateDto,
  StartFreshEligibilityDto,
  StartFreshRefusal,
} from '@invimport/contracts'
import { START_FRESH_REFUSALS } from '@invimport/contracts'
import { captureInTransaction } from '#/capture/repository.ts'
import { readBatchMediaInputResult, type MediaInputScopeResult } from '#/media/inputs.ts'
import { readAgentSettings } from '#/agents/settings.ts'
import type { ProcessingConfig } from './attempts.ts'
import { readProcessingMediaScopes, type ProcessingMediaAvailability } from './media.ts'
import { ProcessingError, type Stage } from './model.ts'
import { isSessionProfile, type SessionProfileId } from './session-policy.ts'
import { prepareSessionAttempt } from './session-attempts.ts'
import {
  batchInputVersion,
  configuredInputVersion,
  type SessionInputVersion,
} from './stage-policy.ts'
import { decodeSessionInput } from './session-input.ts'
import { pinnedIdentityCurrent, successorsCurrent } from './stable-identity.ts'
import { matchGate } from './match/gate.ts'

/** Session states an explicit Start fresh may replace. */
export const REPLACEABLE_STATES: ReadonlySet<string> = new Set([
  'cancelled',
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

const REFUSALS = new Set<string>(START_FRESH_REFUSALS)

type JobStage = Stage | 'examine'

/** The job's subject is a lot that has been retired. */
export function subjectRetired(snapshot: CaptureSnapshotDto, subjectId: string | null) {
  return subjectId !== null && snapshot.lots.some((lot) => lot.id === subjectId && lot.retired)
}

/** The jobs any of whose attempts still hold an agent slot, until their worker is reaped. */
export async function jobsHoldingSlots(client: PoolClient, jobIds: readonly string[]) {
  if (!jobIds.length) {
    return new Set<string>()
  }
  const rows = await client.query<{ job_id: string }>(
    `SELECT DISTINCT a.job_id
       FROM public.agent_slot s
       JOIN public.processing_attempt a ON a.id=s.attempt_id
      WHERE a.job_id=ANY($1::uuid[])`,
    [jobIds],
  )
  return new Set(rows.rows.map((row) => row.job_id))
}

/** The identity proposals the current attempt's input pinned. */
export function pinnedProposals(input: { manifest_bytes: Buffer; manifest_digest: Buffer }) {
  return decodeSessionInput(input.manifest_bytes, input.manifest_digest).pinned_proposal_ids
}

/**
 * The Match outcome and mode the current attempt's `/7` lot input sealed, which a replacement
 * keeps, so Start fresh can't widen what the lot's stage may publish. None for other inputs.
 */
export function sealedMatch(input: { manifest_bytes: Buffer; manifest_digest: Buffer }) {
  const manifest = decodeSessionInput(input.manifest_bytes, input.manifest_digest)
  return 'match' in manifest ? manifest.match : undefined
}

interface CurrentJob {
  id: string
  batch_id: string
  subject_id: string | null
  stage: JobStage
  session_state: SessionStateDto | null
  manifest_bytes: Buffer
  manifest_digest: Buffer
}

async function currentJobs(client: PoolClient, jobIds: readonly string[]) {
  const rows = await client.query<CurrentJob>(
    `SELECT j.id, j.batch_id, j.subject_id, j.stage, s.session_state,
            i.manifest_bytes, i.manifest_digest
       FROM public.processing_job j
       JOIN public.processing_attempt a ON a.id=j.current_attempt_id
       JOIN public.processing_input i ON i.id=a.input_id
       LEFT JOIN public.agent_session s ON s.attempt_id=a.id
      WHERE j.id=ANY($1::uuid[])`,
    [jobIds],
  )
  return rows.rows
}

/** What a read already holds, so the preflight doesn't read it again. */
export interface EligibilityContext {
  captures?: ReadonlyMap<string, CaptureSnapshotDto>
  lotMedia?: ReadonlyMap<string, ProcessingMediaAvailability>
}

/** One batch's capture and the media each of its replaceable jobs would be sealed with. */
interface BatchInputs {
  snapshot: CaptureSnapshotDto
  lotMedia: (subjectId: string) => ProcessingMediaAvailability | undefined
  batchMedia: MediaInputScopeResult | undefined
}

async function batchInputs(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  jobs: readonly CurrentJob[],
  context: EligibilityContext,
): Promise<BatchInputs> {
  const snapshot =
    context.captures?.get(batchId) ?? (await captureInTransaction(client, config, batchId)).snapshot
  const liveLotJobs = jobs.filter(
    (job) => job.subject_id !== null && !subjectRetired(snapshot, job.subject_id),
  )
  const unread = liveLotJobs
    .map((job) => job.subject_id!)
    .filter((subjectId) => !context.lotMedia?.has(subjectId))
  const read = unread.length
    ? await readProcessingMediaScopes(client, config, snapshot, unread)
    : new Map<string, ProcessingMediaAvailability>()

  const lotMedia = (subjectId: string) => context.lotMedia?.get(subjectId) ?? read.get(subjectId)

  const leads = jobs.some((job) => job.subject_id === null)
  const batchMedia = leads ? await readBatchMediaInputResult(client, config, batchId) : undefined
  return { snapshot, lotMedia, batchMedia }
}

function mediaOf(job: CurrentJob, inputs: BatchInputs): MediaInputScopeResult | undefined {
  if (job.subject_id === null) {
    return inputs.batchMedia
  }
  const availability = inputs.lotMedia(job.subject_id)
  if (!availability) {
    return undefined
  }
  return availability.available
    ? { kind: 'ready', inputs: availability.inputs }
    : { kind: 'blocked', code: availability.blockedCode }
}

function refused(reason: StartFreshRefusal): StartFreshEligibilityDto {
  return { allowed: false, reason }
}

/**
 * Whether Start fresh would be accepted for each job now: every refusal `replaceSession` makes
 * before its first write, in its order, read without locks or writes. Settings and media are read
 * once for the call. The command stays authoritative and checks again in its transaction.
 */
export async function startFreshEligibility(
  client: PoolClient,
  config: ProcessingConfig,
  jobIds: readonly string[],
  context: EligibilityContext = {},
): Promise<Map<string, StartFreshEligibilityDto>> {
  const eligibility = new Map<string, StartFreshEligibilityDto>()
  if (!jobIds.length) {
    return eligibility
  }
  const profileId = config.profileId
  if (!profileId || !isSessionProfile(profileId)) {
    for (const jobId of jobIds) {
      eligibility.set(jobId, refused('unsupported_processing_profile'))
    }
    return eligibility
  }
  const jobs = await currentJobs(client, jobIds)
  // Only a stopped session can start again; nothing more is read for the rest.
  const replaceable = jobs.filter(
    (job) => job.session_state !== null && REPLACEABLE_STATES.has(job.session_state),
  )
  for (const jobId of jobIds) {
    eligibility.set(jobId, refused('session_not_replaceable'))
  }
  const held = await jobsHoldingSlots(
    client,
    replaceable.map((job) => job.id),
  )
  let settings: AgentSettingsDto | undefined
  const batchIds = [...new Set(replaceable.map((job) => job.batch_id))]
  for (const batchId of batchIds) {
    const batchJobs = replaceable.filter((job) => job.batch_id === batchId)
    const inputs = await batchInputs(client, config, batchId, batchJobs, context)
    const inputVersion = await batchInputVersion(client, config, batchId)

    // Settings are read only when a job gets as far as sealing, as replacement reads them.
    const readSettings = async () => {
      if (profileId !== 'synthetic-session/1' && settings === undefined) {
        settings = await readAgentSettings(client, config, false)
      }
      return settings
    }

    for (const job of batchJobs) {
      const result = await jobEligibility(
        client,
        config,
        profileId,
        job,
        inputs,
        held,
        inputVersion,
        readSettings,
      )
      eligibility.set(job.id, result)
    }
  }
  return eligibility
}

async function jobEligibility(
  client: PoolClient,
  config: ProcessingConfig,
  profileId: SessionProfileId,
  job: CurrentJob,
  inputs: BatchInputs,
  held: ReadonlySet<string>,
  inputVersion: SessionInputVersion,
  readSettings: () => Promise<AgentSettingsDto | undefined>,
): Promise<StartFreshEligibilityDto> {
  if (inputs.snapshot.archived) {
    return refused('batch_archived')
  }
  if (subjectRetired(inputs.snapshot, job.subject_id)) {
    return refused('subject_retired')
  }
  const media = mediaOf(job, inputs)
  if (!media) {
    return refused('media_not_ready')
  }
  if (media.kind === 'blocked') {
    return refused(media.code)
  }
  if (held.has(job.id)) {
    return refused('session_reap_pending')
  }
  if (
    job.stage === 'inventory' &&
    !(await successorsCurrent(client, job.batch_id, job.subject_id!))
  ) {
    return refused('inventory_waiting')
  }
  const pinned = pinnedProposals(job)
  if (!(await pinnedIdentityCurrent(client, pinned))) {
    return refused('identity_waiting')
  }
  const match = sealedMatch(job)
  const lotStage = job.subject_id !== null && (job.stage === 'research' || job.stage === 'images')
  // Work sealed without Match (an earlier input's) goes through Match before a `/7` restart.
  if (
    lotStage &&
    (match
      ? !(await matchGate(client, job.subject_id!, job.stage as MatchStage, match)).allowed
      : inputVersion === 'bench-intake-input/7')
  ) {
    return refused('match_waiting')
  }
  // After replacement's own checks and before any settings read: no saved setting lets a
  // configuration that can't seal `/7` run a `/7` batch.
  const incompatible =
    inputVersion === 'bench-intake-input/7' &&
    configuredInputVersion(config) !== 'bench-intake-input/7'
  if (incompatible) {
    return refused('unsupported_processing_profile')
  }
  const settings = await readSettings()
  try {
    await prepareSessionAttempt(
      client,
      config,
      profileId,
      inputs.snapshot,
      { id: job.id, subject_id: job.subject_id, stage: job.stage },
      {
        manifest: media.inputs.bytes.toString('utf8'),
        manifestDigest: media.inputs.digest.toString('hex'),
      },
      { settings, pinnedProposalIds: pinned, inputVersion, superseding: true },
    )
  } catch (error) {
    if (error instanceof ProcessingError && REFUSALS.has(error.code)) {
      return refused(error.code as StartFreshRefusal)
    }
    throw error
  }
  return { allowed: true }
}
