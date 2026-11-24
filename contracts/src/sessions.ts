import { SessionFailureSummary } from './session-failures.ts'
import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, IsoTime, Quantity, Revision } from './scalars.ts'
import { AgentSelection } from './agent-selection.ts'
import { CaptureQuantity } from './capture.ts'
import {
  ProcessingFields,
  ProcessingStageV2,
  ProcessingState,
  ProcessingMediaSource,
  SessionState,
  ProcessingQuestionSpec,
  ProcessingQuestionValue,
  QuestionOption,
  QuestionStepId,
  QuestionSteps,
  QuestionTitle,
  QuestionNumberValue,
  QuestionOtherValue,
  QuestionTextValue,
  STATUS_LINE_MAX_CHARACTERS,
  SessionProposal,
  ProposalStaleReason,
  WebPageSource,
  StartFreshEligibility,
  statusLine,
} from './processing.ts'
import { ContractValidationIssue } from './validation-issues.ts'
import {
  EvidenceReadings,
  EvidenceRegion,
  LeadBatchView,
  LotFormingConflict,
  SeparationReason,
} from './evidence-observations.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const timestamp = Type.String({ maxLength: 40 })
const message = Type.String({ minLength: 1, maxLength: 4096 })

export { SessionState, STATUS_LINE_MAX_CHARACTERS }

export const SessionStatusArgs = object({ text: statusLine })
/** A question names the fields it affects and the assumption the agent continues with. */
export const SessionAskArgs = object({
  kind: ProcessingQuestionSpec.properties.kind,
  subject_id: Type.Union([Id, Type.Null()]),
  prompt: ProcessingQuestionSpec.properties.prompt,
  reason: ProcessingQuestionSpec.properties.reason,
  fields: ProcessingFields,
  assumption: Type.String({ minLength: 1, maxLength: 2048 }),
})
/**
 * The `ask` tool's question: one thing, in 1–4 steps answered together. Step and option IDs must be
 * unique, a question has at most one number step and it is about a live lot; the handler checks
 * those, since a schema can't.
 */
export const SessionAskArgsV2 = object({
  schema_version: Type.Literal('bench-intake-question/2'),
  subject_id: Type.Union([Id, Type.Null()]),
  reason: ProcessingQuestionSpec.properties.reason,
  fields: ProcessingFields,
  /** Labels a stepped question in Needs you; a one-step question uses its prompt. */
  title: Type.Optional(QuestionTitle),
  steps: QuestionSteps,
})
export const SessionReplyArgs = object({ inbox_item_id: Id, text: message })
/** Passing a cursor acknowledges every inbox item up to it. */
export const SessionReadInboxArgs = object({ after_seq: CursorSequence })
const pixel = Type.Integer({ minimum: 0, maximum: 24000000 })
const dimension = Type.Integer({ minimum: 1, maximum: 24000000 })
export const SessionFetchEvidenceArgs = object({
  evidence_id: Id,
  version_id: Type.Optional(Id),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  region: Type.Optional(
    object({
      x: pixel,
      y: pixel,
      width: dimension,
      height: dimension,
      source_width: dimension,
      source_height: dimension,
    }),
  ),
})
export const SessionProposeArgs = object({ proposal: SessionProposal })

export const SessionToolError = Type.Union(
  (
    [
      'capability_refused',
      'tool_not_allowed',
      'validation_failed',
      'status_rate_limited',
      'source_not_delivered',
      'stale',
      'inbox_item_unknown',
      'session_not_running',
      'capacity_reached',
      'tool_failed',
      'media_evidence_removed',
      /** The call's commit was not acknowledged, so its effect may or may not have happened. */
      'outcome_uncertain',
    ] as const
  ).map((code) => Type.Literal(code)),
)
const outboxBase = { session_id: Id, seq: Revision, created_at: timestamp }
/**
 * One image `fetch_evidence` prepared for the tool response: what was cut and what was prepared,
 * never the bytes. It doesn't mean the provider read the image.
 */
export const SessionPhotoView = object({
  evidence_id: Id,
  version_id: Id,
  page: Type.Integer({ minimum: 1, maximum: 10000 }),
  /** The region requested, in page-preview pixels; absent for a whole page. */
  region: Type.Optional(
    object({
      x: Type.Integer({ minimum: 0 }),
      y: Type.Integer({ minimum: 0 }),
      width: Type.Integer({ minimum: 1 }),
      height: Type.Integer({ minimum: 1 }),
    }),
  ),
  delivered: object({
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    media_type: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
    sha256: Digest,
  }),
})
/**
 * One regroup move as it was made: applied, only suggested because the operator edited a row, or
 * unchanged because the observation was already in that lot.
 */
