import {
  failureCauseCode,
  NativeSessionError,
  retainedCause,
  retainedProviderError,
} from '#/agents/failure-model.ts'
import { SessionResumeUnavailable } from '#/agents/session/session-adapters.ts'
import { refusalOutcome } from './journal.ts'

/**
 * The tool worker's frame for a failed turn, with the provider's own error kind when it gave
 * one. The worker runs the provider; the supervisor re-checks this with `workerOutcomeError`.
 */
export function workerFailure(error: unknown) {
  let outcome = 'agent_turn_failed'
  if (error instanceof SessionResumeUnavailable) {
    outcome = 'resume_unavailable'
  }
  if (error instanceof NativeSessionError && error.message === 'agent_login_required') {
    outcome = 'agent_login_required'
  }
  // A tool-policy refusal keeps its code, so the operator sees why the turn stopped.
  outcome = (error instanceof NativeSessionError && refusalOutcome(error.code)) || outcome
  const providerError = error instanceof NativeSessionError ? error.providerError : undefined
  const carriesProviderError =
    providerError && (outcome === 'agent_turn_failed' || outcome === 'agent_login_required')
  // The specific code the outcome would otherwise hide, such as agent_protocol_invalid.
  const cause = failureCauseCode(error)
  return {
    outcome,
    ...(carriesProviderError ? { provider_error: providerError } : {}),
    ...(cause !== outcome ? { cause } : {}),
  }
}

/**
 * The error a worker's outcome frame stands for, or undefined for any other frame. The provider
 * error is re-checked against the fixed lists before it is kept.
 */
export function workerOutcomeError(
  message: Record<string, unknown>,
  provider: 'claude' | 'codex' | undefined,
) {
  if (message.outcome === 'resume_unavailable') {
    return new SessionResumeUnavailable()
  }
  if (message.outcome === 'agent_login_required' || message.outcome === 'agent_turn_failed') {
    return new NativeSessionError(message.outcome, {
      providerError: retainedProviderError(provider, message.provider_error),
      cause: retainedCause(message.cause),
    })
  }
  const refusal = refusalOutcome(message.outcome)
  return refusal ? new NativeSessionError(refusal) : undefined
}
