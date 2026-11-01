import { canonical, strictJson } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingInputDto,
  type ProcessingCommandDto,
  type ProcessingQuestionSpecDto,
  type ProcessingProposalDto,
} from '@invimport/contracts'
import { instructionVersion, instructionDigest, toolProfileVersion } from './policy.ts'
import { sha256, verifyBytes } from '../db/authority.ts'

export const handlerVersion = 'processing/1'

export const profileId = 'synthetic-research/1'

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

/** No clock, stream cursor or browser value contributes authority to an input. */
export function inputManifest(
  snapshot: CaptureSnapshotDto,
  subjectId: string,
  stage: Stage,
  dependencies: string[],
  answerId: string | null,
): ProcessingInputDto {
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
  if (!notes.length) {
    fail('retained_manual_evidence_required', 422)
  }
  return {
    schema_version: 'bench-intake-input/1',
    batch_id: snapshot.id,
    source_id: snapshot.source_id,
    capture_revision: snapshot.revision,
    subject_id: subjectId,
    stage,
    dependencies,
    answer_id: answerId,
    defaults: snapshot.defaults,
    subject: (lot ?? part)!,
    linked_part: linkedPart ?? null,
    notes,
    observations: snapshot.observations,
    profile_id: profileId,
    instruction_version: instructionVersion,
    instruction_sha256: instructionDigest,
    tool_profile_version: toolProfileVersion,
    media: [],
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
