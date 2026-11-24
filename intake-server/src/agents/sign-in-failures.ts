import type { Pool } from 'pg'
import {
  validate,
  type ProviderSignInFailureDto,
  type SessionFailureDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { decodeJobInput } from '#/processing/session-input.ts'
import type { StatusProvider } from './shared-vm/provider-status.ts'

/** The provider's own refusal of a sign-in: never a missing token or an unreachable guest. */
const REFUSED_SIGN_IN_KIND: Record<StatusProvider, string> = {
  claude: 'authentication_failed',
  codex: 'unauthorized',
}
const UNAUTHORIZED_HTTP_STATUS = 401

interface LatestSessionRow {
  attempt_id: string
  provider: string
  manifest_bytes: Buffer
  manifest_digest: Buffer
  failure_id: string | null
  diagnostic: SessionFailureDto | null
}

/**
 * Each provider's latest queued sessions in this scope, in either sign-in mode, with the failure
 * retained for each one's current turn. Several share the latest time only when queued together.
 */
async function latestSessions(pool: Pool, binding: ProcessingConfig) {
  const result = await pool.query<LatestSessionRow>(
    `
    WITH scoped AS (
      SELECT session.attempt_id, session.queued_at, session.turn_count,
        input.manifest_bytes, input.manifest_digest,
        convert_from(input.manifest_bytes, 'UTF8')::jsonb #>> '{agent,provider}' AS provider
      FROM agent_session session
      JOIN processing_attempt attempt ON attempt.id = session.attempt_id
      JOIN processing_input input ON input.id = attempt.input_id
      JOIN command command ON command.id = attempt.command_id
      WHERE command.actor_id = $1 AND command.target_id = $2 AND command.target_context_id = $3
    ),
    ranked AS (
      SELECT scoped.*, rank() OVER (PARTITION BY provider ORDER BY queued_at DESC) AS place
      FROM scoped
      WHERE provider IN ('claude', 'codex')
    )
    SELECT ranked.attempt_id, ranked.provider, ranked.manifest_bytes, ranked.manifest_digest,
      failure.id AS failure_id, failure.diagnostic
    FROM ranked
    LEFT JOIN agent_session_failure failure
      ON failure.attempt_id = ranked.attempt_id AND failure.turn_count = ranked.turn_count
    WHERE ranked.place = 1
    ORDER BY ranked.attempt_id DESC`,
    [binding.actorId, binding.targetId, binding.targetContextId],
  )
  return result.rows
}

/** Whether this session used the subscription and its current turn's provider refused sign-in. */
function refusedSignIn(provider: StatusProvider, row: LatestSessionRow) {
  const manifest = decodeJobInput(row.manifest_bytes, row.manifest_digest)
  // Only session inputs (`/4` and `/6`) seal an agent selection.
  const agent = 'agent' in manifest ? manifest.agent : undefined
  if (agent?.provider !== provider || agent.authentication !== 'subscription') {
    return false
  }
  if (!row.diagnostic) {
    return false
  }
  validate('SessionFailure', row.diagnostic)
  const error = row.diagnostic.provider_error
  if (!error) {
    return false
  }
  return (
    error.kind === REFUSED_SIGN_IN_KIND[provider] || error.http_status === UNAUTHORIZED_HTTP_STATUS
  )
}

/**
 * The last-session line for each provider: shown only when every one of its latest sessions
 * used the subscription and was refused sign-in by the provider.
 */
export async function lastSignInFailures(
  pool: Pool,
  binding: ProcessingConfig,
): Promise<Record<StatusProvider, ProviderSignInFailureDto | null>> {
  const rows = await latestSessions(pool, binding)
  const lines: Record<StatusProvider, ProviderSignInFailureDto | null> = {
    claude: null,
    codex: null,
  }
  for (const provider of ['claude', 'codex'] as const) {
    const latest = rows.filter((row) => row.provider === provider)
    const first = latest[0]
    if (!first || !latest.every((row) => refusedSignIn(provider, row))) {
      continue
    }
    lines[provider] = {
      attempt_id: first.attempt_id,
      failure_id: first.failure_id!,
      failed_at: first.diagnostic!.timestamp,
    }
  }
  return lines
}
