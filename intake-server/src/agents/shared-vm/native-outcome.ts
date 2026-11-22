import { ResearchReapPendingError } from '#/research/errors.ts'
import { SessionResumeUnavailable } from '#/agents/session/session-adapters.ts'
import {
  failureCauseCode,
  NativeSessionError,
  type ProviderErrorDto,
} from '#/agents/failure-model.ts'
import { refusalOutcome, type TurnOutcome } from './journal.ts'

export interface NativeTurnSteps {
  /** Writes this turn's egress policy; the provider must not start until it succeeds. */
  publishPolicy?: () => Promise<void>
  /** Starts and runs the provider turn. */
  run: () => Promise<void>
  /** Told the provider's own error kind when the turn fails with one. */
  onProviderError?: (error: ProviderErrorDto) => void
  /** Told the specific failure code when the outcome is more general, such as agent_turn_failed. */
  onCause?: (code: string) => void
}

/**
 * Runs a native provider turn and maps its failure to a journal outcome. A policy that can't
 * be published is a recorded failure before the provider starts, so the slot is released
 * through the normal outcome instead of looking like an unconfirmed worker.
 */
export async function nativeTurnOutcome(steps: NativeTurnSteps): Promise<TurnOutcome> {
  try {
    await steps.publishPolicy?.()
    await steps.run()
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      throw error
    }
    if (error instanceof SessionResumeUnavailable) {
      return 'resume_unavailable'
    }
    if (error instanceof NativeSessionError && error.providerError) {
      steps.onProviderError?.(error.providerError)
    }
    const outcome = turnFailureOutcome(error)
    const cause = failureCauseCode(error)
    if (cause !== outcome) {
      steps.onCause?.(cause)
    }
    return outcome
  }
  return 'done'
}

function turnFailureOutcome(error: unknown): TurnOutcome {
  if (error instanceof NativeSessionError && error.code === 'agent_login_required') {
    return 'agent_login_required'
  }
  const refusal = error instanceof NativeSessionError ? refusalOutcome(error.code) : undefined
  return refusal ?? 'agent_turn_failed'
}
