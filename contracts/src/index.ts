import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { Id, Revision, CursorSequence, Digest, PositivePk, Quantity } from './scalars.ts'
import { captureSchemas } from './capture.ts'
import { manualSchemas } from './manual.ts'
import { mediaSchemas } from './media.ts'
import { processingSchemas } from './processing.ts'
import { researchSchemas } from './research.ts'
export * from './scalars.ts'
export * from './capture.ts'
export * from './manual.ts'
export * from './processing.ts'
export * from './research.ts'
export * from './media.ts'

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
  ...manualSchemas,
  ...processingSchemas,
  ...researchSchemas,
  ...mediaSchemas,
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
ajv.addFormat(
  'int64',
  (value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n,
)
const validators = new Map(
  Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]),
)

export function validate(name: keyof typeof schemas, value: unknown): void {
  if (!validators.get(name)!(value)) {
    throw new Error('invalid_contract')
  }
}