export const RegroupMove = object({
  observation_id: Id,
  from_lot_id: Type.Union([Id, Type.Null()]),
  to_lot_id: Id,
  outcome: Type.Union([
    Type.Literal('applied'),
    Type.Literal('suggested'),
    Type.Literal('unchanged'),
  ]),
})
/**
 * What `propose_lot` did: formed a new lot, extended an agent lot, only suggested membership
 * because the operator edited the lot or its observations, or changed nothing.
 */
export const LotFormingOutcome = Type.Union([
  Type.Literal('formed'),
  Type.Literal('extended'),
  Type.Literal('suggested'),
  Type.Literal('unchanged'),
])
export const SessionOutboxItem = Type.Union([
  object({ ...outboxBase, kind: Type.Literal('status'), payload: SessionStatusArgs }),
  object({
    ...outboxBase,
    kind: Type.Literal('observation'),
    payload: object({ evidence_observation_id: Id }),
  }),
  object({
    ...outboxBase,
    kind: Type.Literal('lot'),
    payload: object({
      lot_id: Id,
      /** Absent on items recorded before outcomes were kept. */
      outcome: Type.Optional(LotFormingOutcome),
      /** Why the agent kept the lot apart, when it said. */
      separation_reason: Type.Optional(SeparationReason),
    }),
  }),
  object({
    ...outboxBase,
    kind: Type.Literal('regroup'),
    payload: object({
      /** Each move's destination lot; the only record an older regroup kept. */
      lot_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
      moves: Type.Optional(Type.Array(RegroupMove, { minItems: 1, maxItems: 100 })),
    }),
  }),
  object({ ...outboxBase, kind: Type.Literal('proposal'), payload: object({ proposal_id: Id }) }),
  object({ ...outboxBase, kind: Type.Literal('question'), payload: object({ question_id: Id }) }),
  object({ ...outboxBase, kind: Type.Literal('reply'), payload: SessionReplyArgs }),
  object({ ...outboxBase, kind: Type.Literal('photo_view'), payload: SessionPhotoView }),
])

/** A delivered step value; a picked option also carries its label, so the agent needn't look it up. */
export const SessionAnswerStepValue = Type.Union([
  object({
    kind: Type.Literal('choice'),
    option_id: QuestionStepId,
    label: QuestionOption.properties.label,
  }),
  QuestionOtherValue,
  QuestionNumberValue,
  QuestionTextValue,
])
/** The operator's answer as the asking session receives it: one value, or one per step. */
export const SessionAnswerPayload = Type.Union([
  object({ question_id: Id, answer_id: Id, value: ProcessingQuestionValue }),
  object({
    question_id: Id,
    answer_id: Id,
    steps: Type.Array(object({ step_id: QuestionStepId, value: SessionAnswerStepValue }), {
      minItems: 1,
      maxItems: 4,
    }),
  }),
])
const inboxBase = { id: Id, seq: Revision, created_at: timestamp }
export const SessionInboxItem = Type.Union([
  object({ ...inboxBase, kind: Type.Literal('answer'), payload: SessionAnswerPayload }),
  object({ ...inboxBase, kind: Type.Literal('chat'), payload: object({ text: message }) }),
  object({
    ...inboxBase,
    kind: Type.Literal('evidence'),
    payload: object({ evidence_id: Id, version_id: Id }),
  }),
  /** The batch's saved instruction for its agents; empty text clears an earlier one. */
  object({
    ...inboxBase,
    kind: Type.Literal('instruction'),
    payload: object({
      instruction_id: Id,
      text: Type.String({ maxLength: 8192 }),
      group_id: Type.Union([Id, Type.Null()]),
    }),
  }),
  object({
    ...inboxBase,
    kind: Type.Literal('revision'),
    payload: object({
      fields: ProcessingFields,
      reason: Type.String({ minLength: 1, maxLength: 2048 }),
    }),
  }),
])
/** Every response carries the pending inbox count, so agents notice input without polling. */
export const SessionToolResult = Type.Union([
  object({
    ok: Type.Literal(true),
    pending_inbox: Type.Integer({ minimum: 0 }),
    revision: Type.Optional(Revision),
    /** Exact source to cite, present only with successful evidence byte delivery. */
    source: Type.Optional(ProcessingMediaSource),
    /** The proposal, question or outbox item a write created. */
    id: Type.Optional(Id),
    items: Type.Optional(Type.Array(SessionInboxItem, { maxItems: 20 })),
    /** fetch_evidence for the lead session: each page's preview size, which regions refer to. */
    pages: Type.Optional(
      Type.Array(
        object({
          page: Type.Integer({ minimum: 1, maximum: 10000 }),
          width: Type.Integer({ minimum: 1 }),
          height: Type.Integer({ minimum: 1 }),
        }),
        { maxItems: 30 },
      ),
    ),
    /**
     * fetch_evidence: the image actually sent, cut from a page preview. `scale` is delivered
     * pixels per page-preview pixel; regions are always requested in page-preview pixels.
     */
    delivered: Type.Optional(
      object({
        page: Type.Integer({ minimum: 1, maximum: 10000 }),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        scale: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
        region: Type.Optional(
          object({
            x: Type.Integer({ minimum: 0 }),
            y: Type.Integer({ minimum: 0 }),
            width: Type.Integer({ minimum: 1 }),
            height: Type.Integer({ minimum: 1 }),
          }),
        ),
        media_type: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
        sha256: Digest,
      }),
    ),
    /** fetch_evidence for the lead session: the evidence's label and the operator's note. */
    evidence_label: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    evidence_note: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
    /** Lot-forming tools: true when the write became a suggestion for the operator. */
    suggested: Type.Optional(Type.Boolean()),
    /** propose_lot: the draft Part it created for `part: { label }`. */
    part_subject_id: Type.Optional(Id),
    /** read_batch: the lead session's view of its batch. */
    batch: Type.Optional(LeadBatchView),
  }),
  object({
    ok: Type.Literal(false),
    error: SessionToolError,
    issues: Type.Optional(Type.Array(ContractValidationIssue, { maxItems: 8 })),
    message: Type.String({ minLength: 1, maxLength: 1024 }),
    pending_inbox: Type.Integer({ minimum: 0 }),
    revision: Type.Optional(Revision),
    /** For `stale`: the rows that changed, with their current revision. */
    conflicts: Type.Optional(Type.Array(LotFormingConflict, { maxItems: 200 })),
  }),
])

