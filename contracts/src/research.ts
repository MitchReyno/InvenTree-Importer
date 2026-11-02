import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, PositivePk, Revision } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const byteCount = Type.String({ pattern: '^[1-9][0-9]{0,6}(?![\\s\\S])' })
const mediaType = Type.Union(
  ['image/png', 'image/jpeg', 'application/pdf', 'text/html', 'text/plain', 'application/json'].map(
    (value) => Type.Literal(value),
  ),
)

export const ResearchReceiptSource = object({
  kind: Type.Literal('research_receipt'),
  receipt_id: Id,
  sha256: Digest,
})

export const ResearchEvidenceRead = object({
  version_id: Id,
  sha256: Digest,
  offset: CursorSequence,
  length: byteCount,
})

export const ResearchSourceFetch = object({
  url: Type.String({ minLength: 1, maxLength: 2048 }),
})

export const ResearchReceiptRead = object({
  receipt_id: Id,
  sha256: Digest,
  offset: CursorSequence,
  length: byteCount,
})

export const ResearchInventoryLookup = object({
  model: Type.Union([Type.Literal('part'), Type.Literal('location')]),
  pk: PositivePk,
})

export const ResearchReceipt = object({
  id: Id,
  kind: Type.Union([Type.Literal('web'), Type.Literal('inventory')]),
  sha256: Digest,
  byte_size: Revision,
  media_type: mediaType,
  source_url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
})

export const ResearchReceiptDescriptor = object({
  schema_version: Type.Literal('bench-intake-research-receipt/1'),
  batch_id: Id,
  attempt_id: Id,
  command_id: Id,
  actor_id: Id,
  target_id: Id,
  target_context_id: Id,
  input_sha256: Digest,
  request_id: Id,
  request_sha256: Digest,
  receipt: ResearchReceipt,
})

export const ResearchEvidenceChunk = object({
  evidence_id: Id,
  version_id: Id,
  sha256: Digest,
  byte_size: Revision,
  media_type: mediaType,
  offset: CursorSequence,
  bytes_base64: Type.String({ minLength: 1, maxLength: 131072 }),
})

export const ResearchSourceChunk = object({
  receipt: ResearchReceipt,
  offset: CursorSequence,
  bytes_base64: Type.String({ minLength: 1, maxLength: 131072 }),
})

export const ResearchInventoryObservation = object({
  model: Type.Union([Type.Literal('part'), Type.Literal('location')]),
  pk: PositivePk,
  label: Type.String({ minLength: 1, maxLength: 256 }),
})

export const ResearchInventoryResult = object({
  receipt: ResearchReceipt,
  observation: ResearchInventoryObservation,
})

export const researchSchemas = {
  ResearchReceiptSource,
  ResearchEvidenceRead,
  ResearchSourceFetch,
  ResearchReceiptRead,
  ResearchInventoryLookup,
  ResearchReceipt,
  ResearchReceiptDescriptor,
  ResearchEvidenceChunk,
  ResearchSourceChunk,
  ResearchInventoryObservation,
  ResearchInventoryResult,
}

export type ResearchReceiptSourceDto = Static<typeof ResearchReceiptSource>
export type ResearchEvidenceReadDto = Static<typeof ResearchEvidenceRead>
export type ResearchSourceFetchDto = Static<typeof ResearchSourceFetch>
export type ResearchReceiptReadDto = Static<typeof ResearchReceiptRead>
export type ResearchInventoryLookupDto = Static<typeof ResearchInventoryLookup>
export type ResearchReceiptDto = Static<typeof ResearchReceipt>
export type ResearchReceiptDescriptorDto = Static<typeof ResearchReceiptDescriptor>
export type ResearchEvidenceChunkDto = Static<typeof ResearchEvidenceChunk>
export type ResearchSourceChunkDto = Static<typeof ResearchSourceChunk>
export type ResearchInventoryObservationDto = Static<typeof ResearchInventoryObservation>
export type ResearchInventoryResultDto = Static<typeof ResearchInventoryResult>
