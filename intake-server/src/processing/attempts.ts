import { processingProfiles } from './policy.ts'
import { createSessionAttempt } from './session-attempts.ts'
import { isSessionProfile } from './session-policy.ts'
import type { ProcessingInputDto } from '@invimport/contracts'
import { readAgentSettings } from '../agents/settings.ts'
import { agentSessions } from '../agents/schema.ts'
import { nativeProfileId } from '../agents/policy.ts'
import { randomUUID, createHmac } from 'node:crypto'
import type { PoolClient } from 'pg'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import type { CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { commands, outbox } from '../db/schema.ts'
import { processingAttempts, processingDependencies, processingInputs } from './schema.ts'
import { MIN_CHANNEL_SECRET_BYTES, MAX_PROCESSING_SNAPSHOT_BYTES } from './limits.ts'
import {
  fail,
  mediaInputManifest,
  nativeInputManifest,
  mediaProfileId,
  researchProfileId,
  researchInputManifest,
  sealed,
  type Stage,
  type SelectedProcessingProfile,
} from './model.ts'
import type { LockedMediaInputs } from '../media/locked-inputs.ts'

export interface ProcessingConfig extends CaptureBinding {
  /** Separate private runner-channel root, never a target/provider credential or DTO. */
  channelSecret: string
  profileId?: SelectedProcessingProfile
  approvedSourceUrls?: readonly string[]
  sourceProtectedOrigins?: readonly string[]
}

export function channelToken(config: ProcessingConfig, attemptId: string): string {
  if (Buffer.byteLength(config.channelSecret) < MIN_CHANNEL_SECRET_BYTES) {
    fail('processing_channel_unconfigured', 503)
  }
  return createHmac('sha256', config.channelSecret)
    .update(`processing-channel/1:${attemptId}`)
    .digest('hex')
}

export async function createAttempt(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  job: { id: string; subject_id: string; stage: Stage },
  number: string,
  dependencies: string[],
  media: LockedMediaInputs,
  parentId: string | null = null,
  answerId: string | null = null,
  pinnedProposalIds: readonly string[] = [],
  { lockSettings = true }: { lockSettings?: boolean } = {},
) {
  const selectedProfile = config.profileId ?? mediaProfileId
  if (isSessionProfile(selectedProfile)) {
    if (dependencies.length || answerId) {
      fail('unsupported_processing_input')
    }
    return createSessionAttempt(
      client,
      config,
      selectedProfile,
      snapshot,
      job,
      number,
      media,
      parentId,
      { pinnedProposalIds, lockSettings },
    )
  }
  const attemptId = randomUUID()
  const inputId = randomUUID()
  const commandId = randomUUID()
  const restricted = selectedProfile === researchProfileId
  const native = selectedProfile === nativeProfileId
  const profile = processingProfiles[selectedProfile]
  const actualHandlerVersion = profile.handlerVersion
  const mediaDescriptor = { manifest: media.manifest, sha256: media.manifestDigest }
  const argumentsForInput = [
    snapshot,
    job.subject_id,
    job.stage,
    dependencies,
    answerId,
    mediaDescriptor,
  ] as const
  let manifestValue: ProcessingInputDto
  if (native) {
    const settings = await readAgentSettings(client, config, true)
    manifestValue = nativeInputManifest(...argumentsForInput, settings)
  } else if (restricted) {
    manifestValue = researchInputManifest(...argumentsForInput, config.approvedSourceUrls ?? [])
  } else {
    manifestValue = mediaInputManifest(...argumentsForInput, { allowCreate: true })
  }
  validate('ProcessingInput', manifestValue)
  const manifest = sealed(manifestValue)
  if (manifest.bytes.length > MAX_PROCESSING_SNAPSHOT_BYTES) {
    fail('processing_input_capacity', 422)
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingInputs)
      .values({
        id: inputId,
        batchId: snapshot.id,
        parentId,
        captureRevision: BigInt(snapshot.revision),
        manifestBytes: manifest.bytes,
        manifestDigest: manifest.digest,
      }),
  )
  const payload = sealed({
    schema_version: profile.commandSchemaVersion,
    job_id: job.id,
    attempt_id: attemptId,
    input_id: inputId,
    input_sha256: manifest.digest.toString('hex'),
    profile_id: selectedProfile,
    handler_version: actualHandlerVersion,
    command_id: commandId,
  })
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(commands)
      .values({
        id: commandId,
        actorId: config.actorId,
        targetId: config.targetId,
        targetContextId: config.targetContextId,
        kind: answerId ? 'continue' : 'process',
        handlerVersion: actualHandlerVersion,
        workflowId: `processing:${attemptId}`,
        queueName: 'bench-research',
        payloadBytes: payload.bytes,
        payloadDigest: payload.digest,
      }),
  )
  await media.pinCommand(commandId)
  const channel = sealed(channelToken(config, attemptId))
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingAttempts)
      .values({
        id: attemptId,
        batchId: snapshot.id,
        jobId: job.id,
        number: BigInt(number),
        inputId,
        profileId: selectedProfile,
        commandId,
        channelDigest: channel.digest,
        state: 'queued',
      }),
  )
  if (native) {
    await executeDatabaseQuery(queryDatabase(client).insert(agentSessions).values({ attemptId }))
  }
  for (const dependency of dependencies) {
    await executeDatabaseQuery(
      queryDatabase(client).insert(processingDependencies).values({
        batchId: snapshot.id,
        attemptId,
        dependencyAttemptId: dependency,
      }),
    )
  }
  await executeDatabaseQuery(queryDatabase(client).insert(outbox).values({ commandId }))
  return { attemptId, inputId, commandId }
}
