import { Type, type Static, type TProperties, type TSchema } from '@sinclair/typebox'
import { Id, PositivePk, Quantity, Revision } from './scalars.ts'
import { InventoryModel, InventoryPartSpec, InventoryMapping, mappedReference } from './effects.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const label = Type.String({ minLength: 1, maxLength: 256 })
const note = Type.String({ maxLength: 8192 })
export const CaptureRef = object({
  observation_id: Id,
  target_context_id: Id,
  model: Type.Union([Type.Literal('part'), Type.Literal('location')]),
  pk: PositivePk,
})

const selection = <T extends TSchema>(value: T) =>
  Type.Union([
    object({ mode: Type.Literal('unset') }),
    object({ mode: Type.Literal('unknown') }),
    object({ mode: Type.Literal('clear') }),
    object({ mode: Type.Literal('set'), value }),
  ])

const inheritable = <T extends TSchema>(value: T) =>
  Type.Union([...selection(value).anyOf, object({ mode: Type.Literal('inherit') })])

export const CaptureQuantity = inheritable(Quantity)
export const CaptureLocation = inheritable(CaptureRef)
export const CapturePartChoice = Type.Union([
  ...selection(CaptureRef).anyOf,
  object({ mode: Type.Literal('create'), spec: InventoryPartSpec }),
])
export const CaptureDefaults = object({ quantity: CaptureQuantity, location: CaptureLocation })
const calendarDate = Type.String({ pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}(?![\\s\\S])' })
const captureTags = Type.Array(Type.String({ minLength: 1, maxLength: 100, pattern: '[^\\s]' }), {
  maxItems: 32,
  uniqueItems: true,
})
export const CaptureContext = object({
  supplier: selection(mappedReference('company')),
  purchase_date: selection(calendarDate),
  tags: selection(captureTags),
})
export const CaptureLotContext = object({
  supplier: inheritable(mappedReference('company')),
  purchase_date: inheritable(calendarDate),
  tags: inheritable(captureTags),
})
export const CaptureContextRecord = object({
  id: Id,
  subject_id: Type.Union([Id, Type.Null()]),
  version: Revision,
  value: CaptureLotContext,
  actor_id: Id,
  created_at: Type.String(),
})
export const CaptureEdit = object({
  expected_revision: Revision,
  change: Type.Union([
    object({
      kind: Type.Literal('settings'),
      title: Type.Optional(label),
      quantity: Type.Optional(CaptureQuantity),
      location: Type.Optional(CaptureLocation),
      context: Type.Optional(CaptureContext),
      note: Type.Optional(note),
    }),
    object({
      kind: Type.Literal('batch'),
      title: Type.Optional(label),
      archived: Type.Optional(Type.Boolean()),
    }),
    object({
      kind: Type.Literal('defaults'),
      quantity: Type.Optional(CaptureQuantity),
      location: Type.Optional(CaptureLocation),
    }),
    object({ kind: Type.Literal('add_part'), label }),
    object({
      kind: Type.Literal('add_lot'),
      label,
      note,
      part_subject_id: Type.Union([Id, Type.Null()]),
    }),
    object({
      kind: Type.Literal('lot'),
      id: Id,
      label: Type.Optional(label),
      part_subject_id: Type.Optional(Type.Union([Id, Type.Null()])),
      context: Type.Optional(CaptureLotContext),
      quantity: Type.Optional(CaptureQuantity),
      location: Type.Optional(CaptureLocation),
    }),
    object({
      kind: Type.Literal('part'),
      id: Id,
      label: Type.Optional(label),
      choice: Type.Optional(CapturePartChoice),
    }),
    object({ kind: Type.Literal('note'), subject_id: Type.Union([Id, Type.Null()]), text: note }),
  ]),
})
export const CaptureObserve = object({
  model: InventoryModel,
  pk: PositivePk,
})
export const CaptureObservation = object({
  id: Id,
  model: InventoryModel,
  mapping: Type.Optional(InventoryMapping),
  pk: PositivePk,
  target_context_id: Id,
  label,
  observed_at: Type.String(),
})
export const CaptureListQuery = object({
  q: Type.Optional(Type.String({ maxLength: 256 })),
  archived: Type.Optional(Type.Union([Type.Literal('include'), Type.Literal('exclude')])),
  offset: Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,5})$' })),
})
export const InboxWorkflow = object({
  lots: Type.Integer({ minimum: 0 }),
  ready: Type.Integer({ minimum: 0 }),
  needs_review: Type.Integer({ minimum: 0 }),
  blocked: Type.Integer({ minimum: 0 }),
  approved: Type.Integer({ minimum: 0 }),
  open_questions: Type.Integer({ minimum: 0 }),
  active_jobs: Type.Integer({ minimum: 0 }),
  latest_round: Type.Union([
    Type.Null(),
    object({
      run_id: Id,
      round_number: Revision,
      state: Type.String({ maxLength: 64 }),
      confirmed_stock: Type.Integer({ minimum: 0 }),
    }),
  ]),
  thumbnail: Type.Union([Type.Null(), object({ preview_id: Id, label })]),
})
export const CaptureSummary = object({
  id: Id,
  source_id: Id,
  title: label,
  revision: Revision,
  archived: Type.Boolean(),
  updated_at: Type.String(),
})
export const InboxList = object({
  batches: Type.Array(object({ ...CaptureSummary.properties, workflow: InboxWorkflow })),
  truncated: Type.Boolean(),
})
export const CaptureList = object({
  batches: Type.Array(CaptureSummary),
  truncated: Type.Boolean(),
})
export const CaptureSnapshot = object({
  ...CaptureSummary.properties,
  actor_id: Id,
  target_context_id: Id,
  defaults: CaptureDefaults,
  context: Type.Optional(Type.Array(CaptureContextRecord, { maxItems: 101 })),
  parts: Type.Array(object({ id: Id, label, revision: Revision, choice: CapturePartChoice })),
  lots: Type.Array(
    object({
      id: Id,
      label,
      revision: Revision,
      contribution_key: Id,
      part_subject_id: Type.Union([Id, Type.Null()]),
      quantity: CaptureQuantity,
      location: CaptureLocation,
      /** Server-projected: split or merged before approval; kept as history. Active lots omit it. */
      retired: Type.Optional(Type.Literal(true)),
    }),
  ),
  notes: Type.Array(
    object({
      id: Id,
      subject_id: Type.Union([Id, Type.Null()]),
      text: note,
      actor_id: Id,
      created_at: Type.String(),
      producer: Type.Literal('human'),
    }),
  ),
  observations: Type.Array(CaptureObservation),
  cursor: object({ stream_id: Id, sequence: Type.String({ pattern: '^(0|[1-9][0-9]{0,18})$' }) }),
})
export type CaptureListQueryDto = Static<typeof CaptureListQuery>
export type InboxWorkflowDto = Static<typeof InboxWorkflow>
export type InboxListDto = Static<typeof InboxList>

export const captureSchemas = {
  CaptureListQuery,
  InboxWorkflow,
  InboxList,
  CaptureRef,
  CaptureQuantity,
  CaptureLocation,
  CapturePartChoice,
  CaptureDefaults,
  CaptureContext,
  CaptureLotContext,
  CaptureContextRecord,
  CaptureEdit,
  CaptureObserve,
  CaptureObservation,
  CaptureSummary,
  CaptureList,
  CaptureSnapshot,
}
export type CaptureEditDto = Static<typeof CaptureEdit>
export type CaptureSnapshotDto = Static<typeof CaptureSnapshot>
export type CaptureObservationDto = Static<typeof CaptureObservation>
export type CaptureObserveDto = Static<typeof CaptureObserve>

export type CaptureContextDto = Static<typeof CaptureContext>
export type CaptureLotContextDto = Static<typeof CaptureLotContext>
export type CaptureContextRecordDto = Static<typeof CaptureContextRecord>
