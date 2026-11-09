import { Type, type Static } from '@sinclair/typebox'
import { Id, IsoTime, PositivePk, Quantity, Revision } from './scalars.ts'
import { unicodeText } from './unicode-text.ts'
import {
  CaptureEvidenceObservation,
  EvidenceReadings,
  EvidenceRegion,
} from './evidence-observations.ts'
import { InventoryModel, InventoryPartSpec, InventoryMapping, mappedReference } from './effects.ts'
import { RecordChange } from './records.ts'
import {
  CaptureAssignedLocation,
  CaptureAssignedLocationChange,
  CaptureGroupLocation,
  CaptureGroupLocationChange,
} from './capture-location.ts'
import {
  CaptureRef,
  calendarDate,
  captureTags,
  inheritable,
  label,
  note,
  object,
  selection,
} from './capture-primitives.ts'
import {
  CaptureBatchSettingsChange,
  CaptureReferenceDraftRecord,
  CaptureSettingNoteRecord,
  CaptureSettingsIntentRecord,
  captureIntentSchemas,
} from './capture-intent.ts'

export { CaptureRef }
export { tagKey } from './capture-primitives.ts'
export * from './capture-location.ts'

export const CaptureQuantity = inheritable(Quantity)
export const CaptureLocation = inheritable(CaptureRef)
export const CapturePartChoice = Type.Union([
  ...selection(CaptureRef).anyOf,
  object({ mode: Type.Literal('create'), spec: InventoryPartSpec }),
])
export const CaptureDefaults = object({ quantity: CaptureQuantity, location: CaptureLocation })
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
/** Why a lot is left out: one line, as the operator wrote it. */
const ExclusionReason = Type.String({
  minLength: 1,
  maxLength: 500,
  pattern: '^[^\\r\\n\\u2028\\u2029]*$',
})

/** A lot the operator left out of the batch, with why and when. */
export const LotExclusion = object({ reason: ExclusionReason, at: IsoTime })

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
      note_subject_id: Type.Optional(Type.Union([Id, Type.Null()])),
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
    /** Leaves a lot out of the batch with a reason, or includes it again with a null reason. */
    object({
      kind: Type.Literal('lot_exclusion'),
      lot_id: Id,
      reason: Type.Union([ExclusionReason, Type.Null()]),
    }),
    object({
      kind: Type.Literal('part'),
      id: Id,
      label: Type.Optional(label),
      choice: Type.Optional(CapturePartChoice),
      location: Type.Optional(CaptureAssignedLocationChange),
    }),
    CaptureGroupLocationChange,
    object({ kind: Type.Literal('note'), subject_id: Type.Union([Id, Type.Null()]), text: note }),
    CaptureBatchSettingsChange,
    RecordChange,
    /** Creates a region (no `observation_id`) or adjusts one; either marks it operator-edited. */
    object({
      kind: Type.Literal('observation'),
      observation_id: Type.Optional(Id),
      evidence_version_id: Id,
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
      region: EvidenceRegion,
      readings: Type.Optional(EvidenceReadings),
      visible_count: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0, maximum: 1000000 }), Type.Null()]),
      ),
      lot_id: Type.Optional(Type.Union([Id, Type.Null()])),
    }),
    /** Marks an observation as the same physical item as another of its lot; null clears it. */
    object({
      kind: Type.Literal('observation_same_item'),
      observation_id: Id,
      same_as: Type.Union([Id, Type.Null()]),
    }),
    /** Moves an observation to another lot, or out of any lot. */
    object({
      kind: Type.Literal('observation_move'),
      observation_id: Id,
      lot_id: Type.Union([Id, Type.Null()]),
    }),
    /**
     * Resolves a lead-session suggestion: a membership suggestion names its lot; a suggested
     * revision of an observation is named by the suggestion's own id.
     */
    object({
      kind: Type.Literal('observation_suggestion'),
      observation_id: Id,
      lot_id: Type.Optional(Id),
      decision: Type.Union([Type.Literal('accept'), Type.Literal('dismiss')]),
    }),
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
const inboxCount = Type.Integer({ minimum: 0, maximum: 100000 })
const inboxStep = object({ jobs: inboxCount, ready: inboxCount, running: inboxCount })

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
  /** Each step's current jobs, for the batch's stage line; absent before any job exists. */
  steps: Type.Optional(
    object({
      examine: inboxStep,
      research: inboxStep,
      images: inboxStep,
      inventory: inboxStep,
    }),
  ),
  /** The batch's evidence files by what they hold. */
  evidence: Type.Optional(object({ photos: inboxCount, documents: inboxCount, other: inboxCount })),
  /** Observations a lot may count twice (`possibleDuplicates`). */
  possible_duplicates: Type.Optional(inboxCount),
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
  settings_intent: Type.Optional(CaptureSettingsIntentRecord),
  setting_notes: Type.Optional(Type.Array(CaptureSettingNoteRecord, { maxItems: 2 })),
  reference_drafts: Type.Optional(Type.Array(CaptureReferenceDraftRecord, { maxItems: 16 })),
  parts: Type.Array(
    object({
      id: Id,
      label,
      revision: Revision,
      choice: CapturePartChoice,
      /** An application default for the Part's lots, never an InvenTree Part field. */
      location: Type.Optional(CaptureAssignedLocation),
    }),
  ),
  group_locations: Type.Optional(Type.Array(CaptureGroupLocation, { maxItems: 256 })),
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
      /** Present for lots the Examine lead session created; operator lots omit it. */
      origin: Type.Optional(Type.Literal('agent')),
      agent_session_id: Type.Optional(Id),
      /** Present once the operator has changed the lot; the lead session then only suggests. */
      operator_edited: Type.Optional(Type.Literal(true)),
      /** The operator corrected a reading this lot used; the lead session has not looked again. */
      reexamine: Type.Optional(Type.Literal(true)),
      /** Left out of the batch by the operator; included lots omit it. */
      excluded: Type.Optional(LotExclusion),
      /** When the lot was formed; lots formed before it was kept omit it. */
      formed_at: Type.Optional(IsoTime),
      /** The lead session's estimate and its basis; never a counted quantity. */
      estimated_quantity: Type.Optional(Quantity),
      quantity_basis: Type.Optional(unicodeText(1, 512)),
      evidence_observation_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })),
      observation_set_version: Type.Optional(Revision),
    }),
  ),
  /** Items seen in regions of evidence; omitted when the batch has none. */
  evidence_observations: Type.Optional(Type.Array(CaptureEvidenceObservation, { maxItems: 1000 })),
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
  ...captureIntentSchemas,
  CaptureListQuery,
  InboxWorkflow,
  InboxList,
  CaptureRef,
  CaptureQuantity,
  CaptureLocation,
  CaptureAssignedLocation,
  CaptureAssignedLocationChange,
  CaptureGroupLocation,
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
