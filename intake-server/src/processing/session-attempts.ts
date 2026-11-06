import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { commands, outbox } from '../db/schema.ts'
import { agentSessions } from '../agents/schema.ts'
import { readAgentSettings } from '../agents/settings.ts'
import type { LockedMediaInputs } from '../media/locked-inputs.ts'
import { channelToken, type ProcessingConfig } from './attempts.ts'
import { MAX_PROCESSING_SNAPSHOT_BYTES } from './limits.ts'
import { fail, sealed, type Stage } from './model.ts'
import { processingAttempts, processingInputs } from './schema.ts'
import {
  sessionLeadInputManifest,
  sessionLotInputManifest,
  type SessionLotStage,
} from './session-input.ts'
import {
  sessionCommandQueue,
  sessionHandlerVersion,
  type SessionProfileId,
} from './session-policy.ts'

const LOT_STAGES: readonly Stage[] = ['research', 'images', 'inventory']

/**
 * A session attempt: `/6` input, `/5` command on the session queue, and its session. The batch's
 * Examine lead job has no subject and batch-scoped media; every other stage is per lot.
 */
export async function createSessionAttempt(
  client: PoolClient,
  config: ProcessingConfig,
  profileId: SessionProfileId,
  snapshot: CaptureSnapshotDto,
  job: { id: string; subject_id: string | null; stage: Stage | 'examine' },
  number: string,
  media: LockedMediaInputs,
  parentId: string | null,
  /** The Examine trigger reads the saved selection without locking the settings row. */
  {
    lockSettings = true,
    pinnedProposalIds = [],
  }: {
    lockSettings?: boolean
    /** The identity proposals a per-lot successor starts from; revisions arrive as inbox items. */
    pinnedProposalIds?: readonly string[]
  } = {},
) {
  const lead = job.stage === 'examine' && job.subject_id === null
  // Reading and identifying are replaced by the batch-level Examine session.
  if (!lead && (job.subject_id === null || !LOT_STAGES.includes(job.stage as Stage))) {
    fail('unsupported_processing_stage', 422)
  }
  const attemptId = randomUUID()
  const inputId = randomUUID()
  const commandId = randomUUID()
  const descriptor = { manifest: media.manifest, sha256: media.manifestDigest }
  let profile: Parameters<typeof sessionLotInputManifest>[4] = { id: 'synthetic-session/1' }
  if (profileId === 'native-agent/2') {
    const settings = await readAgentSettings(client, config, lockSettings)
    if (!settings.selection) {
      fail('agent_settings_required', 409)
    }
    profile = { id: profileId, agent: settings.selection, settingsRevision: settings.revision }
  }
  const manifest = sealed(
    lead
      ? sessionLeadInputManifest(snapshot, descriptor, profile)
      : sessionLotInputManifest(
          snapshot,
          job.subject_id!,
          job.stage as SessionLotStage,
          descriptor,
          profile,
          pinnedProposalIds,
        ),
  )
  if (manifest.bytes.length > MAX_PROCESSING_SNAPSHOT_BYTES) {
    fail('processing_input_capacity', 422)
  }
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
