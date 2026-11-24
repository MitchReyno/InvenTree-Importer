import { IntakeRequestError } from '@invimport/contracts/client'
import {
  START_FRESH_REFUSALS,
  type StartFreshEligibilityDto,
  type StartFreshRefusal,
} from '@invimport/contracts'

const REASONS: Record<StartFreshRefusal, string> = {
  unsupported_processing_profile: 'This server’s processing profile doesn’t run agent sessions.',
  batch_archived: 'The batch is archived. Resume it to start a fresh session.',
  subject_retired: 'This lot was retired, so its session can’t start again.',
  media_not_ready: 'Photos linked to this lot are still being prepared.',
  media_input_capacity: 'The lot has more photo versions than one session can take.',
  session_not_replaceable: 'Only a failed, stopped or interrupted session can start fresh.',
  session_reap_pending:
    'An earlier attempt still holds its slot until its process is confirmed stopped.',
  inventory_waiting: 'Inventory waits until Research and Images have current results.',
  identity_waiting: 'The lot’s identity is being revised; wait for that to finish.',
  agent_profile_retired: 'This step’s agent profile has been retired.',
  unsupported_processing_stage: 'This step can’t run as an agent session.',
  agent_settings_required: 'No agent is chosen for this step. Choose one in Agent settings.',
  processing_input_capacity: 'The session’s new input would be larger than one session allows.',
  processing_channel_unconfigured:
    'Processing setup is required: no private runner channel is configured.',
}

const REFUSALS = new Set<string>(START_FRESH_REFUSALS)

/** Why Start fresh is unavailable, or undefined when it would be accepted. */
export function startFreshReason(eligibility: StartFreshEligibilityDto | undefined) {
  if (!eligibility || eligibility.allowed) {
    return undefined
  }
  return REASONS[eligibility.reason]
}

/** The reason a Start fresh the server refused gives, when it is one of the preflight's. */
export function startFreshRefusal(failure: unknown) {
  if (failure instanceof IntakeRequestError && REFUSALS.has(failure.code)) {
    return REASONS[failure.code as StartFreshRefusal]
  }
  return undefined
}