/** An operator chat message; answers keep using the question answer route. */
export const SessionInboxSubmission = object({ idempotency_key: Id, text: message })
export const SessionInboxReceipt = object({ item_id: Id, seq: Revision })

/**
 * The retained bytes of a session proposal or question in `processing_message`, bound to the
 * session's attempt, command and opening manifest as runner envelopes are for earlier profiles.
 */
const sessionBinding = {
  schema_version: Type.Literal('bench-intake-session/1'),
  job_id: Id,
  attempt_id: Id,
  command_id: Id,
  input_sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  sequence: Revision,
}
export const SessionEnvelope = Type.Union([
  object({ ...sessionBinding, kind: Type.Literal('proposal'), payload: SessionProposal }),
  object({ ...sessionBinding, kind: Type.Literal('question'), payload: SessionAskArgs }),
  object({ ...sessionBinding, kind: Type.Literal('question'), payload: SessionAskArgsV2 }),
])
/** A session's latest status line, shown as its current activity. */
export const SessionLatestStatus = object({
  text: SessionStatusArgs.properties.text,
  at: timestamp,
})
/** The most stored inbox and outbox rows one history page holds. */
export const SESSION_HISTORY_PAGE_SIZE = 200
/** Every source of a proposal and every question making it provisional can be linked. */
const MAX_ENTRY_LINKS = 1000
const SUMMARY_MAX_CHARACTERS = 300
/** Web reads are derived from a page's proposals and don't count towards its 200 rows. */
const MAX_HISTORY_ENTRIES = SESSION_HISTORY_PAGE_SIZE * 101
const historyLabel = Type.String({ minLength: 1, maxLength: 256 })
const ENTRY_SEQ = '[1-9][0-9]{0,18}'
const ENTRY_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

/** `outbox:<attempt>:<seq>` or `inbox:<seq>`; a web read adds `:web:<source index>`. */
export const SessionHistoryEntryId = Type.String({
  maxLength: 80,
  pattern: `^(inbox:${ENTRY_SEQ}|outbox:${ENTRY_UUID}:${ENTRY_SEQ}(:web:(0|[1-9][0-9]?))?)(?![\\s\\S])`,
})
/** The oldest row of a page, opaque to clients; pass it back as `before` for the next older page. */
export const SessionHistoryCursor = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9_-]+(?![\\s\\S])',
})

