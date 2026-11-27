import type { PoolClient } from 'pg'
import type {
  AgentSettingsDto,
  CaptureSnapshotDto,
  MatchIdentityDto,
  MatchOutcomeDto,
} from '@invimport/contracts'
import { resolveSelection } from '#/agents/resolve-selection.ts'
import { readAgentSettings } from '#/agents/settings.ts'
import type { LockedMediaInputs } from '#/media/locked-inputs.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { checkJobCapacity, queueJob, supersedeJobAttempts } from '#/processing/jobs.ts'
import { sealedMatchFor, type MatchStage } from '#/processing/match-outcome.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { isSessionProfile } from '#/processing/session-policy.ts'

const STAGES: readonly MatchStage[] = ['research', 'images']
/** Attempt states that end a stage's work; anything else is still the stage's current work. */
const ENDED = new Set(['superseded', 'cancelled', 'failed'])

/** The identity proposals a stage starts from: Examine's identity; an operator's has none. */
export function pinsOf(identity: MatchIdentityDto) {
  return identity.kind === 'examine' ? [identity.proposal_id] : []
}

/** The agent settings stage attempts seal; none for profiles that need no provider. */
export async function stageSettings(client: PoolClient, config: ProcessingConfig) {
  const profile = config.profileId
  if (!profile || !isSessionProfile(profile) || profile === 'synthetic-session/1') {
    return undefined
  }
  return readAgentSettings(client, config, false)
}

interface StageJob {
  jobId: string
  attemptState: string
  inputBytes: Buffer
  inputDigest: Buffer
  turnCount: string | null
}

async function stageJob(client: PoolClient, batchId: string, lotId: string, stage: MatchStage) {
  const rows = await client.query<{
    job_id: string
    attempt_state: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
    turn_count: string | null
  }>(
    `SELECT j.id AS job_id, a.state AS attempt_state, i.manifest_bytes, i.manifest_digest,
       s.turn_count::text AS turn_count
     FROM public.processing_job j
     JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     JOIN public.processing_input i ON i.id=a.input_id
     LEFT JOIN public.agent_session s ON s.attempt_id=a.id
     WHERE j.batch_id=$1 AND j.subject_id=$2 AND j.stage=$3
     FOR UPDATE OF j`,
    [batchId, lotId, stage],
  )
  const row = rows.rows[0]
  if (!row) {
    return undefined
  }
  return {
    jobId: row.job_id,
    attemptState: row.attempt_state,
    inputBytes: row.manifest_bytes,
    inputDigest: row.manifest_digest,
    turnCount: row.turn_count,
  } satisfies StageJob
}

/** Whether the stage's current work was sealed for this outcome and identity. */
function sealedFor(job: StageJob, outcome: MatchOutcomeDto, pins: readonly string[]) {
  const manifest = decodeSessionInput(job.inputBytes, job.inputDigest)
  if (manifest.schema_version !== 'bench-intake-input/7') {
    return false
  }
  return (
    'match' in manifest &&
    manifest.match?.outcome?.revision === outcome.revision &&
    manifest.pinned_proposal_ids.length === pins.length &&
    manifest.pinned_proposal_ids.every((id, index) => id === pins[index])
  )
}

/**
 * Queues the lot's Research and Images in the modes the outcome sets, pinned to its identity. A
 * stage whose current work was sealed for this outcome and identity is left as it is; a stage
 * the outcome skips has work that hasn't started superseded. Caller holds the capture, media and
 * Match locks. Returns the stages queued.
 */
export async function queueOutcomeStages(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  lotId: string,
  outcome: MatchOutcomeDto,
  identity: MatchIdentityDto,
  media: LockedMediaInputs,
  settings?: AgentSettingsDto,
) {
  const pins = pinsOf(identity)
  const toQueue: MatchStage[] = []
  for (const stage of STAGES) {
    const job = await stageJob(client, snapshot.id, lotId, stage)
    const live = job !== undefined && !ENDED.has(job.attemptState)
    if (outcome[stage].mode === 'skipped') {
      const unstarted = job?.attemptState === 'queued' && (job.turnCount ?? '0') === '0'
      if (job && unstarted) {
        await supersedeJobAttempts(client, job.jobId)
      }
      continue
    }
    if (live && sealedFor(job, outcome, pins)) {
      continue
    }
    toQueue.push(stage)
  }
  const queueable = settings
    ? toQueue.filter((stage) => resolveSelection(settings, stage))
    : toQueue
  if (!queueable.length) {
    return []
  }
  await checkJobCapacity(client, snapshot.id, [lotId], [...queueable])
  for (const stage of queueable) {
    await queueJob(client, config, snapshot, lotId, stage, [], media, pins, {
      lockSettings: false,
      settings,
      inputVersion: 'bench-intake-input/7',
      match: sealedMatchFor(outcome, stage),
    })
  }
  return queueable
}
