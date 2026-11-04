import { captureContextNotes, automationIntentNotes } from '../capture/context-input.ts'
import { nativeProfileId, nativeInstructionDigest } from '../agents/policy.ts'
import { canonical, strictJson } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingInputDto,
  type ProcessingInputV1Dto,
  type ProcessingInputV2Dto,
  type ProcessingInputV3Dto,
  type ProcessingInputV4Dto,
  type AgentSettingsDto,
  type ProcessingCommandDto,
  type ProcessingQuestionSpecDto,
  type ProcessingProposalDto,
} from '@invimport/contracts'
import {
  instructionVersion,
  instructionDigest,
  toolProfileVersion,
  mediaInstructionVersion,
  mediaInstructionDigest,
  researchInstructionVersion,
  researchInstructionDigest,
  researchToolProfileVersion,
} from './policy.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { sha256, verifyBytes } from '../db/authority.ts'
import { canonicalSourceUrl } from '../research/source-policy.ts'
import { MAX_RESEARCH_SOURCE_URLS } from '../research/limits.ts'

export const handlerVersion = 'processing/1'

export const profileId = 'synthetic-research/1'

export const mediaHandlerVersion = 'processing/2'

export const mediaProfileId = 'synthetic-research/2'

export const researchHandlerVersion = 'processing/3'

export const researchProfileId = 'restricted-research-stub/1'

export type SelectedProcessingProfile =
  typeof mediaProfileId | typeof researchProfileId | typeof nativeProfileId

export const stageOrder = ['reading', 'identifying', 'research', 'images', 'inventory'] as const

export type Stage = (typeof stageOrder)[number]

export class ProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 409,
  ) {
    super(code)
  }
}

export function fail(code: string, status = 409): never {
  throw new ProcessingError(code, status)
}

export function sealed(value: unknown) {
  const bytes = Buffer.from(canonical(value))
  return { bytes, digest: sha256(bytes) }
}

export function unseal(bytes: Buffer, digest: Buffer): unknown {
  verifyBytes(bytes, digest)
  const value: unknown = strictJson(bytes.toString('utf8'))
  if (canonical(value) !== bytes.toString('utf8')) {
    fail('noncanonical_retained_input')
  }
  return value
}

const MAX_PROCESSING_HUMAN_NOTES = 1000

function requireNoteCapacity(notes: readonly unknown[]) {
  if (notes.length > MAX_PROCESSING_HUMAN_NOTES) {
    fail('processing_input_capacity', 422)
  }
}

/**
 * Processing never consumes locations, so a Part location's value stays out of every sealed input
 * version. The Part edit still bumps the Part revision, making earlier attempts stale as any edit does.
 */
function withoutAssignedLocation<T extends object>(subject: T): T {
  if ('choice' in subject && 'location' in subject) {
    const { location: _location, ...rest } = subject
    return rest as T
  }
  return subject
}

function captureInputFields(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
) {
  const lot = snapshot.lots.find((item) => item.id === subjectId)
  const part = snapshot.parts.find((item) => item.id === subjectId)
  if (!lot && !part) {
    fail('subject_not_found', 404)
  }
  const linkedPart = lot ? snapshot.parts.find((item) => item.id === lot.part_subject_id) : part
  const notes = snapshot.notes.filter(
    (note) =>
      note.subject_id === null ||
      note.subject_id === subjectId ||
      note.subject_id === linkedPart?.id,
  )
  const contextNotes = [
    ...captureContextNotes(snapshot, subjectId),
    ...automationIntentNotes(snapshot),
  ]
  requireNoteCapacity([...notes, ...contextNotes])
  // /1–/3 stay frozen. A create choice is scoped to this subject; newer observation
  // models and mapping fields stay out of the sealed document.
  for (const scoped of [lot ?? part, linkedPart]) {
    if (scoped && 'choice' in scoped && scoped.choice.mode === 'create') {
      fail('unsupported_processing_input')
    }
  }
  return {
    batch_id: snapshot.id,
    source_id: snapshot.source_id,
    capture_revision: snapshot.revision,
    subject_id: subjectId,
    stage,
    dependencies,
    answer_id: answerId,
    defaults: snapshot.defaults,
    subject: withoutAssignedLocation((lot ?? part)!),
    linked_part: linkedPart ? withoutAssignedLocation(linkedPart) : null,
    notes: [...notes, ...contextNotes],
    observations: snapshot.observations.flatMap((observation) => {
      if (observation.model !== 'part' && observation.model !== 'location') {
        return []
      }
      const { mapping: _mapping, ...frozen } = observation
      return [frozen]
    }),
  }
}

/** Legacy constructor preserves the original /1 fields and exact empty-media semantics. */
export function inputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
): ProcessingInputV1Dto {
  const fields = captureInputFields(snapshot, subjectId, stage, dependencies, answerId)
  if (!fields.notes.length) {
    fail('retained_manual_evidence_required', 422)
  }

  return {
    ...fields,
    schema_version: 'bench-intake-input/1',
    profile_id: profileId,
    instruction_version: instructionVersion,
    instruction_sha256: instructionDigest,
    tool_profile_version: toolProfileVersion,
    media: [],
  }
}

