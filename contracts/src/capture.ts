import { Type, type Static, type TProperties, type TSchema } from '@sinclair/typebox'
import { Id, PositivePk, Quantity, Revision } from './scalars.ts'

const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false })
const label = Type.String({ minLength: 1, maxLength: 256 })
const note = Type.String({ maxLength: 8192 })
export const CaptureRef = object({ observation_id: Id, target_context_id: Id, model: Type.Union([Type.Literal('part'), Type.Literal('location')]), pk: PositivePk })
const selection = <T extends TSchema>(value: T) => Type.Union([
  object({ mode: Type.Literal('unset') }), object({ mode: Type.Literal('unknown') }), object({ mode: Type.Literal('clear') }),
  object({ mode: Type.Literal('set'), value }),
])
const inheritable = <T extends TSchema>(value: T) => Type.Union([...selection(value).anyOf, object({ mode: Type.Literal('inherit') })])
export const CaptureQuantity = inheritable(Quantity)
export const CaptureLocation = inheritable(CaptureRef)
export const CapturePartChoice = selection(CaptureRef)
export const CaptureDefaults = object({ quantity: CaptureQuantity, location: CaptureLocation })
export const CaptureEdit = object({
  expected_revision: Revision,
  change: Type.Union([
    object({ kind: Type.Literal('batch'), title: Type.Optional(label), archived: Type.Optional(Type.Boolean()) }),
    object({ kind: Type.Literal('defaults'), quantity: Type.Optional(CaptureQuantity), location: Type.Optional(CaptureLocation) }),
    object({ kind: Type.Literal('add_part'), label }),
    object({ kind: Type.Literal('add_lot'), label, note, part_subject_id: Type.Union([Id, Type.Null()]) }),
    object({ kind: Type.Literal('lot'), id: Id, label: Type.Optional(label), part_subject_id: Type.Optional(Type.Union([Id, Type.Null()])), quantity: Type.Optional(CaptureQuantity), location: Type.Optional(CaptureLocation) }),
    object({ kind: Type.Literal('part'), id: Id, label: Type.Optional(label), choice: Type.Optional(CapturePartChoice) }),
    object({ kind: Type.Literal('note'), subject_id: Type.Union([Id, Type.Null()]), text: note }),
  ]),
})
export const CaptureObserve = object({ model: Type.Union([Type.Literal('part'), Type.Literal('location')]), pk: PositivePk })
export const CaptureObservation = object({ id: Id, model: Type.Union([Type.Literal('part'), Type.Literal('location')]), pk: PositivePk, target_context_id: Id, label, observed_at: Type.String() })
export const CaptureSummary = object({ id: Id, source_id: Id, title: label, revision: Revision, archived: Type.Boolean(), updated_at: Type.String() })
export const CaptureList = object({ batches: Type.Array(CaptureSummary), truncated: Type.Boolean() })
export const CaptureSnapshot = object({
  ...CaptureSummary.properties,
  actor_id: Id, target_context_id: Id, defaults: CaptureDefaults,
  parts: Type.Array(object({ id: Id, label, revision: Revision, choice: CapturePartChoice })),
  lots: Type.Array(object({ id: Id, label, revision: Revision, contribution_key: Id, part_subject_id: Type.Union([Id, Type.Null()]), quantity: CaptureQuantity, location: CaptureLocation })),
  notes: Type.Array(object({ id: Id, subject_id: Type.Union([Id, Type.Null()]), text: note, actor_id: Id, created_at: Type.String(), producer: Type.Literal('human') })),
  observations: Type.Array(CaptureObservation),
  cursor: object({ stream_id: Id, sequence: Type.String({ pattern: '^(0|[1-9][0-9]{0,18})$' }) }),
})
export const captureSchemas = { CaptureRef, CaptureQuantity, CaptureLocation, CapturePartChoice, CaptureDefaults, CaptureEdit, CaptureObserve, CaptureObservation, CaptureSummary, CaptureList, CaptureSnapshot }
export type CaptureEditDto = Static<typeof CaptureEdit>
export type CaptureSnapshotDto = Static<typeof CaptureSnapshot>
export type CaptureObservationDto = Static<typeof CaptureObservation>
export type CaptureObserveDto = Static<typeof CaptureObserve>
