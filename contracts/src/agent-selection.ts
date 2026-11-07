import { Type, type Static } from '@sinclair/typebox'
export const AgentSelection = Type.Object(
  {
    provider: Type.Union([Type.Literal('codex'), Type.Literal('claude')]),
    authentication: Type.Union([Type.Literal('api_key'), Type.Literal('subscription')]),
    model: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*(?![\\s\\S])',
    }),
  },
  { additionalProperties: false },
)
export type AgentSelectionDto = Static<typeof AgentSelection>
