import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, Quantity, Revision } from './scalars.ts'
import { unicodeText } from './unicode-text.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const pixel = Type.Integer({ minimum: 0, maximum: 24000000 })
const dimension = Type.Integer({ minimum: 1, maximum: 24000000 })
const line = Type.Integer({ minimum: 1, maximum: 100000 })
const label = unicodeText(1, 256)

/**
 * Pixels use the documentary-crop geometry on the `media_preview` render of the page. A line
 * range cites document lines; previews carry no line metadata, so only its order is checked.
 */
export const EvidenceRegion = Type.Union([
  object({
    kind: Type.Literal('pixels'),
    x: pixel,
    y: pixel,
    width: dimension,
    height: dimension,
    source_width: dimension,
    source_height: dimension,
  }),
  object({ kind: Type.Literal('lines'), from_line: line, to_line: line }),
])

/** What the region shows: markings and label text. */
export const EvidenceReadings = object({
  markings: Type.Array(label, { maxItems: 32 }),
  text: Type.Optional(unicodeText(1, 2048)),
})

export const EvidenceObservationStatus = Type.Union([
  Type.Literal('active'),
  Type.Literal('suggested'),
])

export const CaptureEvidenceObservation = object({
  id: Id,
  evidence_version_id: Id,
  page: Type.Integer({ minimum: 1, maximum: 10000 }),
  region: EvidenceRegion,
  readings: EvidenceReadings,
  visible_count: Type.Union([Type.Integer({ minimum: 0, maximum: 1000000 }), Type.Null()]),
  status: EvidenceObservationStatus,
  /** A suggestion names the operator-edited observation it would revise. */
  supersedes_observation_id: Type.Union([Id, Type.Null()]),
  origin: Type.Union([Type.Literal('agent'), Type.Literal('operator')]),
  agent_session_id: Type.Union([Id, Type.Null()]),
  operator_edited: Type.Boolean(),
  revision: Revision,
  /** The lot this observation is an active member of, if any. */
  lot_id: Type.Union([Id, Type.Null()]),
  /** Lots the lead session suggested it for; the operator accepts or dismisses each. */
  suggested_lot_ids: Type.Array(Id, { maxItems: 100 }),
})

const baseRevision = { base_revision: Revision }

/** Records a new observation, or revises the AI observation named by `observation_id`. */
export const RecordObservationArgs = object({
  ...baseRevision,
  observation_id: Type.Optional(Id),
  evidence_version_id: Id,
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  region: EvidenceRegion,
  readings: EvidenceReadings,
  visible_count: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
})

/** A lot shares an existing Part, or names a new draft Part for the lead session to create. */
export const ProposedLotPart = Type.Union([object({ part_subject_id: Id }), object({ label })])

/** Creates a draft lot, or extends the AI lot named by `lot_id`. Quantities are estimates only. */
export const ProposeLotArgs = object({
  ...baseRevision,
  lot_id: Type.Optional(Id),
  label: Type.Optional(label),
  observation_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
  part: Type.Optional(ProposedLotPart),
  estimated_quantity: Type.Optional(Quantity),
  quantity_basis: Type.Optional(unicodeText(1, 512)),
})

/** Moves observations between AI lots. */
export const RegroupArgs = object({
  ...baseRevision,
  moves: Type.Array(object({ observation_id: Id, to_lot_id: Id }), {
    minItems: 1,
    maxItems: 100,
  }),
})

/** What the lead session sees of its batch: the revision to pass as base_revision, and its rows. */
export const LeadBatchView = object({
  revision: Revision,
  lots: Type.Array(
    object({
      id: Id,
      label,
      origin: Type.Union([Type.Literal('agent'), Type.Literal('operator')]),
      operator_edited: Type.Boolean(),
      retired: Type.Boolean(),
      part_subject_id: Type.Union([Id, Type.Null()]),
      estimated_quantity: Type.Union([Quantity, Type.Null()]),
      observation_ids: Type.Array(Id, { maxItems: 100 }),
      suggested_observation_ids: Type.Array(Id, { maxItems: 1000 }),
    }),
    { maxItems: 101 },
  ),
  parts: Type.Array(object({ id: Id, label }), { maxItems: 101 }),
  observations: Type.Array(
    object({
      id: Id,
      evidence_version_id: Id,
      page: Type.Integer({ minimum: 1, maximum: 10000 }),
      region: EvidenceRegion,
      markings: Type.Array(label, { maxItems: 32 }),
      visible_count: Type.Union([Type.Integer({ minimum: 0, maximum: 1000000 }), Type.Null()]),
      status: EvidenceObservationStatus,
      supersedes_observation_id: Type.Union([Id, Type.Null()]),
      lot_id: Type.Union([Id, Type.Null()]),
      operator_edited: Type.Boolean(),
    }),
    { maxItems: 1000 },
  ),
})
export const SessionReadBatchArgs = object({})

/** The current state of a row that made a lot-forming call stale or turned it into a suggestion. */
export const LotFormingConflict = object({
  kind: Type.Union([Type.Literal('observation'), Type.Literal('lot')]),
  id: Id,
  reason: Type.Union([
    Type.Literal('changed'),
    Type.Literal('operator_edited'),
    Type.Literal('retired'),
    Type.Literal('missing'),
  ]),
  revision: Type.Union([Revision, Type.Null()]),
  /** For an observation: the lot it is an active member of now. */
  lot_id: Type.Optional(Type.Union([Id, Type.Null()])),
  operator_edited: Type.Optional(Type.Boolean()),
})

export const evidenceObservationSchemas = {
  EvidenceRegion,
  EvidenceReadings,
  CaptureEvidenceObservation,
  RecordObservationArgs,
  ProposeLotArgs,
  RegroupArgs,
  LotFormingConflict,
  LeadBatchView,
  SessionReadBatchArgs,
}

export type EvidenceRegionDto = Static<typeof EvidenceRegion>
export type EvidenceReadingsDto = Static<typeof EvidenceReadings>
export type CaptureEvidenceObservationDto = Static<typeof CaptureEvidenceObservation>
export type RecordObservationArgsDto = Static<typeof RecordObservationArgs>
export type ProposeLotArgsDto = Static<typeof ProposeLotArgs>
export type RegroupArgsDto = Static<typeof RegroupArgs>
export type LotFormingConflictDto = Static<typeof LotFormingConflict>
export type LeadBatchViewDto = Static<typeof LeadBatchView>
