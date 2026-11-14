import { Type, type Static } from '@sinclair/typebox'
import { Id, CursorSequence } from './scalars.ts'

export const SessionFailureCategory = Type.Union(
  (
    [
      'authentication',
      'configuration',
      'tool_policy',
      'validation',
      'evidence',
      'provider_network',
      'timeout',
      'interrupted',
      'internal',
    ] as const
  ).map((value) => Type.Literal(value)),
)

const text = (maximum: number) => Type.String({ maxLength: maximum })

export const SessionFailureSummary = Type.Object(
  {
    id: Id,
    category: SessionFailureCategory,
    summary: text(256),
    details_available: Type.Boolean(),
  },
  { additionalProperties: false },
)
export const SessionFailure = Type.Object(
  {
    ...SessionFailureSummary.properties,
    attempt_id: Id,
    lineage_id: Id,
    turn: CursorSequence,
    timestamp: text(40),
    correlation_id: Id,
    code: text(80),
    stage: Type.Union([Type.Literal('startup'), Type.Literal('turn'), Type.Literal('reap')]),
    provider: Type.Union([Type.Literal('codex'), Type.Literal('claude'), Type.Null()]),
    model: Type.Union([text(128), Type.Null()]),
    cli_version: Type.Union([text(40), Type.Null()]),
    provider_session_id: Type.Union([text(128), Type.Null()]),
    causes: Type.Array(
      Type.Object({ code: text(80), summary: text(256) }, { additionalProperties: false }),
      { maxItems: 4 },
    ),
    recovery: text(512),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type SessionFailureDto = Static<typeof SessionFailure>
export type SessionFailureSummaryDto = Static<typeof SessionFailureSummary>
export const sessionFailureSchemas = { SessionFailure, SessionFailureSummary }
