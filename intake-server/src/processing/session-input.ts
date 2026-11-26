import {
  STAGE_TOOL_PROFILE,
  validate,
  type AgentSelectionDto,
  type CaptureSnapshotDto,
  type ProcessingInputV6Dto,
  type ProcessingInputV7Dto,
  type SealedBriefDto,
  type SealedMatchDto,
  type SessionInputDto,
} from '@invimport/contracts'
import type { BriefScope } from './brief.ts'
import { automationIntentNotes } from '#/capture/context-input.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import {
  decodeProcessingInput,
  fail,
  mediaInputManifest,
  unseal,
  type RetainedMediaDescriptor,
} from './model.ts'
import { sessionProfiles, type SessionProfileId } from './session-policy.ts'
import { stageOnlyProfile } from './stage-policy.ts'

/** The profile, selection and sealed settings a session input records. */
export type SessionInputProfile =
  | {
      id:
        | 'native-agent/2'
        | 'shared-vm-agent/1'
        | 'shared-vm-agent/2'
        | 'shared-vm-agent/3'
        | 'shared-vm-agent/4'
      agent: AgentSelectionDto
      settingsRevision: string
      /** Sealed with the attempt, so a later save can't change what a queued session reads. */
      partDescriptionStyle?: string
      /** Sealed with the attempt; off for every profile but `shared-vm-agent/3`. */
      web?: { public_pages: boolean; prefer_datasheets: boolean }
    }
  | { id: 'synthetic-session/1' }

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
  profile: SessionInputProfile,
  pinnedProposalIds: readonly string[] = [],
): SessionInputFields {
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
    tool_profile_version: policy.toolProfileVersion,
    media: { ...media },
    agent: profile.id !== 'synthetic-session/1' ? profile.agent : null,
    settings_revision: profile.id !== 'synthetic-session/1' ? profile.settingsRevision : null,
    ...(profile.id !== 'synthetic-session/1' && profile.partDescriptionStyle
      ? { part_description_style: profile.partDescriptionStyle }
      : {}),
    ...(profile.id !== 'synthetic-session/1' && profile.web ? { web: { ...profile.web } } : {}),
    pinned_proposal_ids: [...pinnedProposalIds].sort(),
  }
  return checkedSessionFields(manifest)
}

type WithoutProfile<T> = T extends unknown
  ? Omit<
      T,
      'profile_id' | 'instruction_version' | 'tool_profile_version' | 'agent' | 'settings_revision'
    >
  : never

/**
 * A stage-only profile's session fields: the base of a `/7` input, not a `/6` input. They are
 * checked only as part of the whole `/7` input (`stageInputManifest`).
 */
export type StageOnlyInputFields = WithoutProfile<ProcessingInputV6Dto> & {
  profile_id: 'shared-vm-agent/4'
  instruction_version: 'shared-vm-agent/4'
  tool_profile_version: typeof STAGE_TOOL_PROFILE
  agent: AgentSelectionDto
  settings_revision: string
}

/** What the input builders return: a checked `/6` input, or a stage-only profile's base. */
export type SessionInputFields = ProcessingInputV6Dto | StageOnlyInputFields

/** Checks a session's `/6` fields, except a stage-only profile's, which have no `/6` input. */
function checkedSessionFields(manifest: { profile_id: string }): SessionInputFields {
  if (stageOnlyProfile(manifest.profile_id)) {
    return manifest as StageOnlyInputFields
  }
  validate('ProcessingInputV6', manifest)
  return manifest as ProcessingInputV6Dto
}

/** Builder fields as a `/6` input, which a stage-only profile's never are. */
export function sessionInputV6(fields: SessionInputFields): ProcessingInputV6Dto {
  if (stageOnlyProfile(fields.profile_id)) {
    return fail('unsupported_processing_profile', 422)
  }
  return fields as ProcessingInputV6Dto
}

