import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Id, Revision } from './scalars.ts'
import {
  ProcessingFields,
  ProcessingProposalV5,
  ProcessingQuestionSpec,
  ProcessingQuestionValue,
} from './processing.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

export const STATUS_LINE_MAX_CHARACTERS = 120
const timestamp = Type.String({ maxLength: 40 })
const message = Type.String({ minLength: 1, maxLength: 4096 })
/** One line: no line breaks, at most 120 characters. */
const statusLine = Type.String({
  minLength: 1,
  maxLength: STATUS_LINE_MAX_CHARACTERS,
  pattern: '^[^\\r\\n\\u2028\\u2029]*$',
})

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
export const SessionProposeArgs = object({ proposal: ProcessingProposalV5 })

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
    ] as const
  ).map((code) => Type.Literal(code)),
)
const outboxBase = { session_id: Id, seq: Revision, created_at: timestamp }
export const SessionOutboxItem = Type.Union([
  object({ ...outboxBase, kind: Type.Literal('status'), payload: SessionStatusArgs }),
  object({
    ...outboxBase,
    kind: Type.Literal('observation'),
    payload: object({ evidence_observation_id: Id }),
  }),
  object({ ...outboxBase, kind: Type.Literal('lot'), payload: object({ lot_id: Id }) }),
  object({
    ...outboxBase,
    kind: Type.Literal('regroup'),
    payload: object({
      lot_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
    }),
  }),
  object({ ...outboxBase, kind: Type.Literal('proposal'), payload: object({ proposal_id: Id }) }),
  object({ ...outboxBase, kind: Type.Literal('question'), payload: object({ question_id: Id }) }),
  object({ ...outboxBase, kind: Type.Literal('reply'), payload: SessionReplyArgs }),
])

const inboxBase = { id: Id, seq: Revision, created_at: timestamp }
export const SessionInboxItem = Type.Union([
  object({
    ...inboxBase,
    kind: Type.Literal('answer'),
    payload: object({ question_id: Id, answer_id: Id, value: ProcessingQuestionValue }),
  }),
  object({ ...inboxBase, kind: Type.Literal('chat'), payload: object({ text: message }) }),
  object({
    ...inboxBase,
    kind: Type.Literal('evidence'),
    payload: object({ evidence_id: Id, version_id: Id }),
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
    /** The proposal, question or outbox item a write created. */
    id: Type.Optional(Id),
    items: Type.Optional(Type.Array(SessionInboxItem, { maxItems: 20 })),
  }),
  object({
    ok: Type.Literal(false),
    error: SessionToolError,
    message: Type.String({ minLength: 1, maxLength: 1024 }),
    pending_inbox: Type.Integer({ minimum: 0 }),
    revision: Type.Optional(Revision),
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
  object({ ...sessionBinding, kind: Type.Literal('proposal'), payload: ProcessingProposalV5 }),
  object({ ...sessionBinding, kind: Type.Literal('question'), payload: SessionAskArgs }),
])
export const sessionSchemas = {
  SessionEnvelope,
  SessionState,
  SessionStatusArgs,
  SessionAskArgs,
  SessionReplyArgs,
  SessionReadInboxArgs,
  SessionFetchEvidenceArgs,
  SessionProposeArgs,
  SessionToolError,
  SessionToolResult,
  SessionOutboxItem,
  SessionInboxItem,
  SessionInboxSubmission,
  SessionInboxReceipt,
}
export type SessionEnvelopeDto = Static<typeof SessionEnvelope>
export type SessionStateDto = Static<typeof SessionState>
export type SessionStatusArgsDto = Static<typeof SessionStatusArgs>
export type SessionAskArgsDto = Static<typeof SessionAskArgs>
export type SessionReplyArgsDto = Static<typeof SessionReplyArgs>
export type SessionReadInboxArgsDto = Static<typeof SessionReadInboxArgs>
export type SessionFetchEvidenceArgsDto = Static<typeof SessionFetchEvidenceArgs>
export type SessionProposeArgsDto = Static<typeof SessionProposeArgs>
export type SessionToolErrorDto = Static<typeof SessionToolError>
export type SessionToolResultDto = Static<typeof SessionToolResult>
export type SessionOutboxItemDto = Static<typeof SessionOutboxItem>
export type SessionInboxItemDto = Static<typeof SessionInboxItem>
export type SessionInboxSubmissionDto = Static<typeof SessionInboxSubmission>
export type SessionInboxReceiptDto = Static<typeof SessionInboxReceipt>
