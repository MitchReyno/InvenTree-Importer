import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureSnapshot } from './capture.ts'
import { captureTags } from './capture-primitives.ts'
import { AgentSelection } from './agent-selection.ts'
import { ResearchReceiptSource } from './research.ts'

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
export const ProcessingInputV1 = object({
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
export const ProcessingInputV2 = object({
  ...ProcessingInputV1.properties,
  schema_version: Type.Literal('bench-intake-input/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  instruction_version: Type.Literal('restricted-synthetic/2'),
  notes: Type.Array(CaptureSnapshot.properties.notes.items, { maxItems: 1000 }),
  media: object({ manifest: Type.String({ minLength: 1, maxLength: 245760 }), sha256: Digest }),
})
export const ProcessingInputV3 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  instruction_version: Type.Literal('restricted-research-stub/1'),
  tool_profile_version: Type.Literal('restricted-research-tools/1'),
  source_urls: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
    maxItems: 16,
    uniqueItems: true,
  }),
})
export const ProcessingInputV4 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/4'),
  profile_id: Type.Literal('native-agent/1'),
  instruction_version: Type.Literal('native-agent/1'),
  tool_profile_version: Type.Literal('native-no-tools/1'),
  agent: AgentSelection,
  settings_revision: Revision,
})
export const ProcessingInput = Type.Union([
  ProcessingInputV1,
  ProcessingInputV2,
  ProcessingInputV3,
  ProcessingInputV4,
])

