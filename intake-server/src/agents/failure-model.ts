import { randomUUID } from 'node:crypto'
import type { SessionFailureDto } from '@invimport/contracts'

type Category = SessionFailureDto['category']
const categories: Record<string, Category> = {
  agent_login_required: 'authentication',
  agent_credentials_unavailable: 'authentication',
  agent_process_unavailable: 'configuration',
  agent_version_unqualified: 'configuration',
  agent_version_unavailable: 'configuration',
  agent_admission_unavailable: 'configuration',
  agent_admission_timeout: 'timeout',
  agent_home_unavailable: 'configuration',
  agent_home_customizations_refused: 'configuration',
  agent_input_invalid: 'configuration',
  agent_host_customization_refused: 'configuration',
  agent_policy_refused: 'tool_policy',
  agent_tool_refused: 'tool_policy',
  agent_request_refused: 'provider_network',
  agent_protocol_invalid: 'provider_network',
  agent_process_failed: 'provider_network',
  agent_input_closed: 'provider_network',
  agent_delivery_failed: 'provider_network',
  agent_turn_failed: 'provider_network',
  agent_result_missing: 'provider_network',
  agent_truncated_frame: 'provider_network',
  agent_output_capacity: 'provider_network',
  agent_frame_capacity: 'provider_network',
  agent_timeout: 'timeout',
  agent_cancelled: 'interrupted',
  agent_worker_interrupted: 'interrupted',
  resume_unavailable: 'configuration',
  agent_reap_pending: 'interrupted',
  invalid_contract: 'validation',
  evidence_unavailable: 'evidence',
}
const descriptions: Record<Category, { summary: string; recovery: string }> = {
  authentication: {
    summary: 'The provider needs authentication.',
    recovery:
      'Check the selected provider login or API credential, then explicitly start a fresh session.',
  },
  configuration: {
    summary: 'The native session configuration was not accepted.',
    recovery:
      'Check the supported CLI version and configuration. Start a fresh conversation after correcting it.',
  },
  tool_policy: {
    summary: 'The provider attempted an operation outside the allowed tool policy.',
    recovery:
      'Check the supported CLI configuration. Keep this conversation stopped and start a fresh session after correcting it.',
  },
  validation: {
    summary: 'The session returned an invalid result.',
    recovery: 'Review the required result fields before explicitly retrying.',
  },
  evidence: {
    summary: 'Required evidence could not be delivered.',
    recovery: 'Check that the evidence is available in this batch before explicitly retrying.',
  },
  provider_network: {
    summary: 'The provider connection or protocol failed.',
    recovery: 'Check provider availability and connection settings before explicitly retrying.',
  },
  timeout: {
    summary: 'The provider turn exceeded its time limit.',
    recovery: 'Review the session history before explicitly retrying the work.',
  },
  interrupted: {
    summary: 'The provider turn was interrupted.',
    recovery:
      'Wait until the process is confirmed stopped before explicitly resuming or starting fresh.',
  },
  internal: {
    summary: 'The session failed for an unclassified reason.',
    recovery:
      'Use the correlation ID to investigate. Details from arbitrary exceptions are not retained.',
  },
}

/** Only explicitly typed application failures may supply a diagnostic code. */
export class NativeSessionError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options)
  }
}
interface Context {
  attemptId: string
  lineageId: string
  turn: string
  stage: SessionFailureDto['stage']
  provider?: 'codex' | 'claude' | null
  model?: string | null
  providerSessionId?: string | null
  cliVersion?: string | null
}

function known(error: unknown) {
  const code =
    error instanceof NativeSessionError && Object.hasOwn(categories, error.code)
      ? error.code
      : 'agent_unknown'
  const category = categories[code] ?? 'internal'
  return { code, category, ...descriptions[category] }
}

/** Construct an allowlisted record; never serialize an Error, stack or provider payload. */
export function sessionFailure(error: unknown, context: Context): SessionFailureDto {
  const failure = known(error)
  const causes: SessionFailureDto['causes'] = []
  const seen = new Set<unknown>([error])
  let cause = error instanceof Error ? error.cause : undefined
  while (cause && causes.length < 4 && !seen.has(cause)) {
    seen.add(cause)
    const detail = known(cause)
    causes.push({ code: detail.code, summary: detail.summary })
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return {
    id: randomUUID(),
    details_available: true,
    attempt_id: context.attemptId,
    lineage_id: context.lineageId,
    turn: context.turn,
    timestamp: new Date().toISOString(),
    correlation_id: randomUUID(),
    code: failure.code,
    category: failure.category,
    summary: failure.summary,
    recovery: failure.recovery,
    stage: context.stage,
    provider: context.provider ?? null,
    model:
      context.model && /^(?:gpt-|o[1-9]|claude-)[a-zA-Z0-9.-]{0,110}$/.test(context.model)
        ? context.model
        : null,
    provider_session_id:
      context.providerSessionId && /^[0-9a-f-]{36}$/.test(context.providerSessionId)
        ? context.providerSessionId
        : null,
    cli_version:
      context.cliVersion && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(context.cliVersion)
        ? context.cliVersion
        : null,
    causes,
    truncated: Boolean(cause),
  }
}
