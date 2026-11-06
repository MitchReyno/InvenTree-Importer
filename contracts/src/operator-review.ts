import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CaptureLocation, CaptureQuantity } from './capture.ts'
import { CursorSequence, Digest, Id, Quantity, Revision } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const label = Type.String({ minLength: 1, maxLength: 256 })
const message = Type.String({ maxLength: 256 })
const instructionText = Type.String({ maxLength: 8192 })
const cursor = object({ stream_id: Id, sequence: CursorSequence })
const MAX_ACTIVE_LOTS = 100
const MAX_RESTRUCTURE_LOTS = 10

/** A warning can be dismissed with a reason; a blocking issue never can. */
export const OperatorIssueSeverity = Type.Union([Type.Literal('blocking'), Type.Literal('warning')])

export const OperatorIssueDisposition = object({
  id: Id,
  reason: Type.String({ minLength: 1, maxLength: 1024, pattern: '\\S' }),
  actor_id: Id,
  created_at: Type.String(),
})

export const OperatorIssue = object({
  code: Type.String({ pattern: '^[a-z_]{1,64}$' }),
  severity: OperatorIssueSeverity,
  message,
  /** The lot or Part proposal the issue is attached to; null for batch-wide issues. */
  subject_id: Type.Union([Id, Type.Null()]),
  lot_id: Type.Union([Id, Type.Null()]),
  run_id: Type.Union([Id, Type.Null()]),
  /** Warnings bind their dismissal to this subject fact digest. */
  dependency_digest: Type.Union([Digest, Type.Null()]),
  disposition: Type.Union([OperatorIssueDisposition, Type.Null()]),
})

export const OperatorReviewState = Type.Union([
  Type.Literal('unreviewed'),
  Type.Literal('reviewed'),
  Type.Literal('changed_after_review'),
])

export const OperatorLot = object({
  lot_id: Id,
  label,
  part_subject_id: Type.Union([Id, Type.Null()]),
  /** Other active lots sharing this lot's Part proposal. */
  shared_lot_ids: Type.Array(Id, { maxItems: MAX_ACTIVE_LOTS }),
  review_state: OperatorReviewState,
  /** An original contribution approval exists; the lot can no longer be restructured. */
  approved: Type.Boolean(),
  issues: Type.Array(OperatorIssue, { maxItems: 100 }),
  predecessor_lot_ids: Type.Array(Id, { maxItems: MAX_RESTRUCTURE_LOTS }),
})

export const OperatorRetiredLot = object({
  lot_id: Id,
  label,
  action: Type.Union([Type.Literal('split'), Type.Literal('merge')]),
  retired_revision: Revision,
  successor_lot_ids: Type.Array(Id, { minItems: 1, maxItems: MAX_RESTRUCTURE_LOTS }),
})

export const OperatorInstruction = object({
  group_id: Type.Union([Id, Type.Null()]),
  version: Revision,
  text: instructionText,
  actor_id: Id,
  created_at: Type.String(),
})

export const OperatorReview = object({
  batch_id: Id,
  revision: Revision,
  lots: Type.Array(OperatorLot, { maxItems: MAX_ACTIVE_LOTS }),
  retired_lots: Type.Array(OperatorRetiredLot, { maxItems: MAX_ACTIVE_LOTS }),
  /** Latest instruction per batch (null group) or evidence group. */
  instructions: Type.Array(OperatorInstruction, { maxItems: 101 }),
  cursor,
})

export const IssueDisposition = object({
  expected_batch_revision: Revision,
  subject_id: Id,
  code: Type.String({ pattern: '^[a-z_]{1,64}$' }),
  dependency_digest: Digest,
  reason: Type.String({ minLength: 1, maxLength: 1024, pattern: '\\S' }),
})

const lotIds = (minItems: number, maxItems: number) =>
  Type.Array(Id, { minItems, maxItems, uniqueItems: true })

/** Only named fields change; omitted fields keep their exact retained selection. */
export const BulkEdit = object({
  expected_revision: Revision,
  preview: Type.Boolean(),
  lot_ids: lotIds(1, MAX_ACTIVE_LOTS),
  change: Type.Object(
    {
      quantity: Type.Optional(CaptureQuantity),
      location: Type.Optional(CaptureLocation),
    },
    { additionalProperties: false, minProperties: 1 },
  ),
})