/** Where an entry points; a retired or removed target becomes `gone` with what happened to it. */
export const SessionHistoryLink = Type.Union([
  object({ kind: Type.Literal('lot'), lot_id: Id, label: historyLabel }),
  object({
    kind: Type.Literal('map'),
    lot_id: Type.Optional(Id),
    observation_id: Type.Optional(Id),
  }),
  object({
    kind: Type.Literal('capture_evidence'),
    evidence_id: Id,
    version_id: Id,
    page: Type.Integer({ minimum: 1, maximum: 10000 }),
    label: historyLabel,
  }),
  object({ kind: Type.Literal('record'), part_subject_id: Id, label: historyLabel }),
  /** A cited note: a capture note names its subject, an evidence note its evidence. */
  object({
    kind: Type.Literal('note'),
    note_id: Id,
    subject_id: Type.Union([Id, Type.Null()]),
    evidence_id: Type.Optional(Id),
    label: historyLabel,
  }),
  object({ kind: Type.Literal('question'), question_id: Id, label: historyLabel }),
  object({ kind: Type.Literal('failure'), attempt_id: Id, failure_id: Id }),
  object({
    kind: Type.Literal('external_url'),
    url: WebPageSource.properties.url,
    label: historyLabel,
  }),
  object({
    kind: Type.Literal('gone'),
    target: Type.Union(
      (['lot', 'evidence', 'observation', 'question', 'note'] as const).map((target) =>
        Type.Literal(target),
      ),
    ),
    label: historyLabel,
  }),
])

/** A question's state as the history shows it; an open question of an earlier attempt is superseded. */
const HistoryQuestionState = Type.Union(
  (['open', 'answered', 'superseded'] as const).map((state) => Type.Literal(state)),
)
/** An observation's values now: an agent revision can overwrite them under the same ID. */
const CurrentObservation = object({
  id: Id,
  evidence_id: Id,
  evidence_version_id: Id,
  page: Type.Integer({ minimum: 1, maximum: 10000 }),
  region: EvidenceRegion,
  readings: EvidenceReadings,
  visible_count: Type.Union([Type.Integer({ minimum: 0, maximum: 1000000 }), Type.Null()]),
  status: Type.Union([Type.Literal('active'), Type.Literal('suggested')]),
  lot_id: Type.Union([Id, Type.Null()]),
})
const AnswerEffect = Type.Union([
  object({
    kind: Type.Literal('quantity'),
    lot_id: Id,
    value: Quantity,
    basis: Type.Union([Type.Literal('counted'), Type.Literal('estimated')]),
  }),
  object({ kind: Type.Literal('note'), subject_id: Type.Union([Id, Type.Null()]) }),
])

/**
 * What an entry expands to. Values a record holds now, rather than as the agent left them, are
 * marked `current`; a detail that wasn't retained is null or listed in `not_retained`.
 */
