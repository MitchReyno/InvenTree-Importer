import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, IsoTime, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureSnapshot } from './capture.ts'
import { captureTags } from './capture-primitives.ts'
import { AgentSelection } from './agent-selection.ts'
import { ResearchReceiptSource } from './research.ts'
import { mappedReference } from './effects.ts'
import { valueEvidence } from './value-evidence.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const text = Type.String({ minLength: 1, maxLength: 2048 })
const stages = ['reading', 'identifying', 'research', 'images', 'inventory'] as const
export const ProcessingStage = Type.Union(stages.map((stage) => Type.Literal(stage)))
/** Stages of the session profiles. Earlier input versions keep `ProcessingStage` unchanged. */
export const ProcessingStageV2 = Type.Union(
  (['examine', ...stages] as const).map((stage) => Type.Literal(stage)),
)
const lotStages = ['research', 'images', 'inventory'] as const
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
/** A session's lifecycle state; sessions.ts re-exports it with the session contracts. */
export const SessionState = Type.Union(
  (
    [
      'queued',
      'running',
      'waiting_input',
      'finished',
      'cancelling',
      'cancelled',
      'interrupted',
      'failed',
      'waiting_for_login',
      'waiting_for_capacity',
      'resume_unavailable',
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
/**
 * The synthetic `/2` handler's input when the subject or its linked Part chooses to create a new
 * Part, so suggestions for that Part stay current. Older versions never carry a create choice.
 */
export const ProcessingInputV5 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/5'),
})
const inputV6Shared = {
  schema_version: Type.Literal('bench-intake-input/6'),
  batch_id: Id,
  source_id: Id,
  capture_revision: Revision,
  defaults: CaptureDefaults,
  notes: ProcessingInputV2.properties.notes,
  observations: CaptureSnapshot.properties.observations,
  instruction_sha256: Digest,
  tool_profile_version: Type.Literal('native-session-tools/1'),
  media: ProcessingInputV2.properties.media,
  /** Proposals a successor started from; later revisions arrive as inbox items. */
  pinned_proposal_ids: Type.Array(Id, { maxItems: 16, uniqueItems: true }),
}
const inputV6Profiles = [
  {
    profile_id: Type.Literal('native-agent/2'),
    instruction_version: Type.Literal('native-agent/2'),
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('shared-vm-agent/1'),
    instruction_version: Type.Literal('shared-vm-agent/1'),
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('synthetic-session/1'),
    instruction_version: Type.Literal('synthetic-session/1'),
    agent: Type.Null(),
    settings_revision: Type.Null(),
  },
]
const inputV6Scopes = [
  {
    stage: Type.Literal('examine'),
    subject_id: Type.Null(),
    subject: Type.Null(),
    linked_part: Type.Null(),
  },
  {
    stage: Type.Union(lotStages.map((stage) => Type.Literal(stage))),
    subject_id: Id,
    subject: ProcessingInputV2.properties.subject,
    linked_part: ProcessingInputV2.properties.linked_part,
  },
]
/**
 * A session's opening manifest: the batch-level Examine lead session, or one per-lot session.
 * Only the session handler decodes it, so it is not part of `ProcessingInput`.
 */
export const ProcessingInputV6 = Type.Union(
  inputV6Profiles.flatMap((profile) =>
    inputV6Scopes.map((scope) => object({ ...inputV6Shared, ...profile, ...scope })),
  ),
)
export const ProcessingInput = Type.Union([
  ProcessingInputV1,
  ProcessingInputV2,
  ProcessingInputV5,
  ProcessingInputV3,
  ProcessingInputV4,
  ProcessingInputV5,
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
export const ProcessingCommandV5 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/5'),
  profile_id: Type.Union([
    Type.Literal('native-agent/2'),
    Type.Literal('shared-vm-agent/1'),
    Type.Literal('synthetic-session/1'),
  ]),
  handler_version: Type.Literal('processing/5'),
})
export const ProcessingCommand = Type.Union([
  ProcessingCommandV5,
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
export const ProcessingMediaSource = object({
  kind: Type.Literal('media_version'),
  evidence_id: Id,
  version_id: Id,
  sha256: Digest,
})
export type ProcessingMediaSourceDto = Static<typeof ProcessingMediaSource>

export const ProcessingSource = Type.Union([
  object({ kind: Type.Literal('note'), note_id: Id, text_sha256: Digest }),
  ProcessingMediaSource,
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
export const ProcessingField = Type.Union(
  (['markings', 'identity', 'quantity', 'research', 'images'] as const).map((field) =>
    Type.Literal(field),
  ),
)
export const ProcessingFields = Type.Array(ProcessingField, {
  minItems: 1,
  maxItems: 5,
  uniqueItems: true,
})
/** What a session proposal relies on; it stays current while every source is current. */
export const ProcessingReliance = object({
  fields: ProcessingFields,
  sources: Type.Array(
    Type.Union([
      ...ProcessingSource.anyOf,
      object({
        kind: Type.Literal('evidence_observation'),
        evidence_observation_id: Id,
        revision: Revision,
      }),
      object({ kind: Type.Literal('observation_set'), lot_id: Id, version: Revision }),
      object({ kind: Type.Literal('inbox_item'), inbox_item_id: Id }),
      object({ kind: Type.Literal('proposal'), proposal_id: Id }),
    ]),
    { minItems: 1, maxItems: 200, uniqueItems: true },
  ),
})
const catalogueSources = Type.Array(ProcessingSource, {
  minItems: 1,
  maxItems: 32,
  uniqueItems: true,
})
const catalogueText = Type.String({ minLength: 1, maxLength: 256 })

const catalogueChoice = <M extends 'category' | 'company'>(model: M) =>
  Type.Union([
    object({
      choice: Type.Literal('existing'),
      reference: mappedReference(model),
      sources: catalogueSources,
      ...valueEvidence,
    }),
    object({
      choice: Type.Literal('proposed_new'),
      name: catalogueText,
      reason: text,
      sources: catalogueSources,
      ...valueEvidence,
    }),
  ])

/**
 * Catalogue values with their sources. Whether a value can enter a Part spec is assessed
 * against target observations; unsupported values stay here and are shown with a reason.
 */
export const CatalogueProposal = object({
  category: Type.Union([catalogueChoice('category'), Type.Null()]),
  parameters: Type.Array(
    object({
      name: catalogueText,
      value: catalogueText,
      /** Null proposes a new template, or a template not yet mapped to the category. */
      template: Type.Union([mappedReference('parameter_template'), Type.Null()]),
      category_mapping: Type.Union([mappedReference('category_parameter'), Type.Null()]),
      sources: catalogueSources,
      ...valueEvidence,
    }),
    { maxItems: 32 },
  ),
  manufacturer: Type.Union([
    object({
      company: catalogueChoice('company'),
      mpn: catalogueText,
      sources: catalogueSources,
      ...valueEvidence,
    }),
    Type.Null(),
  ]),
  supplier: Type.Union([
    object({
      company: catalogueChoice('company'),
      sku: Type.Union([catalogueText, Type.Null()]),
      price: Type.Union([
        object({ amount: Quantity, currency: Type.String({ pattern: '^[A-Z]{3}$' }) }),
        Type.Null(),
      ]),
      sources: catalogueSources,
      ...valueEvidence,
    }),
    Type.Null(),
  ]),
  description: Type.Union([
    object({ text, sources: catalogueSources, ...valueEvidence }),
    Type.Null(),
  ]),
})
/** A session proposal: `/4` plus what it relies on and a structured catalogue block. */
export const ProcessingProposalV5 = object({
  ...ProcessingProposalV4.properties,
  schema_version: Type.Literal('bench-intake-proposal/5'),
  relies_on: ProcessingReliance,
  catalogue: Type.Optional(CatalogueProposal),
})
export const ProcessingProposal = Type.Union([
  ProcessingProposalV1,
  ProcessingProposalV2,
  ProcessingProposalV3,
  ProcessingProposalV4,
  ProcessingProposalV5,
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
  /** A lead-session question about the whole batch has a null subject. */
  spec: object({
    ...ProcessingQuestionSpec.properties,
    subject_id: Type.Union([Id, Type.Null()]),
  }),
  /** Session questions only: the fields affected and the assumption the agent continues with. */
  fields: Type.Optional(ProcessingFields),
  assumption: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  /** When the question was asked; absent for questions retained before the time was kept. */
  asked_at: Type.Optional(IsoTime),
})

/** Orders questions oldest first; a question retained before its time was kept comes last. */
export function oldestQuestionFirst(a: { asked_at?: string }, b: { asked_at?: string }): number {
  if (a.asked_at === b.asked_at) {
    return 0
  }
  if (!a.asked_at) {
    return 1
  }
  if (!b.asked_at) {
    return -1
  }
  return Date.parse(a.asked_at) - Date.parse(b.asked_at)
}

export const STATUS_LINE_MAX_CHARACTERS = 120
/** One status line: no line breaks, at most 120 characters. */
export const statusLine = Type.String({
  minLength: 1,
  maxLength: STATUS_LINE_MAX_CHARACTERS,
  pattern: '^[^\\r\\n\\u2028\\u2029]*$',
})
export const ProcessingJob = object({
  id: Id,
  /** Null only for the batch-level Examine lead job. */
  subject_id: Type.Union([Id, Type.Null()]),
  stage: ProcessingStageV2,
  revision: Revision,
  state: ProcessingState,
  attempt_id: Id,
  input_sha256: Digest,
  attempt_number: Revision,
  qualification: Type.Union([Type.Literal('fixture_only'), Type.Literal('native_unverified')]),
  can_cancel: Type.Optional(Type.Boolean()),
  blocked_code: Type.Optional(ProcessingBlocker),
  /** Present for session profiles: the state of the job's latest session. */
  session_state: Type.Optional(SessionState),
  /** The latest session's newest status line, when it has posted one. */
  latest_status: Type.Optional(object({ text: statusLine, at: Type.String({ maxLength: 40 }) })),
  proposals: Type.Array(
    object({
      id: Id,
      message_id: Id,
      value: ProcessingProposal,
      /**
       * Session proposals only. Stale when a source it relies on changed; provisional while a
       * question about one of its fields is open.
       */
      currentness: Type.Optional(
        Type.Union([
          object({ state: Type.Literal('current') }),
          object({ state: Type.Literal('provisional') }),
          object({
            state: Type.Literal('stale'),
            reason: Type.Union(
              (
                [
                  'source_superseded',
                  'evidence_removed',
                  'answer_received',
                  'operator_correction',
                  'lot_regrouped',
                  'subject_retired',
                ] as const
              ).map((reason) => Type.Literal(reason)),
            ),
          }),
        ]),
      ),
    }),
    { maxItems: 100 },
  ),
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
  ProcessingStageV2,
  ProcessingInputV6,
  ProcessingCommandV5,
  ProcessingField,
  ProcessingReliance,
  CatalogueProposal,
  ProcessingProposalV5,
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
export type ProcessingInputV5Dto = Static<typeof ProcessingInputV5>
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

export type ProcessingStageV2Dto = Static<typeof ProcessingStageV2>
export type ProcessingInputV6Dto = Static<typeof ProcessingInputV6>
export type ProcessingCommandV5Dto = Static<typeof ProcessingCommandV5>
export type ProcessingFieldDto = Static<typeof ProcessingField>
export type ProcessingRelianceDto = Static<typeof ProcessingReliance>
export type CatalogueProposalDto = Static<typeof CatalogueProposal>
export type ProcessingProposalV5Dto = Static<typeof ProcessingProposalV5>
