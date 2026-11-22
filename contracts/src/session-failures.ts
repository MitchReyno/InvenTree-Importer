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

/** Claude Code 2.1.319's assistant `error` kinds, read from the CLI. */
export const CLAUDE_ERROR_KINDS = [
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'rate_limit',
  'overloaded',
  'invalid_request',
  'model_not_found',
  'server_error',
  'unknown',
  'max_output_tokens',
  'cloud_credential_error',
] as const

/** Claude Code's `result` subtypes. */
export const CLAUDE_RESULT_TYPES = ['success', 'error_during_execution', 'error_max_turns'] as const

/** codex-cli 0.166.0's `CodexErrorInfo` kinds, from `codex app-server generate-json-schema`. */
export const CODEX_ERROR_KINDS = [
  'contextWindowExceeded',
  'sessionBudgetExceeded',
  'usageLimitExceeded',
  'rateLimitExceeded',
  'flexUnavailable',
  'serverOverloaded',
  'modelNotFound',
  'policyCapacityUnavailable',
  'cyberPolicy',
  'misalignmentPolicyViolation',
  'tooManyDenials',
  'internalServerError',
  'unauthorized',
  'badRequest',
  'threadRollbackFailed',
  'sandboxError',
  'other',
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
  'activeTurnNotSteerable',
] as const

const literals = (values: readonly string[]) =>
  Type.Union([...new Set(values)].map((value) => Type.Literal(value)))

export const SessionFailureSummary = Type.Object(
  {
    id: Id,
    category: SessionFailureCategory,
    summary: text(256),
    /** What the operator can do next; carried here so it shows without the details read. */
    recovery: text(512),
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
    truncated: Type.Boolean(),
    /**
     * The provider's own structured error for a failed turn, from a fixed list: never its text.
     * Absent from failures retained before it existed and from turns settled from a journal.
     */
    provider_error: Type.Optional(
      Type.Object(
        {
          kind: literals(['unknown', ...CLAUDE_ERROR_KINDS, ...CODEX_ERROR_KINDS]),
          result: Type.Union([literals(CLAUDE_RESULT_TYPES), Type.Null()]),
          http_status: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)
export type SessionFailureDto = Static<typeof SessionFailure>
export type SessionFailureSummaryDto = Static<typeof SessionFailureSummary>
export const sessionFailureSchemas = { SessionFailure, SessionFailureSummary }
