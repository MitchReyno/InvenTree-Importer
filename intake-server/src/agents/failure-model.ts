import { randomUUID } from 'node:crypto'
import {
  CLAUDE_ERROR_KINDS,
  CLAUDE_RESULT_TYPES,
  CODEX_ERROR_KINDS,
  type SessionFailureCode,
  type SessionFailureDto,
} from '@invimport/contracts'

type Category = SessionFailureDto['category']
/** Typed into the contracts' code list, so a code the summaries can't name doesn't compile. */
export const categories: Record<Exclude<SessionFailureCode, 'agent_unknown'>, Category> = {
  agent_login_required: 'authentication',
  agent_credentials_unavailable: 'authentication',
  agent_process_unavailable: 'configuration',
  agent_vm_unavailable: 'provider_network',
  agent_version_unqualified: 'configuration',
  agent_version_unavailable: 'configuration',
  agent_admission_unavailable: 'configuration',
  agent_admission_timeout: 'timeout',
  agent_home_unavailable: 'configuration',
  agent_home_customizations_refused: 'configuration',
  agent_input_invalid: 'configuration',
  agent_profile_retired: 'configuration',
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
export type ProviderErrorDto = NonNullable<SessionFailureDto['provider_error']>

const CLAUDE_KINDS = new Set<string>(CLAUDE_ERROR_KINDS)
const CLAUDE_RESULTS = new Set<string>(CLAUDE_RESULT_TYPES)
const CODEX_KINDS = new Set<string>(CODEX_ERROR_KINDS)

const PROVIDER_ERROR_KINDS = { claude: CLAUDE_KINDS, codex: CODEX_KINDS }

/**
 * A provider error reduced to the fixed lists: an unlisted kind is `unknown`, and an unlisted
 * result type or an out-of-range status is null. Provider text never enters it.
 */
export function providerError(
  provider: 'claude' | 'codex',
  reported: { kind?: unknown; result?: unknown; httpStatus?: unknown },
): ProviderErrorDto {
  const kind = reported.kind
  const listedKind =
    typeof kind === 'string' && PROVIDER_ERROR_KINDS[provider].has(kind) ? kind : 'unknown'
  const result =
    provider === 'claude' &&
    typeof reported.result === 'string' &&
    CLAUDE_RESULTS.has(reported.result)
      ? reported.result
      : null
  const status = reported.httpStatus
  const httpStatus =
    Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599
      ? (status as number)
      : null
  return { kind: listedKind, result, http_status: httpStatus }
}

/** A provider error retained from the guest or another boundary, re-checked against the lists. */
export function retainedProviderError(
  provider: 'claude' | 'codex' | null | undefined,
  value: unknown,
): ProviderErrorDto | undefined {
  if (!provider || !value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const reported = value as Record<string, unknown>
  return providerError(provider, {
    kind: reported.kind,
    result: reported.result,
    httpStatus: reported.http_status,
  })
}

export class NativeSessionError extends Error {
  /** The provider's own error kind, when a turn failed with one. */
  readonly providerError?: ProviderErrorDto

  constructor(
    readonly code: string,
    options?: ErrorOptions & { providerError?: ProviderErrorDto },
  ) {
    super(code, options)
    this.providerError = options?.providerError
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

/** Codes whose summary and recovery are more specific than their category's. */
const codeDescriptions: Partial<Record<string, { summary: string; recovery: string }>> = {
  agent_profile_retired: {
    summary: 'This step was queued under an agent profile that has since been retired.',
    recovery: 'Run the step again to start it under the current profile. Its history is kept.',
  },
  agent_vm_unavailable: {
    summary: 'The agent VM had no connection for this provider.',
    recovery:
      'Check that the VM and its relays are running (pnpm dev starts them), then run the step again.',
  },
}

function known(error: unknown) {
  const code: SessionFailureCode =
    error instanceof NativeSessionError && Object.hasOwn(categories, error.code)
      ? (error.code as SessionFailureCode)
      : 'agent_unknown'
  const category = code === 'agent_unknown' ? 'internal' : categories[code]
  return { code, category, ...descriptions[category], ...codeDescriptions[code] }
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
    ...providerErrorField(error, context.provider),
  }
}

function providerErrorField(error: unknown, provider: Context['provider']) {
  if (!(error instanceof NativeSessionError)) {
    return {}
  }
  const retained = retainedProviderError(provider, error.providerError)
  return retained ? { provider_error: retained } : {}
}

/**
 * The most specific typed code behind a failure: a wrapped cause's, or the error's own. An
 * untyped error is `agent_unknown`, so no exception text ever leaves the process that saw it.
 */
export function failureCauseCode(error: unknown) {
  if (!(error instanceof NativeSessionError)) {
    return 'agent_unknown'
  }
  return error.cause instanceof NativeSessionError ? error.cause.code : error.code
}

/** A cause received from a guest or tool worker, kept only when it is a registered code. */
export function retainedCause(value: unknown) {
  // agent_unknown is the senders' code for an untyped error; it has no category of its own.
  const registered =
    typeof value === 'string' && (value === 'agent_unknown' || Object.hasOwn(categories, value))
  return registered ? new NativeSessionError(value as string) : undefined
}