export const SessionHistoryDetails = Type.Union([
  object({ kind: Type.Literal('status'), text: SessionStatusArgs.properties.text }),
  object({
    kind: Type.Literal('observation'),
    current: Type.Union([CurrentObservation, Type.Null()]),
  }),
  object({
    kind: Type.Literal('lot'),
    lot: Type.Union([
      object({
        id: Id,
        label: historyLabel,
        retired: Type.Boolean(),
        operator_edited: Type.Boolean(),
        observations: Type.Array(CurrentObservation, { maxItems: 100 }),
        /** The quantity the operator selected, apart from the agent's estimate. */
        selected_quantity: CaptureQuantity,
        estimate: Type.Union([
          object({ quantity: Quantity, basis: Type.String({ minLength: 1, maxLength: 512 }) }),
          Type.Null(),
        ]),
        part_subject_id: Type.Union([Id, Type.Null()]),
      }),
      Type.Null(),
    ]),
    /** Lot entries keep no snapshot of the lot as formed, so these are its current values. */
    current: Type.Literal(true),
    /** Null for an entry recorded before outcomes were kept. */
    outcome: Type.Union([LotFormingOutcome, Type.Null()]),
    /** As the agent gave it with this call; null when it gave none. */
    separation_reason: Type.Union([SeparationReason, Type.Null()]),
    not_retained: Type.Array(Type.Literal('separation_reason'), { maxItems: 1 }),
  }),
  object({
    kind: Type.Literal('regroup'),
    /** Absent for a regroup recorded before moves were kept: only its destinations remain. */
    moves: Type.Optional(Type.Array(RegroupMove, { minItems: 1, maxItems: 100 })),
    lot_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
  }),
  object({
    kind: Type.Literal('proposal'),
    proposal_id: Id,
    proposal: SessionProposal,
    currentness: Type.Union([
      object({ state: Type.Literal('current') }),
      object({ state: Type.Literal('provisional'), question_ids: Type.Array(Id, { minItems: 1 }) }),
      object({ state: Type.Literal('stale'), reason: ProposalStaleReason }),
    ]),
  }),
  object({
    kind: Type.Literal('question'),
    question_id: Id,
    question: Type.Union([SessionAskArgs, SessionAskArgsV2]),
    state: HistoryQuestionState,
  }),
  object({ kind: Type.Literal('reply'), inbox_item_id: Id, text: message }),
  object({
    kind: Type.Literal('photo_view'),
    view: SessionPhotoView,
    /** The recut is served by the session's photo-view crop route under this attempt and seq. */
    crop: Type.Union([object({ attempt_id: Id, seq: Revision }), Type.Null()]),
  }),
  object({
    kind: Type.Literal('web_read'),
    url: WebPageSource.properties.url,
    title: Type.Optional(WebPageSource.properties.title),
    read_at: Type.Optional(IsoTime),
    /** The first proposal of the attempt that cites the page. */
    proposal_entry_id: SessionHistoryEntryId,
  }),
  object({
    kind: Type.Literal('answer'),
    answer: SessionAnswerPayload,
    effects: Type.Array(AnswerEffect, { maxItems: 2 }),
  }),
  object({ kind: Type.Literal('chat'), text: message }),
  object({
    kind: Type.Literal('instruction'),
    instruction_id: Id,
    text: Type.String({ maxLength: 8192 }),
    group_id: Type.Union([Id, Type.Null()]),
    /** When the operator saved it; null if that version is no longer retained. */
    saved_at: Type.Union([IsoTime, Type.Null()]),
    /** Sent again to a later attempt after a Start fresh or restart. */
    relayed: Type.Boolean(),
  }),
  object({
    kind: Type.Literal('evidence'),
    evidence_id: Id,
    version_id: Id,
    restored: Type.Boolean(),
  }),
  object({
    kind: Type.Literal('revision'),
    fields: ProcessingFields,
    reason: Type.String({ minLength: 1, maxLength: 2048 }),
  }),
])

const historyEntryBase = {
  id: SessionHistoryEntryId,
  at: IsoTime,
  summary: Type.String({ minLength: 1, maxLength: SUMMARY_MAX_CHARACTERS }),
  links: Type.Array(SessionHistoryLink, { maxItems: MAX_ENTRY_LINKS }),
}
/** One history entry: the agent's outbox items carry their attempt; inbox items belong to the job. */
export const SessionHistoryEntry = Type.Union([
  object({
    ...historyEntryBase,
    who: Type.Literal('agent'),
    attempt: Type.Integer({ minimum: 1 }),
    details: SessionHistoryDetails,
  }),
  object({
    ...historyEntryBase,
    /** Answers and chat are the operator's from their actor; instructions are relayed saves. */
    who: Type.Union([Type.Literal('operator'), Type.Literal('app')]),
    /** False while the item is above the session's acknowledgement cursor. */
    read: Type.Boolean(),
    details: SessionHistoryDetails,
  }),
])

