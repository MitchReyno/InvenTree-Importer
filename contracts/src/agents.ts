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
    }),
    { maxItems: 50 },
  ),
  next_before: Type.Union([Id, Type.Null()]),
  /** False when the configured profile runs no agent sessions, so an empty list means nothing. */
  sessions_supported: Type.Boolean(),
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
}
export type AgentSettingsDto = Static<typeof AgentSettings>
export type AgentSettingsUpdateDto = Static<typeof AgentSettingsUpdate>
export type AgentSessionListDto = Static<typeof AgentSessionList>
