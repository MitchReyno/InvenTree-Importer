import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { copyValidationIssues } from './validation-issues.ts'
export type { ValidationIssue } from './validation-issues.ts'
import { Ajv2020 } from 'ajv/dist/2020.js'
import {
  Id,
  Revision,
  CursorSequence,
  Digest,
  PositivePk,
  Quantity,
  validInt64,
} from './scalars.ts'
import { effectsSchemas } from './effects.ts'
export * from './effects.ts'
import { headerSchemas } from './header.ts'
export * from './header.ts'
import { attentionSchemas } from './attention.ts'
export * from './attention.ts'
import { captureSchemas } from './capture.ts'
import { recordSchemas } from './records.ts'
import { catalogueSchemas } from './catalogue.ts'
import { manualSchemas } from './manual.ts'
import { preparationTreeSchemas } from './preparation-tree.ts'
export * from './preparation-tree.ts'
import { mediaSchemas } from './media.ts'
import { processingSchemas } from './processing.ts'
import { operatorReviewSchemas } from './operator-review.ts'
import { researchSchemas } from './research.ts'
import { agentSchemas } from './agents.ts'
export * from './agents.ts'
import { liveSchemas } from './live.ts'
import { sessionFailureSchemas } from './session-failures.ts'
export * from './session-failures.ts'
import { sessionSchemas } from './sessions.ts'
import { evidenceObservationSchemas } from './evidence-observations.ts'
export * from './evidence-observations.ts'
export * from './sessions.ts'
export * from './live.ts'
export * from './scalars.ts'
export * from './capture.ts'
export * from './records.ts'
export * from './records-projection.ts'
export * from './catalogue-assessment.ts'
export * from './capture-intent.ts'
export * from './catalogue.ts'
export * from './manual.ts'
export * from './processing.ts'
export * from './value-evidence.ts'
export * from './research.ts'
export * from './media.ts'
export * from './operator-review.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const Label = Type.String({ minLength: 1, maxLength: 256 })
const Selection = Type.Union([
  object({ mode: Type.Literal('inherit') }),
  object({ mode: Type.Literal('clear') }),
  object({ mode: Type.Literal('set'), value: Quantity }),
])

const reference = (model: 'part' | 'location') =>
  object({ target_context_id: Id, model: Type.Literal(model), pk: PositivePk, observation_id: Id })

export const BatchCreate = object({ title: Label, note: Type.String({ maxLength: 8192 }) })
export const LotCreate = object({
  expected_batch_revision: Revision,
  label: Label,
  note: Type.String({ maxLength: 8192 }),
  part_subject_id: Type.Union([Id, Type.Null()]),
})
export const PartSelection = object({ expected_revision: Revision, choice: reference('part') })
export const LotSelection = object({
  expected_revision: Revision,
  quantity: Type.Optional(Selection),
  location: Type.Optional(
    Type.Union([
      object({ mode: Type.Literal('inherit') }),
      object({ mode: Type.Literal('clear') }),
      object({ mode: Type.Literal('set'), value: reference('location') }),
    ]),
  ),
})
const selected = Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true })
export const Preparation = object({ expected_batch_revision: Revision, selected_lot_ids: selected })
export const Approval = object({
  preparation_id: Id,
  expected_plan_sha256: Digest,
  expected_review_fingerprint: Digest,
  selected_lot_ids: selected,
  expected_target_revision: Revision,
})
export const Cancellation = object({ expected_run_revision: Revision })
export const RunSnapshot = object({
  run_id: Id,
  revision: Revision,
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
  cursor: object({ stream_id: Id, sequence: CursorSequence }),
})
const workerBinding = {
  schema_version: Type.Literal('bench-intake-worker/1'),
  command_id: Id,
  attempt_id: Id,
  input_sha256: Digest,
  handler_version: Label,
  sequence: Revision,
}
export const WorkerEnvelope = Type.Union(
  [
    object({
      ...workerBinding,
      kind: Type.Literal('progress'),
      payload: object({ state: Type.Literal('running') }),
    }),
    object({
      ...workerBinding,
      kind: Type.Literal('terminal'),
      payload: object({
        state: Type.Union([Type.Literal('interrupted'), Type.Literal('completed')]),
      }),
    }),
  ],
  { $schema: 'https://json-schema.org/draft/2020-12/schema' },
)
export const ErrorDto = object({
  code: Type.String({ pattern: '^[a-z_]{1,64}$' }),
  message: Type.String({ maxLength: 256 }),
  recovery: Type.Union(
    (['refresh', 'wait', 'review', 'none'] as const).map((value) => Type.Literal(value)),
  ),
  correlation_id: Type.String({ maxLength: 64 }),
})
export const Bootstrap = object({
  mode: Type.Literal('development-key'),
  banner: Type.Literal('Single-operator development mode — not a verified human session'),
  status: Type.Union([Type.Literal('configured'), Type.Literal('setup_required')]),
  actor_id: Id,
  target_id: Id,
  target_context_id: Id,
  mutation_enabled: Type.Literal(false),
  media_enabled: Type.Optional(Type.Boolean()),
  permission_gate: Type.Literal('deferred_T11'),
  csrf_token: Type.Union([Digest, Type.Null()]),
})
export const Health = object({
  status: Type.Literal('ok'),
  api_version: Type.Literal('bench-intake-app/1'),
})
export const schemas = {
  BatchCreate,
  LotCreate,
  PartSelection,
  LotSelection,
  Preparation,
  Approval,
  Cancellation,
  RunSnapshot,
  WorkerEnvelope,
  ErrorDto,
  Bootstrap,
  Health,
  ...captureSchemas,
  ...recordSchemas,
  ...catalogueSchemas,
  ...headerSchemas,
  ...attentionSchemas,
  ...effectsSchemas,
  ...manualSchemas,
  ...preparationTreeSchemas,
  ...processingSchemas,
  ...operatorReviewSchemas,
  ...researchSchemas,
  ...mediaSchemas,
  ...liveSchemas,
  ...agentSchemas,
  ...sessionSchemas,
  ...sessionFailureSchemas,
  ...evidenceObservationSchemas,
}
export type BootstrapDto = Static<typeof Bootstrap>
export type ApprovalDto = Static<typeof Approval>

// Public failures deliberately expose no diagnostic list; stop on the first error.
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
})
ajv.addFormat('int64', validInt64)
const validators = new Map(
  Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]),
)

export function validate(name: keyof typeof schemas, value: unknown): void {
  if (!validators.get(name)!(value)) {
    throw new Error('invalid_contract')
  }
}

/** Copies bounded schema issues immediately; existing validate callers keep their error contract. */
export function validationIssues(name: keyof typeof schemas, value: unknown) {
  const validator = validators.get(name)!
  if (validator(value)) {
    return []
  }
  return copyValidationIssues(schemas[name], validator.errors ?? [])
}
