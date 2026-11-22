import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NativeSessionError } from '#/agents/failure-model.ts'
import { SessionResumeUnavailable } from '#/agents/session/session-adapters.ts'
import { workerFailure, workerOutcomeError } from '#/agents/shared-vm/worker-outcome.ts'

const listed = { kind: 'invalid_request', result: 'error_during_execution', http_status: 400 }

test("the tool worker's failure frame carries the provider error across the worker socket", () => {
  const failed = workerFailure(
    new NativeSessionError('agent_turn_failed', { providerError: listed }),
  )
  assert.deepEqual(failed, { outcome: 'agent_turn_failed', provider_error: listed })
  const crossed = workerOutcomeError(JSON.parse(JSON.stringify(failed)), 'claude')
  assert.ok(crossed instanceof NativeSessionError)
  assert.equal(crossed.code, 'agent_turn_failed')
  assert.deepEqual(crossed.providerError, listed)

  const login = { kind: 'authentication_failed', result: null, http_status: null }
  const expired = workerFailure(
    new NativeSessionError('agent_login_required', { providerError: login }),
  )
  assert.deepEqual(expired, { outcome: 'agent_login_required', provider_error: login })
  assert.deepEqual(
    (workerOutcomeError(expired, 'claude') as NativeSessionError).providerError,
    login,
  )
})

test('the supervisor keeps only listed values and maps every other outcome as before', () => {
  const forged = workerOutcomeError(
    {
      outcome: 'agent_turn_failed',
      provider_error: { kind: 'API Error: secret', result: 'x', http_status: 7 },
    },
    'claude',
  ) as NativeSessionError
  assert.deepEqual(forged.providerError, { kind: 'unknown', result: null, http_status: null })
  // A refusal never carries one, and keeps its code.
  assert.deepEqual(
    workerFailure(new NativeSessionError('agent_tool_refused', { providerError: listed })),
    { outcome: 'agent_tool_refused' },
  )
  assert.equal(
    (workerOutcomeError({ outcome: 'agent_tool_refused' }, 'claude') as NativeSessionError).code,
    'agent_tool_refused',
  )
  assert.ok(
    workerOutcomeError({ outcome: 'resume_unavailable' }, 'codex') instanceof
      SessionResumeUnavailable,
  )
  assert.deepEqual(workerFailure(new Error('anything')), { outcome: 'agent_turn_failed' })
  // A request frame is not a failure.
  assert.equal(workerOutcomeError({ request: { mcp: '{}' } }, 'claude'), undefined)
})
