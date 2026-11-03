import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, Revision, CursorSequence } from './scalars.ts'
import {
  ProcessingState,
  ProcessingStage,
  ProcessingQuestionSpec,
  ProcessingProposalV2,
} from './processing.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

import { AgentSelection } from './agent-selection.ts'
export { AgentSelection, type AgentSelectionDto } from './agent-selection.ts'
export const AgentSettings = object({
  revision: CursorSequence,
  selection: Type.Union([AgentSelection, Type.Null()]),
})
export const AgentSettingsUpdate = object({
  expected_revision: CursorSequence,
  selection: AgentSelection,
})
export const AgentSessionList = object({
  sessions: Type.Array(
    object({
      attempt_id: Id,
      batch_id: Id,
      job_id: Id,
      subject_id: Id,
      stage: ProcessingStage,
      state: ProcessingState,
      latest_on_job: Type.Boolean(),
      selection: AgentSelection,
      settings_revision: Revision,
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
    }),
    { maxItems: 50 },
  ),
  next_before: Type.Union([Id, Type.Null()]),
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
