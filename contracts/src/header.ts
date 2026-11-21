import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id } from './scalars.ts'
import { ProcessingStageV2, ProcessingState, ProcessingBlocker } from './processing.ts'
import { ManualRun } from './manual.ts'
import { AgentSelection } from './agent-selection.ts'
import { SessionLatestStatus, SessionState } from './sessions.ts'

const choice = <const T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)))

/** The read token in use: the server's environment token, or one saved through Settings. */
export const InventoryCredentialSource = choice(['environment', 'saved'])

/** Longest replacement token accepted, in characters. */
export const MAX_INVENTORY_TOKEN_LENGTH = 4096

/** A replacement read token. Write-only: no response ever carries it. */
export const InventoryCredentialReplace = Type.Object(
  {
    token: Type.String({
      minLength: 1,
      maxLength: MAX_INVENTORY_TOKEN_LENGTH,
      // Printable ASCII without spaces, as InvenTree issues them.
      pattern: '^[!-~]+$',
    }),
  },
  { additionalProperties: false },
)

/** Which read token is in use after a replace or revert. */
export const InventoryCredential = Type.Object(
  {
    credential_source: InventoryCredentialSource,
    credential_saved_at: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
)

export const ConnectionStatus = Type.Object(
  {
    actor_id: Id,
    target_id: Id,
    target_context_id: Id,
    target: Type.Object(
      {
        state: choice(['unconfigured', 'unknown', 'reachable', 'unavailable']),
        freshness: choice(['unobserved', 'fresh', 'stale']),
        observed_at: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
        failure_code: Type.Union([
          choice([
            'invalid_configuration',
            'timeout',
            'http_error',
            'redirect_refused',
            'unexpected_response',
            'unavailable',
            /** The target refused the read token (HTTP 401 or 403). */
            'unauthorized',
          ]),
          Type.Null(),
        ]),
        navigation_url: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
        label: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
        /** InvenTree's own version string; null when the root read gave none. */
        version: Type.Optional(
          Type.Union([
            Type.String({ minLength: 1, maxLength: 64, pattern: '^[ -~]+$' }),
            Type.Null(),
          ]),
        ),
        /** The owned test target or a configured InvenTree; absent means configured. */
        kind: Type.Optional(choice(['owned_test', 'configured'])),
        /** Which read token reads use; never the token itself. */
        credential_source: Type.Optional(InventoryCredentialSource),
        /** When the saved token was written; null while the environment token is in use. */
        credential_saved_at: Type.Optional(
          Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type ConnectionStatusDto = Static<typeof ConnectionStatus>

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

export const HeaderWorkQuery = object({ batch_id: Type.Optional(Id) })

/** Bounds the header's per-batch step counts: the open batch and a few with live work. */
export const MAX_HEADER_BATCH_STEPS = 5

const count = Type.Integer({ minimum: 0, maximum: 100000 })
const stepJobs = object({ jobs: count, ready: count, running: count })
export const HeaderWork = object({
  actor_id: Id,
  target_id: Id,
  target_context_id: Id,
  observed_at: Type.String({ maxLength: 40 }),
  work: Type.Array(
    Type.Union([
      object({
        kind: Type.Literal('processing'),
        id: Id,
        batch_id: Id,
        attempt_id: Id,
        stage: ProcessingStageV2,
        state: ProcessingState,
        input_current: Type.Union([Type.Boolean(), Type.Null()]),
        occupies_lane: Type.Boolean(),
        blocked_code: Type.Union([ProcessingBlocker, Type.Null()]),
        steps: Type.Array(object({ stage: ProcessingStageV2, state: ProcessingState }), {
          maxItems: 5,
        }),
        steps_complete: Type.Boolean(),
      }),
      object({
        kind: Type.Literal('import'),
        id: Id,
        batch_id: Id,
        stage: Type.Literal('inventory'),
        state: ManualRun.properties.state,
        steps: Type.Array(
          object({
            name: choice(['approval', 'dispatch', 'inventory']),
            state: choice([
              'confirmed',
              'not_requested',
              'queued',
              'running',
              'finished',
              'interrupted',
              'none',
              'unknown',
              'mixed',
            ]),
          }),
          { maxItems: 3 },
        ),
        steps_complete: Type.Boolean(),
      }),
    ]),
    { maxItems: 100 },
  ),
  active_sessions: Type.Array(
    object({
      attempt_id: Id,
      batch_id: Id,
      job_id: Id,
      stage: ProcessingStageV2,
      state: ProcessingState,
      /** Null for the deterministic synthetic session profile. */
      selection: Type.Union([AgentSelection, Type.Null()]),
      actual_model: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
      progress: choice(['queued', 'starting', 'responding', 'settled']),
      /** For sessions: holds a running slot. Waiting sessions hold none. */
      occupies_lane: Type.Boolean(),
      /** Session profiles only. */
      session_state: Type.Union([SessionState, Type.Null()]),
      latest_status: Type.Union([SessionLatestStatus, Type.Null()]),
    }),
    { maxItems: 50 },
  ),
  /** Each counted batch's current jobs per step; a batch without an entry is uncounted. */
  batch_steps: Type.Optional(
    Type.Array(
      object({
        batch_id: Id,
        steps: object({
          examine: stepJobs,
          research: stepJobs,
          images: stepJobs,
          inventory: stepJobs,
        }),
      }),
      { maxItems: MAX_HEADER_BATCH_STEPS },
    ),
  ),
  work_truncated: Type.Boolean(),
  sessions_truncated: Type.Boolean(),
  lane_occupied: Type.Boolean(),
})
export type HeaderWorkDto = Static<typeof HeaderWork>
export type HeaderWorkQueryDto = Static<typeof HeaderWorkQuery>

export type InventoryCredentialReplaceDto = Static<typeof InventoryCredentialReplace>
export type InventoryCredentialDto = Static<typeof InventoryCredential>

export const headerSchemas = {
  ConnectionStatus,
  HeaderWorkQuery,
  HeaderWork,
  InventoryCredentialReplace,
  InventoryCredential,
}
