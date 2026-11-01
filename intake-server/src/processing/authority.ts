import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto, ProcessingInputDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import {
  fail,
  ProcessingError,
  inputManifest,
  mediaInputManifest,
  decodeProcessingInput,
  decodeProcessingCommand,
  type Stage,
} from './model.ts'
import { verifyBytes } from '../db/authority.ts'
import { processingProfiles, toolProfileVersion } from './policy.ts'
import type { MediaInputs } from '../media/inputs.ts'
import { verifyRetainedProcessingMedia } from './media.ts'
import type { ProcessingConfig } from './attempts.ts'

export async function loadProcessingAuthority(
  client: PoolClient,
  config: ProcessingConfig,
  attemptId: string,
) {
  const authorities = await client.query(
    `SELECT attempt.*, input.manifest_bytes, input.manifest_digest, input.capture_revision,
            command.payload_bytes, command.payload_digest, command.actor_id, command.target_id,
            command.target_context_id, command.handler_version, command.workflow_id,
            command.queue_name, command.kind,
            profile.instruction_bytes, profile.instruction_digest, profile.tool_profile_version
     FROM processing_attempt attempt
     JOIN processing_input input ON input.id = attempt.input_id
     JOIN command command ON command.id = attempt.command_id
     JOIN processing_profile profile ON profile.id = attempt.profile_id
     WHERE attempt.id = $1`,
    [attemptId],
  )
  const row = authorities.rows[0]
  if (
    !row ||
    row.actor_id !== config.actorId ||
    row.target_id !== config.targetId ||
    row.target_context_id !== config.targetContextId
  ) {
    fail('attempt_not_found', 404)
  }
  const profile = processingProfiles[row.profile_id as keyof typeof processingProfiles]
  if (!profile) {
    fail('processing_profile_version_conflict')
  }
  verifyBytes(row.instruction_bytes, row.instruction_digest)
  const profileMatches =
    row.instruction_digest.toString('hex') === profile.instructionDigest &&
    row.instruction_bytes.toString('utf8') === profile.instructions &&
    row.tool_profile_version === toolProfileVersion
  if (!profileMatches) {
    fail('processing_profile_version_conflict')
  }

  const manifest = decodeProcessingInput(row.manifest_bytes, row.manifest_digest)
  const payload = decodeProcessingCommand(row.payload_bytes, row.payload_digest)
  const expected = {
    schema_version:
      manifest.schema_version === 'bench-intake-input/1'
        ? 'bench-intake-processing-command/1'
        : 'bench-intake-processing-command/2',
    job_id: row.job_id,
    attempt_id: row.id,
    input_id: row.input_id,
    input_sha256: row.manifest_digest.toString('hex'),
    profile_id: manifest.profile_id,
    handler_version: profile.handlerVersion,
    command_id: row.command_id,
  }
  if (
    canonical(payload) !== canonical(expected) ||
    row.handler_version !== profile.handlerVersion ||
    row.profile_id !== manifest.profile_id ||
    row.workflow_id !== `processing:${row.id}` ||
    row.queue_name !== 'bench-research' ||
    !['process', 'continue'].includes(row.kind) ||
    manifest.batch_id !== row.batch_id ||
    manifest.instruction_version !== profile.instructionVersion ||
    manifest.instruction_sha256 !== profile.instructionDigest ||
    manifest.tool_profile_version !== toolProfileVersion
  ) {
    fail('processing_authority_corrupt')
  }
  await verifyRetainedProcessingMedia(client, config, manifest, row.command_id)
  return { row, manifest, payload }
}

export function processingInputIsCurrent(
  manifest: ProcessingInputDto,
  snapshot: CaptureSnapshotDto,
  media: MediaInputs,
) {
  // The dependency closure is retained; unrelated batch changes do not invalidate this subject.
  if (
    manifest.schema_version === 'bench-intake-input/1' &&
    (media.versions.length > 0 || media.attachments.length > 0)
  ) {
    return false
  }
  const argumentsForInput = [
    snapshot,
    manifest.subject_id,
    manifest.stage as Stage,
    manifest.dependencies,
    manifest.answer_id,
  ] as const
  let current: ProcessingInputDto
  try {
    current =
      manifest.schema_version === 'bench-intake-input/1'
        ? inputManifest(...argumentsForInput)
        : mediaInputManifest(...argumentsForInput, {
            manifest: media.bytes.toString('utf8'),
            sha256: media.digest.toString('hex'),
          })
  } catch (error) {
    const evidenceRemoved =
      error instanceof ProcessingError &&
      ['retained_evidence_required', 'retained_manual_evidence_required'].includes(error.code)
    if (evidenceRemoved) {
      return false
    }
    throw error
  }
  current.capture_revision = manifest.capture_revision
  return canonical(current) === canonical(manifest)
}
