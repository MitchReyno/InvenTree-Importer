import { SessionFailureSummary } from './session-failures.ts'
import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, Revision, CursorSequence } from './scalars.ts'
import {
  ProcessingState,
  ProcessingStageV2,
  ProcessingQuestionSpec,
  ProcessingProposalV2,
} from './processing.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

import { AgentSelection } from './agent-selection.ts'
import { SessionLatestStatus, SessionState } from './sessions.ts'
export { AgentSelection, type AgentSelectionDto } from './agent-selection.ts'
/** How many sessions may run provider turns at once; waiting sessions hold no slot. */
export const SessionConcurrency = Type.Integer({ minimum: 1, maximum: 8 })
export const AgentSettings = object({
  revision: CursorSequence,
  selection: Type.Union([AgentSelection, Type.Null()]),
  session_concurrency: SessionConcurrency,
})
export const AgentSettingsUpdate = object({
  expected_revision: CursorSequence,
  selection: AgentSelection,
  /** Omitted keeps the saved limit (3 until first set). */
  session_concurrency: Type.Optional(SessionConcurrency),
})
export const AgentSessionList = object({
  sessions: Type.Array(
    object({
      attempt_id: Id,
      batch_id: Id,
      job_id: Id,
      /** Null only for the batch-level Examine lead session. */
      subject_id: Type.Union([Id, Type.Null()]),
      stage: ProcessingStageV2,
      state: ProcessingState,
      latest_on_job: Type.Boolean(),
      /** Null for the deterministic synthetic session profile. */
      selection: Type.Union([AgentSelection, Type.Null()]),
      settings_revision: Type.Union([Revision, Type.Null()]),
      queued_at: Type.String({ maxLength: 40 }),
      started_at: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
      finished_at: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
      native_session_id: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
      actual_model: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
      progress: Type.Union([
        Type.Literal('queued'),
        Type.Literal('starting'),
        Type.Literal('responding'),
        Type.Literal('settled'),
      ]),
      occupies_lane: Type.Boolean(),
      /** Session profiles only. */
      session_state: Type.Union([SessionState, Type.Null()]),
      failure: Type.Optional(SessionFailureSummary),
      latest_status: Type.Union([SessionLatestStatus, Type.Null()]),
      /** Its batch's agents are paused: it starts no new work until resumed. */
      paused: Type.Optional(Type.Literal(true)),
    }),
    { maxItems: 50 },
  ),
  /** Every paused batch of the account, whether or not its sessions are on this page. */
  paused_batch_ids: Type.Optional(Type.Array(Id, { maxItems: 1000 })),
  /** More batches are paused than the list holds; each session row still says its own. */
  paused_truncated: Type.Optional(Type.Literal(true)),
  next_before: Type.Union([Id, Type.Null()]),
  /** False when the configured profile runs no agent sessions, so an empty list means nothing. */
  sessions_supported: Type.Boolean(),
})
/** A saved instruction sent to the batch's sessions; finished ones are woken to apply it. */
export const InstructionDelivery = object({
  sessions: Type.Integer({ minimum: 0, maximum: 100000 }),
  woken: Type.Integer({ minimum: 0, maximum: 100000 }),
})
/** Pauses or resumes agent sessions; pausing cancels nothing. */
export const AgentPauseUpdate = object({ paused: Type.Boolean() })
export const AgentPause = object({ batch_id: Id, paused: Type.Boolean() })
export const AgentPauseAll = object({
  paused: Type.Boolean(),
  /** The batches the change reached. */
  batch_ids: Type.Array(Id, { maxItems: 1000 }),
})
export const NativeAgentResult = object({
  proposal: Type.Union([ProcessingProposalV2, Type.Null()]),
  question: Type.Union([ProcessingQuestionSpec, Type.Null()]),
})
export type NativeAgentResultDto = Static<typeof NativeAgentResult>
export const agentSchemas = {
  NativeAgentResult,
  AgentSelection,
  AgentSettings,
  AgentSettingsUpdate,
  AgentSessionList,
  AgentPauseUpdate,
  AgentPause,
  AgentPauseAll,
  InstructionDelivery,
}
export type InstructionDeliveryDto = Static<typeof InstructionDelivery>
export type AgentPauseUpdateDto = Static<typeof AgentPauseUpdate>
export type AgentPauseDto = Static<typeof AgentPause>
export type AgentPauseAllDto = Static<typeof AgentPauseAll>
export type AgentSettingsDto = Static<typeof AgentSettings>
export type AgentSettingsUpdateDto = Static<typeof AgentSettingsUpdate>
export type AgentSessionListDto = Static<typeof AgentSessionList>
