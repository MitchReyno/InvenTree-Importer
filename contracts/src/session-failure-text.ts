import type {
  CLAUDE_ERROR_KINDS,
  CODEX_ERROR_KINDS,
  SessionFailureCauseDto,
  SessionFailureCode,
} from './session-failures.ts'

type ClaudeKind = (typeof CLAUDE_ERROR_KINDS)[number]
type CodexKind = (typeof CODEX_ERROR_KINDS)[number]
/** Builds a sentence about the named provider: "Claude", "Codex" or "the agent". */
type Sentence = (provider: string) => string

const claudeKinds: Record<ClaudeKind, Sentence> = {
  authentication_failed: (p) => `${p} couldn't sign in`,
  oauth_org_not_allowed: (p) => `${p} refused the signed-in account's organisation`,
  account_on_hold: (p) => `${p}'s account is on hold`,
  verification_required: (p) => `${p} needs the account to be verified`,
  billing_error: (p) => `${p} refused the request because of a billing problem`,
  rate_limit: (p) => `${p}'s rate limit was reached`,
  overloaded: (p) => `Couldn't reach ${p}: the API was overloaded`,
  invalid_request: (p) => `${p} refused the request as invalid`,
  model_not_found: (p) => `${p} doesn't offer the chosen model`,
  server_error: (p) => `Couldn't reach ${p}: the API had a server error`,
  unknown: (p) => `${p} reported an error without naming it`,
  max_output_tokens: (p) => `Stopped: ${p}'s reply reached its output limit`,
  cloud_credential_error: (p) => `${p} couldn't use its cloud credentials`,
}

const codexKinds: Record<CodexKind, Sentence> = {
  contextWindowExceeded: (p) => `Stopped: the conversation outgrew ${p}'s context window`,
  sessionBudgetExceeded: () => 'Stopped: the session used up its budget',
  usageLimitExceeded: (p) => `${p}'s usage limit was reached`,
  rateLimitExceeded: (p) => `${p}'s rate limit was reached`,
  flexUnavailable: (p) => `${p}'s flex capacity wasn't available`,
  serverOverloaded: (p) => `Couldn't reach ${p}: the API was overloaded`,
  modelNotFound: (p) => `${p} doesn't offer the chosen model`,
  policyCapacityUnavailable: (p) => `${p} had no capacity for this request`,
  cyberPolicy: (p) => `${p} refused the request under its security policy`,
  misalignmentPolicyViolation: (p) => `${p} refused the request under its usage policy`,
  tooManyDenials: () => "Stopped: too many of the agent's actions were refused",
  internalServerError: (p) => `Couldn't reach ${p}: the API had a server error`,
  unauthorized: (p) => `${p} couldn't sign in`,
  badRequest: (p) => `${p} refused the request as invalid`,
  threadRollbackFailed: (p) => `${p} couldn't roll the conversation back`,
  sandboxError: (p) => `${p}'s sandbox failed`,
  other: (p) => `${p} reported an error without naming it`,
  httpConnectionFailed: (p) => `Couldn't reach ${p}: the connection failed`,
  responseStreamConnectionFailed: (p) => `Couldn't reach ${p}: its reply couldn't be streamed`,
  responseStreamDisconnected: (p) => `Lost ${p}: its reply stream disconnected`,
  responseTooManyFailedAttempts: (p) => `Couldn't reach ${p}: too many attempts failed`,
  activeTurnNotSteerable: (p) => `${p} couldn't take a message during its turn`,
}

