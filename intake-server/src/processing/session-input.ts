import {
  validate,
  type AgentSelectionDto,
  type CaptureSnapshotDto,
  type ProcessingInputV6Dto,
} from '@invimport/contracts'
import { automationIntentNotes } from '../capture/context-input.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import {
  decodeProcessingInput,
  fail,
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
    | {
        id: 'native-agent/2' | 'shared-vm-agent/1' | 'shared-vm-agent/2'
        agent: AgentSelectionDto
        settingsRevision: string
      }
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
    agent: profile.id !== 'synthetic-session/1' ? profile.agent : null,
    settings_revision: profile.id !== 'synthetic-session/1' ? profile.settingsRevision : null,
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

/**
 * The batch-level Examine lead session's manifest: every human note and evidence or group note
 * as hints, the whole batch's ready evidence, and no subject.
 */
export function sessionLeadInputManifest(
  snapshot: CaptureSnapshotDto,
  media: RetainedMediaDescriptor,
  profile: Parameters<typeof sessionLotInputManifest>[4],
): ProcessingInputV6Dto {
  const decoded = decodeMediaInputs(
    Buffer.from(media.manifest, 'utf8'),
    Buffer.from(media.sha256, 'hex'),
  )
  if (decoded.batchId !== snapshot.id || decoded.subjectIds.length > 0) {
    fail('processing_media_binding_invalid')
  }
  const mediaNotes = [
    ...(decoded.context?.groups.flatMap((group) => (group.note ? [group.note] : [])) ?? []),
    ...(decoded.context?.evidenceNotes.map((item) => item.note) ?? []),
  ]
    .filter((note) => note.text.trim().length > 0)
    .map((note) => ({
      id: note.id,
      subject_id: null,
      producer: 'human' as const,
      actor_id: note.actor_id,
      created_at: note.created_at,
      text: note.text,
    }))
  const policy = sessionProfiles[profile.id as SessionProfileId]
  const manifest = {
    schema_version: 'bench-intake-input/6',
    batch_id: snapshot.id,
    source_id: snapshot.source_id,
    capture_revision: snapshot.revision,
    stage: 'examine',
    subject_id: null,
    subject: null,
    linked_part: null,
    defaults: snapshot.defaults,
    notes: [...snapshot.notes, ...automationIntentNotes(snapshot), ...mediaNotes],
    observations: snapshot.observations.flatMap((observation) => {
      if (observation.model !== 'part' && observation.model !== 'location') {
        return []
      }
      const { mapping: _mapping, ...frozen } = observation
      return [frozen]
    }),
    profile_id: profile.id,
    instruction_version: policy.instructionVersion,
    instruction_sha256: policy.instructionDigest,
    tool_profile_version: sessionToolProfileVersion,
    media: { ...media },
    agent: profile.id !== 'synthetic-session/1' ? profile.agent : null,
    settings_revision: profile.id !== 'synthetic-session/1' ? profile.settingsRevision : null,
    pinned_proposal_ids: [],
  }
  validate('ProcessingInputV6', manifest)
  return manifest as ProcessingInputV6Dto
}
