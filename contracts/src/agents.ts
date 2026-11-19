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
import type { AgentSelectionDto } from './agent-selection.ts'
export { AgentSelection, type AgentSelectionDto } from './agent-selection.ts'
/** How many sessions may run provider turns at once; waiting sessions hold no slot. */
export const SessionConcurrency = Type.Integer({ minimum: 1, maximum: 8 })
export type AgentProviderId = AgentSelectionDto['provider']
/** Suggested model IDs per provider, first one first; models stay free text. */
export const AGENT_MODEL_SUGGESTIONS: Record<AgentProviderId, readonly string[]> = {
  claude: ['sonnet', 'opus', 'haiku'],
  codex: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-luna'],
}
/** The steps that can name their own provider and model; any other step uses the default. */
export const AGENT_SETTINGS_STAGES = ['examine', 'research', 'images', 'inventory'] as const
export type AgentSettingsStage = (typeof AGENT_SETTINGS_STAGES)[number]

// Bounded by the request body; the model ID pattern and its 128-character limit are checked on
// save, which answers invalid_agent_settings.
const modelText = Type.String()
const providerFields = {
  enabled: Type.Boolean(),
  authentication: AgentSelection.properties.authentication,
  /** May be empty while the provider is off. */
  default_model: modelText,
}
export const AgentProviderSettings = object(providerFields)
export const AgentStageSelection = object({
  provider: AgentSelection.properties.provider,
  model: modelText,
})
/** A step that is absent uses the default provider and its default model. */
export const AgentStageSelections = object({
  examine: Type.Optional(AgentStageSelection),
  research: Type.Optional(AgentStageSelection),
  images: Type.Optional(AgentStageSelection),
  inventory: Type.Optional(AgentStageSelection),
})
const agentSettingsFields = {
  providers: object({ claude: AgentProviderSettings, codex: AgentProviderSettings }),
  /** Null exactly when no provider is on. */
  default_provider: Type.Union([AgentSelection.properties.provider, Type.Null()]),
  stage_selections: AgentStageSelections,
  session_concurrency: SessionConcurrency,
  /** Copied into each new batch's instructions at creation. */
  new_batch_instructions: Type.String({ maxLength: 8192 }),
  /** Operator guidance sealed into each new session for Part descriptions. */
  part_description_style: Type.String({ maxLength: 500 }),
  /** Whether new batches start with Auto tags on. */
  auto_tags_default: Type.Boolean(),
}
export const AgentSettings = object({ revision: CursorSequence, ...agentSettingsFields })
/** The whole settings object, saved under one revision. */
export const AgentSettingsUpdate = object({
  expected_revision: CursorSequence,
  ...agentSettingsFields,
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
  AgentProviderSettings,
  AgentStageSelection,
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
export type AgentProviderSettingsDto = Static<typeof AgentProviderSettings>
export type AgentStageSelectionDto = Static<typeof AgentStageSelection>
export type AgentSessionListDto = Static<typeof AgentSessionList>