export const ProcessingCommandV1 = object({
  schema_version: Type.Literal('bench-intake-processing-command/1'),
  job_id: Id,
  attempt_id: Id,
  input_id: Id,
  input_sha256: Digest,
  profile_id: Type.Literal('synthetic-research/1'),
  handler_version: Type.Literal('processing/1'),
  command_id: Id,
})
export const ProcessingCommandV2 = object({
  ...ProcessingCommandV1.properties,
  schema_version: Type.Literal('bench-intake-processing-command/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  handler_version: Type.Literal('processing/2'),
})
export const ProcessingCommandV3 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  handler_version: Type.Literal('processing/3'),
})
export const ProcessingCommandV4 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/4'),
  profile_id: Type.Literal('native-agent/1'),
  handler_version: Type.Literal('processing/4'),
})
export const ProcessingCommand = Type.Union([
  ProcessingCommandV4,
  ProcessingCommandV1,
  ProcessingCommandV2,
  ProcessingCommandV3,
])

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
export const ProcessingProposalV1 = object({
  subject_id: Id,
  summary: text,
  source_note_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
export const ProcessingSource = Type.Union([
  object({ kind: Type.Literal('note'), note_id: Id, text_sha256: Digest }),
  object({ kind: Type.Literal('media_version'), evidence_id: Id, version_id: Id, sha256: Digest }),
])
export const ProcessingProposalV2 = object({
  schema_version: Type.Literal('bench-intake-proposal/2'),
  subject_id: Id,
  summary: text,
  sources: Type.Array(ProcessingSource, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
export const ProcessingSourceV3 = Type.Union([ProcessingSource, ResearchReceiptSource])
export const ProcessingProposalV3 = object({
  ...ProcessingProposalV2.properties,
  schema_version: Type.Literal('bench-intake-proposal/3'),
  sources: Type.Array(ProcessingSourceV3, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
/**
 * Reviewable suggestions bound to the same evidence as `/2`. A quantity is only ever an
 * estimate for a human to accept or correct; tags apply only when Auto tags were requested.
 */
export const ProcessingProposalV4 = object({
  ...ProcessingProposalV2.properties,
  schema_version: Type.Literal('bench-intake-proposal/4'),
  quantity: Type.Optional(object({ value: Quantity, status: Type.Literal('estimated') })),
  tags: Type.Optional(captureTags),
})
export const ProcessingProposal = Type.Union([
  ProcessingProposalV1,
  ProcessingProposalV2,
  ProcessingProposalV3,
  ProcessingProposalV4,
])

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
const terminalPayload = object({
  state: Type.Union([
    Type.Literal('ready'),
    Type.Literal('failed'),
    Type.Literal('waiting_for_login'),
    Type.Literal('waiting_for_capacity'),
    Type.Literal('interrupted'),
  ]),
})

export const ProcessingEnvelopeV1 = Type.Union(
  [
    object({ ...runnerBinding, kind: Type.Literal('proposal'), payload: ProcessingProposalV1 }),
    object({ ...runnerBinding, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
    object({
      ...runnerBinding,
      kind: Type.Literal('terminal'),
      payload: terminalPayload,
    }),
  ],
  { $schema: 'https://json-schema.org/draft/2020-12/schema' },
)
const runnerBindingV2 = {
  ...runnerBinding,
  schema_version: Type.Literal('bench-intake-runner/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  handler_version: Type.Literal('processing/2'),
}
export const ProcessingEnvelopeV2 = Type.Union([
  object({
    ...runnerBindingV2,
    kind: Type.Literal('proposal'),
    payload: Type.Union([ProcessingProposalV2, ProcessingProposalV4]),
  }),
  object({ ...runnerBindingV2, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({
    ...runnerBindingV2,
    kind: Type.Literal('terminal'),
    payload: terminalPayload,
  }),
])
const runnerBindingV3 = {
  ...runnerBindingV2,
  schema_version: Type.Literal('bench-intake-runner/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  handler_version: Type.Literal('processing/3'),
}
export const ProcessingEnvelopeV3 = Type.Union([
  object({ ...runnerBindingV3, kind: Type.Literal('proposal'), payload: ProcessingProposalV3 }),
  object({ ...runnerBindingV3, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({ ...runnerBindingV3, kind: Type.Literal('terminal'), payload: terminalPayload }),
])
const runnerBindingV4 = {
  ...runnerBindingV2,
  schema_version: Type.Literal('bench-intake-runner/4'),
  profile_id: Type.Literal('native-agent/1'),
  handler_version: Type.Literal('processing/4'),
}
export const ProcessingEnvelopeV4 = Type.Union([
  object({ ...runnerBindingV4, kind: Type.Literal('proposal'), payload: ProcessingProposalV2 }),
  object({ ...runnerBindingV4, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({ ...runnerBindingV4, kind: Type.Literal('terminal'), payload: terminalPayload }),
])
export const ProcessingEnvelope = Type.Union([
  ProcessingEnvelopeV4,
  ProcessingEnvelopeV1,
  ProcessingEnvelopeV2,
  ProcessingEnvelopeV3,
])
export const ProcessingBlocker = Type.Union([
  Type.Literal('media_not_ready'),
  Type.Literal('media_input_capacity'),
  Type.Literal('worker_version_conflict'),
])

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
  qualification: Type.Union([Type.Literal('fixture_only'), Type.Literal('native_unverified')]),
  can_cancel: Type.Optional(Type.Boolean()),
  blocked_code: Type.Optional(ProcessingBlocker),
  proposals: Type.Array(object({ id: Id, message_id: Id, value: ProcessingProposal }), {
    maxItems: 100,
  }),
  questions: Type.Array(ProcessingQuestion, { maxItems: 100 }),
})
export const ProcessingSnapshot = object({
  runner_status: Type.Union([
    Type.Literal('unconfigured'),
    Type.Literal('fixture_only'),
    Type.Literal('native_unverified'),
  ]),
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
      blocked_code: Type.Optional(ProcessingBlocker),
    }),
    { maxItems: 100 },
  ),
  lane_occupied: Type.Boolean(),
  truncated: Type.Boolean(),
})
export const processingSchemas = {
  ProcessingInputV4,
  ProcessingCommandV4,
  ProcessingEnvelopeV4,
  ProcessingInputV1,
  ProcessingInputV2,
  ProcessingInputV3,
  ProcessingCommandV1,
  ProcessingCommandV2,
  ProcessingCommandV3,
  ProcessingProposalV1,
  ProcessingProposalV2,
  ProcessingProposalV3,
  ProcessingSource,
  ProcessingSourceV3,
  ProcessingEnvelopeV1,
  ProcessingEnvelopeV2,
  ProcessingEnvelopeV3,
  ProcessingBlocker,
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
  ProcessingProposalV4,
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

export type ProcessingInputV1Dto = Static<typeof ProcessingInputV1>
export type ProcessingInputV2Dto = Static<typeof ProcessingInputV2>
export type ProcessingCommandV1Dto = Static<typeof ProcessingCommandV1>
export type ProcessingCommandV2Dto = Static<typeof ProcessingCommandV2>
export type ProcessingProposalV1Dto = Static<typeof ProcessingProposalV1>
export type ProcessingProposalV2Dto = Static<typeof ProcessingProposalV2>
export type ProcessingSourceDto = Static<typeof ProcessingSource>
export type ProcessingEnvelopeV1Dto = Static<typeof ProcessingEnvelopeV1>
export type ProcessingEnvelopeV2Dto = Static<typeof ProcessingEnvelopeV2>
export type ProcessingBlockerDto = Static<typeof ProcessingBlocker>

export type ProcessingInputV3Dto = Static<typeof ProcessingInputV3>

export type ProcessingCommandV3Dto = Static<typeof ProcessingCommandV3>

export type ProcessingProposalV3Dto = Static<typeof ProcessingProposalV3>

export type ProcessingSourceV3Dto = Static<typeof ProcessingSourceV3>

export type ProcessingEnvelopeV3Dto = Static<typeof ProcessingEnvelopeV3>

export type ProcessingInputV4Dto = Static<typeof ProcessingInputV4>
export type ProcessingCommandV4Dto = Static<typeof ProcessingCommandV4>
export type ProcessingEnvelopeV4Dto = Static<typeof ProcessingEnvelopeV4>