export interface RetainedMediaDescriptor {
  manifest: string
  sha256: string
}

/** A lot consumes its linked Part's evidence as well as its own. */
export function processingSubjectScope(snapshot: CaptureSnapshotDto, subjectId: string): string[] {
  const lot = snapshot.lots.find((subject) => subject.id === subjectId)
  const part = snapshot.parts.find((subject) => subject.id === subjectId)
  if (!lot && !part) {
    fail('subject_not_found', 404)
  }

  const subjectIds = new Set([subjectId])
  if (lot?.part_subject_id) {
    subjectIds.add(lot.part_subject_id)
  }

  return [...subjectIds].sort()
}

/** No clock, stream cursor or browser value contributes authority to an input. */
export function mediaInputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
  media: RetainedMediaDescriptor,
): ProcessingInputV2Dto {
  const fields = captureInputFields(snapshot, subjectId, stage, dependencies, answerId)
  const decodedMedia = decodeMediaInputs(
    Buffer.from(media.manifest, 'utf8'),
    Buffer.from(media.sha256, 'hex'),
  )
  const mediaVersion = strictJson(media.manifest) as { version?: string }
  if (
    (mediaVersion.version !== 'media-inputs/1' && mediaVersion.version !== 'media-inputs/3') ||
    decodedMedia.attachments.some((attachment) => attachment.destination === 'part_attachment')
  ) {
    fail('unsupported_processing_input')
  }
  const expectedSubjectIds = processingSubjectScope(snapshot, subjectId)
  const subjectScopeMatches = canonical(decodedMedia.subjectIds) === canonical(expectedSubjectIds)
  if (decodedMedia.batchId !== snapshot.id || !subjectScopeMatches) {
    fail('processing_media_binding_invalid')
  }

  const mediaNotes = [
    ...(decodedMedia.context?.groups.flatMap((group) => (group.note ? [group.note] : [])) ?? []),
    ...(decodedMedia.context?.evidenceNotes.map((item) => item.note) ?? []),
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
  const notes = [...fields.notes, ...mediaNotes]
  requireNoteCapacity(notes)
  const meaningfulNote = notes.some((note) => note.text.trim().length > 0)
  if (!meaningfulNote && decodedMedia.versions.length === 0) {
    fail('retained_evidence_required', 422)
  }

  return {
    ...fields,
    notes,
    schema_version: 'bench-intake-input/2',
    profile_id: mediaProfileId,
    instruction_version: mediaInstructionVersion,
    instruction_sha256: mediaInstructionDigest,
    tool_profile_version: toolProfileVersion,
    media: { ...media },
  }
}

export function approvedResearchSources(values: readonly string[]): string[] {
  if (values.length > MAX_RESEARCH_SOURCE_URLS) {
    fail('processing_source_policy_invalid', 503)
  }
  try {
    return [...new Set(values.map((value) => canonicalSourceUrl(value).href))].sort()
  } catch {
    return fail('processing_source_policy_invalid', 503)
  }
}

export function researchInputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
  media: RetainedMediaDescriptor,
  sourceUrls: readonly string[],
): ProcessingInputV3Dto {
  const fields = mediaInputManifest(snapshot, subjectId, stage, dependencies, answerId, media)
  return {
    ...fields,
    schema_version: 'bench-intake-input/3',
    profile_id: researchProfileId,
    instruction_version: researchInstructionVersion,
    instruction_sha256: researchInstructionDigest,
    tool_profile_version: researchToolProfileVersion,
    source_urls: approvedResearchSources(sourceUrls),
  }
}

/** Integrity and runtime shape checks are separate, both required at each retained-data boundary. */
export function decodeProcessingInput(bytes: Buffer, digest: Buffer): ProcessingInputDto {
  const value = unseal(bytes, digest)
  validate('ProcessingInput', value)
  return value as ProcessingInputDto
}

export function decodeProcessingCommand(bytes: Buffer, digest: Buffer): ProcessingCommandDto {
  const value = unseal(bytes, digest)
  validate('ProcessingCommand', value)
  return value as ProcessingCommandDto
}

export function decodeQuestionSpec(bytes: Buffer, digest: Buffer): ProcessingQuestionSpecDto {
  const value = unseal(bytes, digest)
  validate('ProcessingQuestionSpec', value)
  return value as ProcessingQuestionSpecDto
}

export function decodeProposal(bytes: Buffer, digest: Buffer): ProcessingProposalDto {
  const value = unseal(bytes, digest)
  validate('ProcessingProposal', value)
  return value as ProcessingProposalDto
}

export function nativeInputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
  media: RetainedMediaDescriptor,
  settings: AgentSettingsDto,
): ProcessingInputV4Dto {
  if (!settings.selection || settings.revision === '0') {
    fail('agent_default_required', 422)
  }
  const fields = mediaInputManifest(snapshot, subjectId, stage, dependencies, answerId, media)
  return {
    ...fields,
    schema_version: 'bench-intake-input/4',
    profile_id: nativeProfileId,
    instruction_version: 'native-agent/1',
    instruction_sha256: nativeInstructionDigest,
    tool_profile_version: 'native-no-tools/1',
    agent: settings.selection,
    settings_revision: settings.revision,
  }
}