/** Each attempt as its header shows it, read whole on every page so a failure or resume shows. */
export const SessionHistoryAttempt = object({
  id: Id,
  number: Type.Integer({ minimum: 1 }),
  state: ProcessingState,
  session_state: Type.Union([SessionState, Type.Null()]),
  queued_at: IsoTime,
  /**
   * When the attempt last ended, from its latest transition into its current terminal state;
   * absent while it is live. `last_activity` marks an end with no transition retained.
   */
  ended: Type.Optional(
    object({
      at: IsoTime,
      source: Type.Union([Type.Literal('transition'), Type.Literal('last_activity')]),
    }),
  ),
  /** Only where the retained data shows it; otherwise the header says just "Attempt N". */
  started_because: Type.Union([Type.Literal('first'), Type.Literal('after_failure'), Type.Null()]),
  profile_id: Type.String({ minLength: 1, maxLength: 64 }),
  runs_on: Type.Union([Type.Literal('agent_vm'), Type.Literal('host'), Type.Literal('fixture')]),
  /** Null for the deterministic synthetic profile. */
  selection: Type.Union([AgentSelection, Type.Null()]),
  actual_model: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  /** The web setting sealed in the attempt's input; null when its profile has no web access. */
  web: Type.Union([
    object({ public_pages: Type.Boolean(), prefer_datasheets: Type.Boolean() }),
    Type.Null(),
  ]),
  failure: Type.Optional(SessionFailureSummary),
})
export const SessionHistoryMetadata = object({
  job_id: Id,
  batch_id: Id,
  stage: ProcessingStageV2,
  /** Null for the batch's Examine lead session. */
  subject_id: Type.Union([Id, Type.Null()]),
  /** The job's current attempt, which may have no session after a switch to another profile. */
  current_attempt_id: Id,
  /** Every attempt, so a header is never missing from an older page. */
  attempts: Type.Array(SessionHistoryAttempt, { minItems: 1 }),
  /** Inbox items at or below this sequence were acknowledged by the session. */
  inbox_acked_seq: CursorSequence,
  /** Whether Start fresh would be accepted for the job now. */
  start_fresh: StartFreshEligibility,
})
export const SessionHistoryQuery = object({ before: Type.Optional(SessionHistoryCursor) })
/** One page of a session's history, newest first, with its metadata from the same snapshot. */
export const SessionHistory = object({
  session: SessionHistoryMetadata,
  entries: Type.Array(SessionHistoryEntry, { maxItems: MAX_HISTORY_ENTRIES }),
  /** Present when older rows exist. */
  before: Type.Optional(SessionHistoryCursor),
})

export const SessionReplacement = object({
  expected_capture_revision: Revision,
  expected_revision: Revision,
  attempt_id: Id,
})
export type SessionReplacementDto = Static<typeof SessionReplacement>

export const sessionSchemas = {
  SessionReplacement,
  SessionLatestStatus,
  SessionHistory,
  SessionHistoryCursor,
  SessionHistoryQuery,
  RegroupMove,
  LotFormingOutcome,
  SessionEnvelope,
  SessionState,
  SessionStatusArgs,
  SessionAskArgs,
  SessionAskArgsV2,
  SessionAnswerStepValue,
  SessionAnswerPayload,
  SessionReplyArgs,
  SessionReadInboxArgs,
  SessionFetchEvidenceArgs,
  SessionProposeArgs,
  SessionToolError,
  SessionToolResult,
  SessionOutboxItem,
  SessionPhotoView,
  SessionInboxItem,
  SessionInboxSubmission,
  SessionInboxReceipt,
}
export type SessionLatestStatusDto = Static<typeof SessionLatestStatus>
export type SessionHistoryDto = Static<typeof SessionHistory>
export type SessionHistoryEntryDto = Static<typeof SessionHistoryEntry>
export type SessionHistoryDetailsDto = Static<typeof SessionHistoryDetails>
export type SessionHistoryLinkDto = Static<typeof SessionHistoryLink>
export type SessionHistoryAttemptDto = Static<typeof SessionHistoryAttempt>
export type RegroupMoveDto = Static<typeof RegroupMove>
export type LotFormingOutcomeDto = Static<typeof LotFormingOutcome>
export type SessionEnvelopeDto = Static<typeof SessionEnvelope>
export type SessionStateDto = Static<typeof SessionState>
export type SessionStatusArgsDto = Static<typeof SessionStatusArgs>
export type SessionAskArgsDto = Static<typeof SessionAskArgs>
export type SessionAskArgsV2Dto = Static<typeof SessionAskArgsV2>
export type SessionAnswerStepValueDto = Static<typeof SessionAnswerStepValue>
export type SessionAnswerPayloadDto = Static<typeof SessionAnswerPayload>
export type SessionReplyArgsDto = Static<typeof SessionReplyArgs>
export type SessionReadInboxArgsDto = Static<typeof SessionReadInboxArgs>
export type SessionFetchEvidenceArgsDto = Static<typeof SessionFetchEvidenceArgs>
export type SessionProposeArgsDto = Static<typeof SessionProposeArgs>
export type SessionToolErrorDto = Static<typeof SessionToolError>
export type SessionToolResultDto = Static<typeof SessionToolResult>
export type SessionOutboxItemDto = Static<typeof SessionOutboxItem>
export type SessionPhotoViewDto = Static<typeof SessionPhotoView>
export type SessionInboxItemDto = Static<typeof SessionInboxItem>
export type SessionInboxSubmissionDto = Static<typeof SessionInboxSubmission>
export type SessionInboxReceiptDto = Static<typeof SessionInboxReceipt>
