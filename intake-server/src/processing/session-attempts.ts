import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type {
  AgentSettingsDto,
  CaptureSnapshotDto,
  ProcessingInputV6Dto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { commands, outbox } from '#/db/schema.ts'
import { agentSessions } from '#/agents/schema.ts'
import { readAgentSettings } from '#/agents/settings.ts'
import { resolveSelection } from '#/agents/resolve-selection.ts'
import type { LockedMediaInputs } from '#/media/locked-inputs.ts'
import { channelToken, processingChannelConfigured, type ProcessingConfig } from './attempts.ts'
import { MAX_PROCESSING_SNAPSHOT_BYTES } from './limits.ts'
import { fail, sealed, type Stage } from './model.ts'
import { processingAttempts, processingInputs } from './schema.ts'
import { assembleBrief } from './brief.ts'
import { briefPages, sealBrief, storeInputPages, type SealedBriefPage } from './brief-pages.ts'
import { stagePacks, type SessionInputVersion } from './stage-policy.ts'
import {
  briefScope,
  stageInputManifest,
  sessionLeadInputManifest,
  sessionLotInputManifest,
  type SessionInputProfile,
  type SessionLotStage,
} from './session-input.ts'
import {
  sessionCommandQueue,
  sessionHandlerVersion,
  type SessionProfileId,
  webAccess,
} from './session-policy.ts'

const LOT_STAGES: readonly Stage[] = ['research', 'images', 'inventory']
const WEB_OFF = { public_pages: false, prefer_datasheets: false }

interface SessionAttemptOptions {
  /** The Examine trigger reads the saved selection without locking the settings row. */
  lockSettings?: boolean
  /** Settings already read in this transaction, so several attempts seal the same read. */
  settings?: AgentSettingsDto
  /** The identity proposals a per-lot successor starts from; revisions arrive as inbox items. */
  pinnedProposalIds?: readonly string[]
  /** The input `prepareSessionAttempt` already sealed, so a caller can check before writing. */
  prepared?: SealedSessionInput
  /** The version the batch's pipeline follows (`batchInputVersion`); `/6` when omitted. */
  inputVersion?: SessionInputVersion
}

/**
 * A sealed session input: its canonical bytes and their digest, and for `/7` the brief pages
 * kept outside the manifest, which are written with it.
 */
export interface SealedSessionInput {
  bytes: Buffer
  digest: Buffer
  pages: readonly SealedBriefPage[]
}

type SessionJob = { id: string; subject_id: string | null; stage: Stage | 'examine' }

/**
 * Every decision a new session attempt makes before its first write: the profile, the stage, the
 * resolved selection, the sealed input and its size, and the runner channel. Start fresh's
 * preflight calls it too, so both refuse the same way in the same order.
 */
export async function prepareSessionAttempt(
  client: PoolClient,
  config: ProcessingConfig,
  profileId: SessionProfileId,
  snapshot: CaptureSnapshotDto,
  job: SessionJob,
  media: { manifest: string; manifestDigest: string },
  {
    lockSettings = true,
    pinnedProposalIds = [],
    settings: given,
    inputVersion = 'bench-intake-input/6',
  }: SessionAttemptOptions = {},
): Promise<SealedSessionInput> {
  // `shared-vm-agent/2` is retired: no new attempt is sealed for it.
  if (profileId === 'shared-vm-agent/2') {
    fail('agent_profile_retired', 409)
  }
  const lead = job.stage === 'examine' && job.subject_id === null
  // Reading and identifying are replaced by the batch-level Examine session.
  if (!lead && (job.subject_id === null || !LOT_STAGES.includes(job.stage as Stage))) {
    fail('unsupported_processing_stage', 422)
  }
  const descriptor = { manifest: media.manifest, sha256: media.manifestDigest }
  let profile: SessionInputProfile = { id: 'synthetic-session/1' }
  if (profileId !== 'synthetic-session/1') {
    const settings = given ?? (await readAgentSettings(client, config, lockSettings))
    const agent = resolveSelection(settings, job.stage)
    if (!agent) {
      fail('agent_settings_required', 409)
    }
    profile = {
      id: profileId,
      agent,
      settingsRevision: settings.revision,
      partDescriptionStyle: settings.part_description_style || undefined,
      // Only profiles with web access seal the saved values; every other profile seals both off.
      web: webAccess(profileId) === 'available' ? { ...settings.web } : WEB_OFF,
    }
  }
  const base = lead
    ? sessionLeadInputManifest(snapshot, descriptor, profile)
    : sessionLotInputManifest(
        snapshot,
        job.subject_id!,
        job.stage as SessionLotStage,
        descriptor,
        profile,
        pinnedProposalIds,
      )
  const manifest =
    inputVersion === 'bench-intake-input/7'
      ? await sealStageInput(client, snapshot, base, profileId)
      : { ...sealed(base), pages: [] }
  if (manifest.bytes.length > MAX_PROCESSING_SNAPSHOT_BYTES) {
    fail('processing_input_capacity', 422)
  }
  // Checked before any write, so a missing secret never leaves a half-made attempt to roll back.
  if (!processingChannelConfigured(config)) {
    fail('processing_channel_unconfigured', 503)
  }
  return manifest
}

/**
 * A `/7` input: the `/6` manifest with its stage pack's digest and the brief, assembled now from
 * retained state. As many brief pages as fit stay in the manifest under the retained-input cap;
 * the rest go to the input's page store.
 */
async function sealStageInput(
  client: PoolClient,
  snapshot: CaptureSnapshotDto,
  base: ProcessingInputV6Dto,
  profileId: SessionProfileId,
): Promise<SealedSessionInput> {
  const packs = stagePacks[profileId]
  // The configured profile has no stage packs, so it can't run this batch's `/7` pipeline.
  if (!packs) {
    fail('unsupported_processing_profile', 422)
  }
  const scope = briefScope(base)
  const brief = await assembleBrief(client, snapshot, scope)
  const pages = briefPages(brief)
  for (let inline = pages.length; inline >= 0; inline -= 1) {
    const manifest = sealed(
      stageInputManifest(base, packs[scope.stage], sealBrief(brief, pages, inline)),
    )
    if (manifest.bytes.length <= MAX_PROCESSING_SNAPSHOT_BYTES) {
      return { ...manifest, pages: pages.slice(inline) }
    }
  }
  return fail('processing_input_capacity', 422)
}

/**
 * A session attempt: `/6` input, `/5` command on the session queue, and its session. The batch's
 * Examine lead job has no subject and batch-scoped media; every other stage is per lot.
 */
export async function createSessionAttempt(
  client: PoolClient,
  config: ProcessingConfig,
  profileId: SessionProfileId,
  snapshot: CaptureSnapshotDto,
  job: SessionJob,
  number: string,
  media: LockedMediaInputs,
  parentId: string | null,
  options: SessionAttemptOptions = {},
) {
  const manifest =
    options.prepared ??
    (await prepareSessionAttempt(client, config, profileId, snapshot, job, media, options))
  const attemptId = randomUUID()
  const inputId = randomUUID()
  const commandId = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(processingInputs).values({
      id: inputId,
      batchId: snapshot.id,
      parentId,
      captureRevision: BigInt(snapshot.revision),
      manifestBytes: manifest.bytes,
      manifestDigest: manifest.digest,
    }),
  )
  await storeInputPages(client, inputId, manifest.pages)
  const payload = sealed({
    schema_version: 'bench-intake-processing-command/5',
    job_id: job.id,
    attempt_id: attemptId,
    input_id: inputId,
    input_sha256: manifest.digest.toString('hex'),
    profile_id: profileId,
    handler_version: sessionHandlerVersion,
    command_id: commandId,
  })
  await executeDatabaseQuery(
    db.insert(commands).values({
      id: commandId,
      actorId: config.actorId,
      targetId: config.targetId,
      targetContextId: config.targetContextId,
      kind: 'process',
      handlerVersion: sessionHandlerVersion,
      workflowId: `processing:${attemptId}`,
      queueName: sessionCommandQueue,
      payloadBytes: payload.bytes,
      payloadDigest: payload.digest,
    }),
  )
  await media.pinCommand(commandId)
  const channel = sealed(channelToken(config, attemptId))
  await executeDatabaseQuery(
    db.insert(processingAttempts).values({
      id: attemptId,
      batchId: snapshot.id,
      jobId: job.id,
      number: BigInt(number),
      inputId,
      profileId,
      commandId,
      channelDigest: channel.digest,
      state: 'queued',
    }),
  )
  await executeDatabaseQuery(
    db
      .insert(agentSessions)
      .values({ attemptId, sessionState: 'queued', sessionLineageId: job.id }),
  )
  await executeDatabaseQuery(db.insert(outbox).values({ commandId }))
  return { attemptId, inputId, commandId }
}
