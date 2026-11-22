import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate } from '@invimport/contracts'
import {
  NativeSessionError,
  providerError,
  retainedProviderError,
  sessionFailure,
} from '#/agents/failure-model.ts'

const context = {
  attemptId: randomUUID(),
  lineageId: randomUUID(),
  turn: '1',
  stage: 'turn' as const,
  provider: 'codex' as const,
}
test('diagnostics classify typed codes and exclude arbitrary exception data before persistence', () => {
  const secret = `Bearer private-token ${join(tmpdir(), 'private-path')} SELECT * FROM private`
  const error = new NativeSessionError('agent_tool_refused', { cause: new Error(secret) })
  const diagnostic = sessionFailure(error, {
    ...context,
    model: secret,
    providerSessionId: secret,
    cliVersion: secret,
  })
  validate('SessionFailure', diagnostic)
  assert.equal(diagnostic.category, 'tool_policy')
  assert.equal(diagnostic.model, null)
  assert.equal(diagnostic.provider_session_id, null)
  assert.equal(diagnostic.cli_version, null)
  assert.equal(JSON.stringify(diagnostic).includes(secret), false)
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) < 16384)
  assert.equal(sessionFailure(new Error('agent_login_required'), context).category, 'internal')
})
test('bounded causes handle cycles and unknown provider payloads', () => {
  const error = new NativeSessionError('agent_login_required')
  error.cause = error
  const diagnostic = sessionFailure(error, context)
  assert.equal(diagnostic.category, 'authentication')
  assert.ok(diagnostic.causes.length <= 4)
  assert.equal(diagnostic.truncated, true)
})
test('every typed session failure code has a category', () => {
  const root = join(import.meta.dirname, '../src/agents')
  const codes = new Set<string>()
  for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(root, file), 'utf8')
    for (const match of source.matchAll(/(?:NativeSessionError|this\.reject)\('([a-z_]+)'/g)) {
      codes.add(match[1])
    }
  }
  assert.ok(codes.size > 20)
  for (const code of codes) {
    assert.notEqual(
      sessionFailure(new NativeSessionError(code), context).category,
      'internal',
      code,
    )
  }
})
test('known model identifiers are retained and generic RPC refusals are not tool policy', () => {
  for (const model of ['o3', 'o4-mini', 'gpt-5.5-codex', 'claude-opus-5-5']) {
    assert.equal(
      sessionFailure(new NativeSessionError('agent_turn_failed'), { ...context, model }).model,
      model,
    )
  }
  for (const model of ['o', 'other-model', '/private/model']) {
    assert.equal(
      sessionFailure(new NativeSessionError('agent_turn_failed'), { ...context, model }).model,
      null,
    )
  }
  assert.equal(
    sessionFailure(new NativeSessionError('agent_request_refused'), context).category,
    'provider_network',
  )
})

test('a provider error is retained from the fixed lists only, and never its text', () => {
  const listed = new NativeSessionError('agent_turn_failed', {
    providerError: providerError('codex', {
      kind: 'httpConnectionFailed',
      httpStatus: 503,
    }),
  })
  const diagnostic = sessionFailure(listed, context)
  validate('SessionFailure', diagnostic)
  assert.deepEqual(diagnostic.provider_error, {
    kind: 'httpConnectionFailed',
    result: null,
    http_status: 503,
  })
  // A kind from the other provider's list, an unknown result type and a bad status.
  assert.deepEqual(
    providerError('codex', { kind: 'invalid_request', result: 'success', httpStatus: 99 }),
    { kind: 'unknown', result: null, http_status: null },
  )
  assert.deepEqual(
    providerError('claude', { kind: 'rate_limit', result: 'error_max_turns', httpStatus: 1.5 }),
    { kind: 'rate_limit', result: 'error_max_turns', http_status: null },
  )
  // Without a provider error, or for an unattributed failure, there is no field.
  assert.equal(
    'provider_error' in sessionFailure(new NativeSessionError('agent_turn_failed'), context),
    false,
  )
  assert.equal('provider_error' in sessionFailure(listed, { ...context, provider: null }), false)
  assert.equal(retainedProviderError('claude', 'invalid_request'), undefined)
  // The contract itself admits only listed values, even well-formed ones.
  for (const forged of [
    { kind: 'API Error: 400 secret', result: null, http_status: null },
    { kind: 'private_provider_text', result: null, http_status: null },
    { kind: 'invalid_request', result: 'invented_result', http_status: null },
  ]) {
    assert.throws(() => validate('SessionFailure', { ...diagnostic, provider_error: forged }))
  }
})
