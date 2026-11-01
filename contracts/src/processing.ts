import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureSnapshot } from './capture.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const text = Type.String({ minLength: 1, maxLength: 2048 })
const stages = ['reading', 'identifying', 'research', 'images', 'inventory'] as const
export const ProcessingStage = Type.Union(stages.map((stage) => Type.Literal(stage)))
export const ProcessingState = Type.Union(
  (
    [
      'queued',
      'running',
      'waiting_for_user',
      'waiting_for_login',
      'waiting_for_capacity',
      'ready',
      'failed',
      'cancelled',
      'superseded',
      'interrupted',
    ] as const
  ).map((state) => Type.Literal(state)),
)
export const ProcessingStart = object({
  schema_version: Type.Literal('bench-intake-processing/1'),
  expected_capture_revision: Revision,
  subject_ids: Type.Array(Id, { minItems: 1, maxItems: 20, uniqueItems: true }),
  stages: Type.Array(ProcessingStage, { minItems: 1, maxItems: 5, uniqueItems: true }),
})
export const ProcessingInput = object({
  schema_version: Type.Literal('bench-intake-input/1'),
  batch_id: Id,
  source_id: Id,
  capture_revision: Revision,
  subject_id: Id,
  stage: ProcessingStage,
  dependencies: Type.Array(Id, { maxItems: 5, uniqueItems: true }),
  answer_id: Type.Union([Id, Type.Null()]),
  defaults: CaptureDefaults,
  subject: Type.Union([
    CaptureSnapshot.properties.lots.items,
    CaptureSnapshot.properties.parts.items,
  ]),
  linked_part: Type.Union([CaptureSnapshot.properties.parts.items, Type.Null()]),
  notes: Type.Array(CaptureSnapshot.properties.notes.items, { minItems: 1, maxItems: 1000 }),
  observations: CaptureSnapshot.properties.observations,
  profile_id: Type.Literal('synthetic-research/1'),
  instruction_version: Type.Literal('restricted-synthetic/1'),
  instruction_sha256: Digest,
  tool_profile_version: Type.Literal('restricted-no-tools/1'),
  media: Type.Array(Id, { maxItems: 0 }),
})
export const ProcessingCommand = object({
  schema_version: Type.Literal('bench-intake-processing-command/1'),
  job_id: Id,
  attempt_id: Id,
  input_id: Id,
  input_sha256: Digest,
  profile_id: Type.Literal('synthetic-research/1'),
  handler_version: Type.Literal('processing/1'),
  command_id: Id,
})
export const ProcessingCancellation = object({
  expected_revision: Revision,
  attempt_id: Id,
})
export const ProcessingQuestionValue = Type.Union([
  object({
    kind: Type.Literal('quantity'),
    value: Quantity,
    basis: Type.Union([Type.Literal('counted'), Type.Literal('estimated')]),
  }),
  object({ kind: Type.Literal('clarification'), text }),
])
export const ProcessingAnswer = object({
  schema_version: Type.Literal('bench-intake-answer/1'),
  expected_question_revision: Revision,
  expected_capture_revision: Revision,
  attempt_id: Id,
  input_sha256: Digest,
  value: ProcessingQuestionValue,
})
export const ProcessingQuestionSpec = object({
  kind: Type.Union([Type.Literal('quantity'), Type.Literal('clarification')]),
  subject_id: Id,
  prompt: text,
  reason: text,
})
export const ProcessingProposal = object({
  subject_id: Id,
  summary: text,
  source_note_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
const runnerBinding = {
  schema_version: Type.Literal('bench-intake-runner/1'),
  job_id: Id,
  attempt_id: Id,
  command_id: Id,
  input_sha256: Digest,
  profile_id: Type.Literal('synthetic-research/1'),
  handler_version: Type.Literal('processing/1'),
  sequence: Revision,
}
export const ProcessingEnvelope = Type.Union(
  [
    object({ ...runnerBinding, kind: Type.Literal('proposal'), payload: ProcessingProposal }),
    object({ ...runnerBinding, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
    object({
      ...runnerBinding,
      kind: Type.Literal('terminal'),
      payload: object({
        state: Type.Union([
          Type.Literal('ready'),
          Type.Literal('failed'),
          Type.Literal('waiting_for_login'),
          Type.Literal('waiting_for_capacity'),
          Type.Literal('interrupted'),
        ]),
      }),
    }),
  ],
  { $schema: 'https://json-schema.org/draft/2020-12/schema' },
)
export const ProcessingQuestion = object({
  id: Id,
  job_id: Id,
  attempt_id: Id,
  input_sha256: Digest,
  revision: Revision,
  state: Type.Union([Type.Literal('open'), Type.Literal('answered'), Type.Literal('superseded')]),
  spec: ProcessingQuestionSpec,
})
export const ProcessingJob = object({
  id: Id,
  subject_id: Id,
  stage: ProcessingStage,
  revision: Revision,
  state: ProcessingState,
  attempt_id: Id,
  input_sha256: Digest,
  attempt_number: Revision,
  qualification: Type.Literal('fixture_only'),
  proposals: Type.Array(object({ id: Id, message_id: Id, value: ProcessingProposal }), {
    maxItems: 100,
  }),
  questions: Type.Array(ProcessingQuestion, { maxItems: 100 }),
})
export const ProcessingSnapshot = object({
  runner_status: Type.Union([Type.Literal('unconfigured'), Type.Literal('fixture_only')]),
  batch_id: Id,
  capture_revision: Revision,
  jobs: Type.Array(ProcessingJob, { maxItems: 100 }),
  cursor: object({ stream_id: Id, sequence: CursorSequence }),
})
export const ProcessingReceipt = object({
  batch_id: Id,
  job_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
  attempt_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
})
export const ProcessingAnswerReceipt = object({
  answer_id: Id,
  question_id: Id,
  attempt_id: Id,
  capture_revision: Revision,
  command_id: Id,
})
export const ProcessingActivity = object({
  jobs: Type.Array(
    object({
      batch_id: Id,
      job_id: Id,
      attempt_id: Id,
      state: ProcessingState,
      input_current: Type.Boolean(),
      occupies_lane: Type.Boolean(),
    }),
    { maxItems: 100 },
  ),
  lane_occupied: Type.Boolean(),
  truncated: Type.Boolean(),
})
export const processingSchemas = {
  ProcessingInput,
  ProcessingCommand,
  ProcessingActivity,
  ProcessingStage,
  ProcessingState,
  ProcessingStart,
  ProcessingCancellation,
  ProcessingQuestionValue,
  ProcessingAnswer,
  ProcessingQuestionSpec,
  ProcessingProposal,
  ProcessingEnvelope,
  ProcessingQuestion,
  ProcessingJob,
  ProcessingSnapshot,
  ProcessingReceipt,
  ProcessingAnswerReceipt,
}
export type ProcessingStartDto = Static<typeof ProcessingStart>
export type ProcessingCancellationDto = Static<typeof ProcessingCancellation>
export type ProcessingAnswerDto = Static<typeof ProcessingAnswer>
export type ProcessingQuestionSpecDto = Static<typeof ProcessingQuestionSpec>
export type ProcessingEnvelopeDto = Static<typeof ProcessingEnvelope>
export type ProcessingSnapshotDto = Static<typeof ProcessingSnapshot>
export type ProcessingReceiptDto = Static<typeof ProcessingReceipt>
export type ProcessingAnswerReceiptDto = Static<typeof ProcessingAnswerReceipt>

export type ProcessingActivityDto = Static<typeof ProcessingActivity>

export type ProcessingInputDto = Static<typeof ProcessingInput>
export type ProcessingCommandDto = Static<typeof ProcessingCommand>
export type ProcessingProposalDto = Static<typeof ProcessingProposal>

export type ProcessingStateDto = Static<typeof ProcessingState>
export type ProcessingJobDto = Static<typeof ProcessingJob>
export type ProcessingQuestionDto = Static<typeof ProcessingQuestion>
