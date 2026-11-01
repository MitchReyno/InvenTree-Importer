import { randomUUID, createHmac } from 'node:crypto'
import type { PoolClient } from 'pg'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import type { CaptureBinding } from '../capture/repository.ts'
import { MIN_CHANNEL_SECRET_BYTES, MAX_PROCESSING_SNAPSHOT_BYTES } from './limits.ts'
import { fail, handlerVersion, inputManifest, profileId, sealed, type Stage } from './model.ts'

export interface ProcessingConfig extends CaptureBinding {
  /** Separate private runner-channel root, never a target/provider credential or DTO. */
  channelSecret: string
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
  parentId: string | null = null,
  answerId: string | null = null,
) {
  const attemptId = randomUUID()
  const inputId = randomUUID()
  const commandId = randomUUID()
  const manifestValue = inputManifest(snapshot, job.subject_id, job.stage, dependencies, answerId)
  validate('ProcessingInput', manifestValue)
  const manifest = sealed(manifestValue)
  if (manifest.bytes.length > MAX_PROCESSING_SNAPSHOT_BYTES) {
    fail('processing_input_capacity', 422)
  }
  await client.query(
    `INSERT INTO processing_input(id,batch_id,parent_id,capture_revision,manifest_bytes,manifest_digest)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [inputId, snapshot.id, parentId, snapshot.revision, manifest.bytes, manifest.digest],
  )
  const payload = sealed({
    schema_version: 'bench-intake-processing-command/1',
    job_id: job.id,
    attempt_id: attemptId,
    input_id: inputId,
    input_sha256: manifest.digest.toString('hex'),
    profile_id: profileId,
    handler_version: handlerVersion,
    command_id: commandId,
  })
  await client.query(
    `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
     VALUES($1,$2,$3,$4,$5,$6,$7,'bench-research',$8,$9)`,
    [
      commandId,
      config.actorId,
      config.targetId,
      config.targetContextId,
      answerId ? 'continue' : 'process',
      handlerVersion,
      `processing:${attemptId}`,
      payload.bytes,
      payload.digest,
    ],
  )
  const channel = sealed(channelToken(config, attemptId))
  await client.query(
    `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued')`,
    [attemptId, snapshot.id, job.id, number, inputId, profileId, commandId, channel.digest],
  )
  for (const dependency of dependencies) {
    await client.query(
      'INSERT INTO processing_dependency(batch_id,attempt_id,dependency_attempt_id) VALUES($1,$2,$3)',
      [snapshot.id, attemptId, dependency],
    )
  }
  await client.query('INSERT INTO outbox(command_id) VALUES($1)', [commandId])
  return { attemptId, inputId, commandId }
}
