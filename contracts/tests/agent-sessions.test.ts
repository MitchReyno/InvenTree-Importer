import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLAUDE_ERROR_KINDS,
  CODEX_ERROR_KINDS,
  SESSION_FAILURE_CODES,
  START_FRESH_REFUSALS,
  failureCauseText,
  validate,
  type AgentSessionListDto,
} from '../src/index.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const at = '2026-11-24T08:17:00.000Z'

const summary = {
  id: id(1),
  category: 'provider_network',
  summary: 'The provider connection or protocol failed.',
  recovery: 'Check provider availability and connection settings before explicitly retrying.',
  details_available: true,
}

test('an overloaded Claude turn reads as plain words with its HTTP status', () => {
  const text = failureCauseText({
    code: 'agent_turn_failed',
    provider: 'claude',
    provider_error: { kind: 'overloaded', result: 'error_during_execution', http_status: 529 },
  })
  assert.equal(text, "Couldn't reach Claude: the API was overloaded (HTTP 529)")
})

test('the HTTP status is added only when the provider recorded one', () => {
  const text = failureCauseText({
    code: 'agent_turn_failed',
    provider: 'codex',
    provider_error: { kind: 'serverOverloaded', result: null, http_status: null },
  })
  assert.equal(text, "Couldn't reach Codex: the API was overloaded")
})

test('a cause code without a provider error reads as its own sentence', () => {
  assert.equal(
    failureCauseText({ code: 'agent_tool_refused', provider: 'claude' }),
    "Stopped: the agent tried a tool it isn't allowed to use",
  )
  assert.equal(
    failureCauseText({ code: 'agent_admission_unavailable', provider: 'claude' }),
    "The Claude CLI refused this session's setup",
  )
  assert.equal(
    failureCauseText({ code: 'agent_output_capacity', provider: null }),
    "Stopped: the agent's reply was larger than the session allows",
  )
})

test('an unnamed provider error defers to a more specific code', () => {
  const text = failureCauseText({
    code: 'agent_protocol_invalid',
    provider: 'claude',
    provider_error: { kind: 'unknown', result: null, http_status: null },
  })
  assert.equal(text, "Claude sent a reply the app couldn't read")
})

test('every recorded kind and code has a sentence', () => {
  for (const kind of CLAUDE_ERROR_KINDS) {
    const text = failureCauseText({
      code: 'agent_turn_failed',
      provider: 'claude',
      provider_error: { kind, result: null, http_status: null },
    })
    assert.match(text, /^[A-Z]/, kind)
  }
  for (const kind of CODEX_ERROR_KINDS) {
    const text = failureCauseText({
      code: 'agent_turn_failed',
      provider: 'codex',
      provider_error: { kind, result: null, http_status: null },
    })
    assert.match(text, /^[A-Z]/, kind)
  }
  for (const code of SESSION_FAILURE_CODES) {
    assert.match(failureCauseText({ code, provider: 'codex' }), /^[A-Z]/, code)
  }
})

test('a failure summary carries its sanitized cause and last status', () => {
  validate('SessionFailureSummary', {
    ...summary,
    failed_at: at,
    cause: {
      code: 'agent_turn_failed',
      provider: 'claude',
      provider_error: { kind: 'overloaded', result: null, http_status: 529 },
    },
    last_status: { text: 'Reading the batch and fetching photos', at },
  })
  validate('SessionFailureSummary', summary)
  assert.throws(() =>
    validate('SessionFailureSummary', {
      ...summary,
      cause: { code: 'an unlisted code', provider: 'claude' },
    }),
  )
  assert.throws(() =>
    validate('SessionFailureSummary', {
      ...summary,
      cause: { code: 'agent_timeout', provider: 'claude', text: 'raw provider text' },
    }),
  )
})

test('a retained diagnostic never stores the summary-only fields', () => {
  const diagnostic = {
    ...summary,
    attempt_id: id(2),
    lineage_id: id(3),
    turn: '1',
    timestamp: at,
    correlation_id: id(4),
    code: 'agent_turn_failed',
    stage: 'turn',
    provider: 'claude',
    model: null,
    cli_version: null,
    provider_session_id: null,
    causes: [],
    truncated: false,
  }
  validate('SessionFailure', diagnostic)
  assert.throws(() =>
    validate('SessionFailure', { ...diagnostic, cause: { code: 'agent_timeout', provider: null } }),
  )
})

test('Start fresh eligibility is allowed or names one refusal', () => {
  const job = (start_fresh: unknown) => ({
    attempt_id: id(5),
    batch_id: id(6),
    job_id: id(7),
    subject_id: id(8),
    stage: 'research',
    state: 'failed',
    latest_on_job: true,
    attempt_number: 3,
    selection: null,
    settings_revision: null,
    queued_at: at,
    started_at: at,
    finished_at: at,
    state_since: at,
    native_session_id: null,
    actual_model: null,
    progress: 'settled',
    occupies_lane: false,
    session_state: 'failed',
    failure: summary,
    latest_status: null,
    archived: false,
    runs_on: 'agent_vm',
    web: { public_pages: true, prefer_datasheets: false },
    start_fresh,
    earlier_attempts: [
      {
        attempt_id: id(9),
        number: 2,
        state: 'superseded',
        session_state: 'failed',
        queued_at: at,
        ended_at: at,
        failure: summary,
      },
    ],
    earlier_attempt_count: 2,
  })
  const list = (start_fresh: unknown): AgentSessionListDto =>
    ({
      sessions: [job(start_fresh)],
      filter: 'needs_attention',
      counts: { needs_attention: 1, working: 0, waiting: 0, queued: 0, done_today: 0, all: 3 },
      totals: { slots_in_use: 0, queued: 0, waiting: 0 },
      batches: [
        { batch_id: id(6), archived: false, sessions: 3, matching: 1, first_started_at: at },
      ],
      next_before: null,
      sessions_supported: true,
    }) as AgentSessionListDto
  validate('AgentSessionList', list({ allowed: true }))
  for (const reason of START_FRESH_REFUSALS) {
    validate('AgentSessionList', list({ allowed: false, reason }))
  }
  assert.throws(() => validate('AgentSessionList', list({ allowed: false })))
  assert.throws(() => validate('AgentSessionList', list({ allowed: false, reason: 'busy' })))
})

test('the session query takes a filter, a batch and the day bounds', () => {
  validate('AgentSessionQuery', {
    filter: 'done_today',
    batch_id: id(6),
    day_start: '2026-11-24T00:00:00.000+11:00',
    day_end: '2026-11-25T00:00:00.000+11:00',
    before: 'WyIyMDI2LTExLTI0VDA4OjE3OjAwLjAwMFoiXQ',
  })
  assert.throws(() => validate('AgentSessionQuery', { filter: 'running' }))
  assert.throws(() => validate('AgentSessionQuery', { before: 'not a cursor!' }))
})
