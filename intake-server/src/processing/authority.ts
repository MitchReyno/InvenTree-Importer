import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto, ProcessingInputDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import {
  fail,
  handlerVersion,
  inputManifest,
  profileId,
  decodeProcessingInput,
  decodeProcessingCommand,
  type Stage,
} from './model.ts'
import { verifyBytes } from '../db/authority.ts'
import { instructionDigest, toolProfileVersion, trustedInstructions } from './policy.ts'
import type { ProcessingConfig } from './attempts.ts'

export async function loadProcessingAuthority(
  client: PoolClient,
  config: ProcessingConfig,
  attemptId: string,
) {
  const row = (
    await client.query(
      `SELECT a.*,i.manifest_bytes,i.manifest_digest,i.capture_revision,c.payload_bytes,c.payload_digest,
       c.actor_id,c.target_id,c.target_context_id,c.handler_version,c.workflow_id,c.queue_name,c.kind,
       p.instruction_bytes,p.instruction_digest,p.tool_profile_version
     FROM processing_attempt a JOIN processing_input i ON i.id=a.input_id
     JOIN command c ON c.id=a.command_id
     JOIN processing_profile p ON p.id=a.profile_id WHERE a.id=$1`,
      [attemptId],
    )
  ).rows[0]
  if (
    !row ||
    row.actor_id !== config.actorId ||
    row.target_id !== config.targetId ||
    row.target_context_id !== config.targetContextId
  ) {
    fail('attempt_not_found', 404)
  }
  verifyBytes(row.instruction_bytes, row.instruction_digest)
  const profileMatches =
    row.instruction_digest.toString('hex') === instructionDigest &&
    row.instruction_bytes.toString('utf8') === trustedInstructions &&
    row.tool_profile_version === toolProfileVersion
  if (!profileMatches) {
    fail('processing_profile_version_conflict')
  }

  const manifest = decodeProcessingInput(row.manifest_bytes, row.manifest_digest)
  const payload = decodeProcessingCommand(row.payload_bytes, row.payload_digest)
  const expected = {
    schema_version: 'bench-intake-processing-command/1',
    job_id: row.job_id,
    attempt_id: row.id,
    input_id: row.input_id,
    input_sha256: row.manifest_digest.toString('hex'),
    profile_id: profileId,
    handler_version: handlerVersion,
    command_id: row.command_id,
  }
  if (
    canonical(payload) !== canonical(expected) ||
    row.handler_version !== handlerVersion ||
    row.profile_id !== profileId ||
    row.workflow_id !== `processing:${row.id}` ||
    row.queue_name !== 'bench-research' ||
    !['process', 'continue'].includes(row.kind) ||
    manifest.batch_id !== row.batch_id ||
    manifest.profile_id !== profileId ||
    manifest.instruction_sha256 !== instructionDigest ||
    manifest.tool_profile_version !== toolProfileVersion
  ) {
    fail('processing_authority_corrupt')
  }
  return { row, manifest, payload }
}

export function processingInputIsCurrent(
  manifest: ProcessingInputDto,
  snapshot: CaptureSnapshotDto,
) {
  // The dependency closure is retained; changes elsewhere in the batch do not invalidate this subject.
  const current = inputManifest(
    snapshot,
    manifest.subject_id,
    manifest.stage as Stage,
    manifest.dependencies,
    manifest.answer_id,
  )
  current.capture_revision = manifest.capture_revision
  return canonical(current) === canonical(manifest)
}