export const OperatorImpact = object({
  /** Lots and Part proposals whose current review would no longer match. */
  invalidated_review_subject_ids: Type.Array(Id, { maxItems: 200 }),
  /** Lots whose exact review dependency changes, reviewed or not. */
  affected_lot_ids: Type.Array(Id, { maxItems: MAX_ACTIVE_LOTS }),
  affected_part_ids: Type.Array(Id, { maxItems: MAX_ACTIVE_LOTS }),
  /** Unapproved preparations that would stop being approvable. */
  stale_preparation_ids: Type.Array(Id, { maxItems: 20 }),
  retired_lot_ids: Type.Array(Id, { maxItems: MAX_RESTRUCTURE_LOTS }),
  /** Preview lots have no identity yet; applied results carry their new IDs. */
  created_lots: Type.Array(object({ lot_id: Type.Union([Id, Type.Null()]), label }), {
    maxItems: MAX_RESTRUCTURE_LOTS,
  }),
  created_part: Type.Union([
    object({ part_id: Type.Union([Id, Type.Null()]), label }),
    Type.Null(),
  ]),
})

const operatorOutcome = object({
  status: Type.Union([Type.Literal('previewed'), Type.Literal('applied')]),
  /** Current revision for a preview; the new revision once applied. */
  revision: Revision,
  impact: OperatorImpact,
})

export const BulkEditResult = operatorOutcome

/** A child may take some of the lot's observations; the rest stay with the retired lot. */
const splitChild = object({
  label,
  quantity: Quantity,
  observation_ids: Type.Optional(Type.Array(Id, { maxItems: 100, uniqueItems: true })),
})

const moveDestination = Type.Union([
  object({ kind: Type.Literal('existing'), part_subject_id: Id }),
  object({ kind: Type.Literal('new'), label }),
  object({ kind: Type.Literal('none') }),
])

export const Restructure = object({
  expected_revision: Revision,
  preview: Type.Boolean(),
  change: Type.Union([
    object({
      kind: Type.Literal('split_lot'),
      lot_id: Id,
      children: Type.Array(splitChild, { minItems: 2, maxItems: MAX_RESTRUCTURE_LOTS }),
    }),
    object({
      kind: Type.Literal('merge_lots'),
      lot_ids: lotIds(2, MAX_RESTRUCTURE_LOTS),
      label,
      quantity: Quantity,
      part_subject_id: Type.Union([Id, Type.Null()]),
      /** Merging asserts the rows are one physical contribution, not merely the same Part. */
      confirm_same_physical_contribution: Type.Literal(true),
    }),
    object({
      kind: Type.Literal('move_lots'),
      lot_ids: lotIds(1, MAX_ACTIVE_LOTS),
      destination: moveDestination,
    }),
  ]),
})

export const RestructureResult = operatorOutcome

export const InstructionEdit = object({
  expected_revision: Revision,
  group_id: Type.Union([Id, Type.Null()]),
  text: instructionText,
})

export const operatorReviewSchemas = {
  OperatorIssueSeverity,
  OperatorIssueDisposition,
  OperatorIssue,
  OperatorReviewState,
  OperatorLot,
  OperatorRetiredLot,
  OperatorInstruction,
  OperatorReview,
  IssueDisposition,
  BulkEdit,
  OperatorImpact,
  BulkEditResult,
  Restructure,
  RestructureResult,
  InstructionEdit,
}

export type OperatorIssueDto = Static<typeof OperatorIssue>
export type OperatorLotDto = Static<typeof OperatorLot>
export type OperatorReviewDto = Static<typeof OperatorReview>
export type OperatorImpactDto = Static<typeof OperatorImpact>
export type IssueDispositionDto = Static<typeof IssueDisposition>
export type BulkEditDto = Static<typeof BulkEdit>
export type BulkEditResultDto = Static<typeof BulkEditResult>
export type RestructureDto = Static<typeof Restructure>
export type RestructureResultDto = Static<typeof RestructureResult>
/** Bulk edits and restructures share one previewed/applied outcome shape. */
export type OperatorOutcomeDto = Static<typeof operatorOutcome>
export type InstructionEditDto = Static<typeof InstructionEdit>
