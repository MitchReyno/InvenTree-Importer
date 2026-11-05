import {
  validate,
  type AgentSelectionDto,
  type CaptureSnapshotDto,
  type ProcessingInputV6Dto,
} from '@invimport/contracts'
import {
  decodeProcessingInput,
  mediaInputManifest,
  unseal,
  type RetainedMediaDescriptor,
} from './model.ts'
import {
  sessionProfiles,
  sessionToolProfileVersion,
  type SessionProfileId,
} from './session-policy.ts'

export type SessionLotStage = 'research' | 'images' | 'inventory'

/**
 * A per-lot session's opening manifest. It reuses the `/2` media manifest checks (subject
 * scope, evidence notes, retained evidence) and seals what the session may cite at start.
 */
export function sessionLotInputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: SessionLotStage,
  media: RetainedMediaDescriptor,
  profile:
    | { id: 'native-agent/2'; agent: AgentSelectionDto; settingsRevision: string }
    | { id: 'synthetic-session/1' },
  pinnedProposalIds: readonly string[] = [],
): ProcessingInputV6Dto {
  const fields = mediaInputManifest(snapshot, subjectId, stage, [], null, media, {
    allowCreate: true,
  })
  const policy = sessionProfiles[profile.id as SessionProfileId]
  const manifest = {
    schema_version: 'bench-intake-input/6',
    batch_id: fields.batch_id,
    source_id: fields.source_id,
    capture_revision: fields.capture_revision,
    stage,
    subject_id: subjectId,
    subject: fields.subject,
    linked_part: fields.linked_part,
    defaults: fields.defaults,
    notes: fields.notes,
    observations: fields.observations,
    profile_id: profile.id,
    instruction_version: policy.instructionVersion,
    instruction_sha256: policy.instructionDigest,
    tool_profile_version: sessionToolProfileVersion,
    media: { ...media },
    agent: profile.id === 'native-agent/2' ? profile.agent : null,
    settings_revision: profile.id === 'native-agent/2' ? profile.settingsRevision : null,
    pinned_proposal_ids: [...pinnedProposalIds].sort(),
  }
  validate('ProcessingInputV6', manifest)
  return manifest as ProcessingInputV6Dto
}

export function decodeSessionInput(bytes: Buffer, digest: Buffer): ProcessingInputV6Dto {
  const value = unseal(bytes, digest)
  validate('ProcessingInputV6', value)
  return value as ProcessingInputV6Dto
}

/** Earlier inputs decode as before; only `/6` takes the session path. */
export function decodeJobInput(bytes: Buffer, digest: Buffer) {
  const value = unseal(bytes, digest) as { schema_version?: unknown }
  if (value.schema_version === 'bench-intake-input/6') {
    return decodeSessionInput(bytes, digest)
  }
  return decodeProcessingInput(bytes, digest)
}
