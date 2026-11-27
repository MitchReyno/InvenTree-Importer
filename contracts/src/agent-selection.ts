import { Type, type Static } from '@sinclair/typebox'

/**
 * A provider-defined effort level, such as `high`. Only its shape is checked: the levels a model
 * accepts come from the provider, and a saved level is sent as saved.
 */
export const AgentEffort = Type.String({ pattern: '^[a-z][a-z0-9_-]{0,31}(?![\\s\\S])' })
export type AgentEffortDto = Static<typeof AgentEffort>

const selectionFields = {
  provider: Type.Union([Type.Literal('codex'), Type.Literal('claude')]),
  authentication: Type.Union([Type.Literal('api_key'), Type.Literal('subscription')]),
  model: Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*(?![\\s\\S])',
  }),
}
export const AgentSelection = Type.Object(
  {
    ...selectionFields,
    /** The effort sent with each turn; absent is the provider's default, and nothing is sent. */
    effort: Type.Optional(AgentEffort),
  },
  { additionalProperties: false },
)
export type AgentSelectionDto = Static<typeof AgentSelection>
/** The one-turn `native-agent/1` input's selection, which never carries an effort. */
export const OneTurnAgentSelection = Type.Object(selectionFields, { additionalProperties: false })