const codes: Record<SessionFailureCode, Sentence> = {
  agent_login_required: (p) => `${p} needs you to sign in again`,
  agent_credentials_unavailable: (p) => `${p}'s credentials weren't available`,
  agent_process_unavailable: (p) => `The ${p} CLI couldn't be started`,
  agent_version_unqualified: (p) => `The ${p} CLI version isn't supported`,
  agent_version_unavailable: (p) => `The ${p} CLI's version couldn't be read`,
  agent_admission_unavailable: (p) => `The ${p} CLI refused this session's setup`,
  agent_admission_timeout: (p) => `The ${p} CLI took too long to accept this session's setup`,
  agent_home_unavailable: (p) => `${p}'s home directory wasn't available`,
  agent_home_customizations_refused: (p) =>
    `${p}'s home directory holds customisations the app refuses`,
  agent_input_invalid: () => "The session's input was refused",
  agent_profile_retired: () => 'This step was queued under an agent profile since retired',
  agent_host_customization_refused: (p) =>
    `The host's ${p} setup holds customisations the app refuses`,
  agent_policy_refused: () => "Stopped: the agent's setup didn't match the allowed tools",
  agent_tool_refused: () => "Stopped: the agent tried a tool it isn't allowed to use",
  agent_request_refused: (p) => `${p} refused the request`,
  agent_protocol_invalid: (p) => `${p} sent a reply the app couldn't read`,
  agent_process_failed: (p) => `The ${p} process stopped unexpectedly`,
  agent_input_closed: (p) => `The ${p} process stopped reading its input`,
  agent_delivery_failed: (p) => `The turn couldn't be delivered to ${p}`,
  agent_turn_failed: (p) => `${p}'s turn failed`,
  agent_result_missing: (p) => `${p} finished without a result`,
  agent_truncated_frame: (p) => `${p}'s reply was cut off`,
  agent_output_capacity: () => "Stopped: the agent's reply was larger than the session allows",
  agent_frame_capacity: () => 'Stopped: an agent message was larger than the session allows',
  agent_timeout: () => 'Stopped: the turn ran past its time limit',
  agent_cancelled: () => 'The turn was cancelled',
  agent_worker_interrupted: () => "The session's worker stopped during the turn",
  resume_unavailable: () => "The conversation can't be resumed",
  agent_reap_pending: () => "The agent's process hasn't been confirmed stopped",
  invalid_contract: () => "The agent returned a result the app couldn't accept",
  evidence_unavailable: () => "A photo the session needed couldn't be delivered",
  agent_unknown: () => "The session failed for a reason it didn't record",
}

/** Codes that say only that the turn failed, so they never stand as a recorded cause. */
export const UNINFORMATIVE_FAILURE_CODES: ReadonlySet<SessionFailureCode> = new Set([
  'agent_turn_failed',
  'agent_unknown',
])

function providerName(provider: SessionFailureCauseDto['provider']) {
  if (provider === 'claude') {
    return 'Claude'
  }
  return provider === 'codex' ? 'Codex' : 'the agent'
}

function capitalised(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function providerSentence(cause: SessionFailureCauseDto, name: string) {
  const error = cause.provider_error
  if (!error) {
    return undefined
  }
  if (error.kind === 'unknown' && error.result === 'error_max_turns') {
    return `Stopped: ${name} reached its turn limit`
  }
  if (error.kind === 'unknown' && cause.code !== 'agent_turn_failed') {
    // The code says more than an unnamed provider error.
    return undefined
  }
  if (cause.provider === 'codex' && Object.hasOwn(codexKinds, error.kind)) {
    return codexKinds[error.kind as CodexKind](name)
  }
  if (Object.hasOwn(claudeKinds, error.kind)) {
    return claudeKinds[error.kind as ClaudeKind](name)
  }
  return codexKinds[error.kind as CodexKind]?.(name)
}

/**
 * A recorded cause as one plain sentence, such as "Couldn't reach Claude: the API was overloaded
 * (HTTP 529)". The HTTP status is added only when the provider recorded one.
 */
export function failureCauseText(cause: SessionFailureCauseDto) {
  const name = providerName(cause.provider)
  const sentence = providerSentence(cause, name) ?? codes[cause.code](name)
  const status = cause.provider_error?.http_status
  const text = capitalised(sentence)
  return status === null || status === undefined ? text : `${text} (HTTP ${status})`
}
