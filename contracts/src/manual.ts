import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, Digest, Revision, PositivePk, Quantity, CursorSequence } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })
const text = Type.String({ maxLength: 256 })
const selected = Type.Array(Id, { minItems: 1, maxItems: 10, uniqueItems: true })
const cursor = object({ stream_id: Id, sequence: CursorSequence })
export const ManualScope = object({ expected_batch_revision: Revision, selected_lot_ids: selected })
export const ManualIssue = object({
  code: Type.String({ pattern: '^[a-z_]{1,64}$' }),
  message: text,
  lot_id: Type.Union([Id, Type.Null()]),
  run_id: Type.Union([Id, Type.Null()]),
})
export const ManualEffect = object({
  lot_id: Id,
  lot_label: text,
  part_id: PositivePk,
  part_label: text,
  quantity: Quantity,
  location_id: Type.Union([PositivePk, Type.Null()]),
  location_label: text,
  contribution_key: Id,
  barcode: text,
})
export const ManualPreview = object({
  id: Id,
  batch_id: Id,
  selected_lot_ids: selected,
  remaining_lot_ids: Type.Array(Id),
  plan_sha256: Digest,
  review_fingerprint: Digest,
  target_revision: Revision,
  capability: Type.Literal('owned-fake-stock/1'),
  effects: Type.Array(ManualEffect, { minItems: 1, maxItems: 10 }),
})
export const ManualPreparationResult = Type.Union([
  object({ status: Type.Literal('prepared'), preparation: ManualPreview }),
  object({
    status: Type.Literal('blocked'),
    issues: Type.Array(ManualIssue, { minItems: 1, maxItems: 100 }),
  }),
])
export const ManualReviewResult = object({ reviewed_subject_ids: Type.Array(Id), cursor })
export const ManualAccepted = object({ run_id: Id, approval_id: Id, preparation_id: Id })
export const ManualRunCommand = object({ expected_run_revision: Revision })
export const ManualRecoveryCommand = object({
  expected_run_revision: Revision,
  operation_keys: selected,
})
export const ManualRun = object({
  run_id: Id,
  approval_id: Id,
  preparation_id: Id,
  batch_id: Id,
  revision: Revision,
  round_number: Revision,
  state: Type.Union(
    (
      [
        'queued',
        'running',
        'stopping',
        'settled_complete',
        'settled_incomplete',
        'recovery_required',
      ] as const
    ).map((value) => Type.Literal(value)),
  ),
  effect_certainty: Type.Union(
    (['none', 'confirmed', 'unknown', 'mixed'] as const).map((value) => Type.Literal(value)),
  ),
  confirmed_stock_ids: Type.Array(PositivePk),
  attributed_stock_ids: Type.Array(PositivePk),
  cancellation_requested: Type.Boolean(),
  dispatch_state: Type.Union(
    (['not_requested', 'queued', 'running', 'finished', 'interrupted'] as const).map((value) =>
      Type.Literal(value),
    ),
  ),
  operations: Type.Array(
    object({
      operation_key: Id,
      lot_id: Id,
      lot_label: text,
      quantity: Quantity,
      certainty: Type.Union(
        (['none', 'confirmed', 'unknown'] as const).map((value) => Type.Literal(value)),
      ),
      remote_pk: Type.Union([PositivePk, Type.Null()]),
      recovery_allowed: Type.Boolean(),
    }),
  ),
  cursor,
})
export const ManualWorkspace = object({
  batch_id: Id,
  revision: Revision,
  supported: Type.Boolean(),
  capability: Type.Union([Type.Literal('owned-fake-stock/1'), Type.Null()]),
  lots: Type.Array(
    object({ lot_id: Id, reviewed: Type.Boolean(), issues: Type.Array(ManualIssue) }),
  ),
  runs: Type.Array(ManualRun),
  preparations: Type.Array(ManualPreview),
  preparations_truncated: Type.Boolean(),
  cursor,
})
export const ManualActivity = object({
  runs: Type.Array(object({ batch_id: Id, run_id: Id, state: ManualRun.properties.state })),
  truncated: Type.Boolean(),
})
export const manualSchemas = {
  ManualScope,
  ManualIssue,
  ManualEffect,
  ManualPreview,
  ManualPreparationResult,
  ManualReviewResult,
  ManualAccepted,
  ManualRunCommand,
  ManualRecoveryCommand,
  ManualRun,
  ManualWorkspace,
  ManualActivity,
}
export type ManualScopeDto = Static<typeof ManualScope>
export type ManualRunCommandDto = Static<typeof ManualRunCommand>
export type ManualRecoveryCommandDto = Static<typeof ManualRecoveryCommand>
export type ManualIssueDto = Static<typeof ManualIssue>
export type ManualEffectDto = Static<typeof ManualEffect>
export type ManualPreviewDto = Static<typeof ManualPreview>
export type ManualPreparationResultDto = Static<typeof ManualPreparationResult>
export type ManualRunDto = Static<typeof ManualRun>
export type ManualWorkspaceDto = Static<typeof ManualWorkspace>