/** Whether a decoded input is a session's (`/6` or `/7`) rather than an earlier runner's. */
export function isSessionInput(input: { schema_version: string }): input is SessionInputDto {
  return (
    input.schema_version === 'bench-intake-input/6' ||
    input.schema_version === 'bench-intake-input/7'
  )
}

/** A session's sealed input, `/6` or `/7`; the shape check matches the version it names. */
export function decodeSessionInput(bytes: Buffer, digest: Buffer): SessionInputDto {
  const value = unseal(bytes, digest) as { schema_version?: unknown }
  validate(
    value.schema_version === 'bench-intake-input/7' ? 'ProcessingInputV7' : 'ProcessingInputV6',
    value,
  )
  return value as SessionInputDto
}

/** Earlier inputs decode as before; `/6` and `/7` take the session path. */
export function decodeJobInput(bytes: Buffer, digest: Buffer) {
  const value = unseal(bytes, digest) as { schema_version: string }
  if (isSessionInput(value)) {
    return decodeSessionInput(bytes, digest)
  }
  return decodeProcessingInput(bytes, digest)
}

/** A `/7` input: the `/6` fields, the stage pack's digest and the sealed brief. */
export function stageInputManifest(
  base: SessionInputFields,
  stagePackDigest: string,
  brief: SealedBriefDto,
  /** A lot's Match outcome and stage mode; the lead has none. */
  match: SealedMatchDto | undefined,
): ProcessingInputV7Dto {
  const manifest = {
    ...base,
    schema_version: 'bench-intake-input/7',
    tool_profile_version: STAGE_TOOL_PROFILE,
    stage_instructions_sha256: stagePackDigest,
    brief,
    ...(match ? { match } : {}),
  }
  validate('ProcessingInputV7', manifest)
  return manifest as ProcessingInputV7Dto
}

/**
 * What a session's brief draws on from its input: the versions it may fetch (originals only for
 * the Examine lead), the media notes, its pinned identities and its web policy.
 */
export function briefScope(
  input: Pick<
    ProcessingInputV6Dto,
    'stage' | 'subject_id' | 'media' | 'pinned_proposal_ids' | 'web'
  >,
): BriefScope {
  const media = decodeMediaInputs(
    Buffer.from(input.media.manifest, 'utf8'),
    Buffer.from(input.media.sha256, 'hex'),
  )
  const lead = input.stage === 'examine'
  if (input.stage === 'inventory') {
    fail('unsupported_processing_stage', 422)
  }
  return {
    stage: input.stage === 'examine' ? 'examine' : input.stage,
    lotId: input.subject_id,
    versions: media.versions
      .filter((version) => !lead || version.kind === 'original')
      .map((version) => ({
        evidenceId: version.evidenceId,
        versionId: version.versionId,
        digest: version.digest,
        mediaType: version.mediaType,
      })),
    mediaContext: media.context,
    pinnedProposalIds: input.pinned_proposal_ids,
    web: input.web ?? { public_pages: false, prefer_datasheets: false },
  }
}

/**
 * The batch-level Examine lead session's manifest: every human note and evidence or group note
 * as hints, the whole batch's ready evidence, and no subject.
 */
export function sessionLeadInputManifest(
  snapshot: CaptureSnapshotDto,
  media: RetainedMediaDescriptor,
  profile: SessionInputProfile,
): SessionInputFields {
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
    tool_profile_version: policy.toolProfileVersion,
    media: { ...media },
    agent: profile.id !== 'synthetic-session/1' ? profile.agent : null,
    settings_revision: profile.id !== 'synthetic-session/1' ? profile.settingsRevision : null,
    ...(profile.id !== 'synthetic-session/1' && profile.partDescriptionStyle
      ? { part_description_style: profile.partDescriptionStyle }
      : {}),
    ...(profile.id !== 'synthetic-session/1' && profile.web ? { web: { ...profile.web } } : {}),
    pinned_proposal_ids: [],
  }
  return checkedSessionFields(manifest)
}
