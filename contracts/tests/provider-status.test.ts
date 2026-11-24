import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentsClient } from '../generated/client.ts'
import { validate } from '../src/index.ts'
import { PROVIDER_STATUS_UNKNOWN_REASONS, type ProviderStatusDto } from '../src/agents.ts'

const failure = {
  attempt_id: '20000000-0000-4000-8000-000000000002',
  failure_id: '30000000-0000-4000-8000-000000000003',
  failed_at: '2026-11-24T00:10:00.000Z',
}
const checkedAt = '2026-11-24T00:10:58.000Z'
const status: ProviderStatusDto = {
  claude: {
    state: 'saved',
    saved_at: '2026-11-23T22:00:00.000Z',
    checked_at: checkedAt,
    last_sign_in_failure: failure,
  },
  codex: {
    state: 'signing_in',
    checked_at: checkedAt,
    refreshing: false,
    last_sign_in_failure: null,
  },
  read_at: '2026-11-24T00:11:00.000Z',
}

test('each provider reads as one of its states, or unknown with a listed reason', () => {
  validate('ProviderStatus', status)
  for (const claude of [
    { state: 'saved', saved_at: null, checked_at: checkedAt, last_sign_in_failure: null },
    { state: 'not_saved', checked_at: checkedAt, last_sign_in_failure: null },
  ]) {
    validate('ProviderStatus', { ...status, claude })
  }
  for (const state of ['signed_in', 'signing_in', 'signed_out']) {
    for (const refreshing of [false, true]) {
      validate('ProviderStatus', {
        ...status,
        codex: { state, checked_at: checkedAt, refreshing, last_sign_in_failure: null },
      })
    }
  }
  // A Codex status with no completed check yet says so, never signed out.
  assert.ok(PROVIDER_STATUS_UNKNOWN_REASONS.includes('checking'))
  for (const reason of PROVIDER_STATUS_UNKNOWN_REASONS) {
    validate('ProviderStatus', {
      ...status,
      claude: { state: 'unknown', reason, last_sign_in_failure: null },
      codex: { state: 'unknown', reason, last_sign_in_failure: failure },
    })
  }
  const refused = [
    { ...status, claude: { state: 'unknown', reason: 'signed_out', last_sign_in_failure: null } },
    { ...status, codex: { state: 'unknown', last_sign_in_failure: null } },
    // Unknown is never signed out, and a Codex state never stands for Claude's.
    { ...status, claude: { state: 'signed_out', last_sign_in_failure: null } },
    { ...status, codex: { state: 'saved', saved_at: null, last_sign_in_failure: null } },
    { ...status, codex: { state: 'signed_in' } },
    // A known state always says when it was checked; an unknown one has no check to date.
    { ...status, codex: { state: 'signed_in', last_sign_in_failure: null } },
    {
      ...status,
      codex: { state: 'signed_in', checked_at: checkedAt, last_sign_in_failure: null },
    },
    {
      ...status,
      claude: { ...status.claude, refreshing: false },
    },
    { ...status, claude: { state: 'not_saved', last_sign_in_failure: null } },
    {
      ...status,
      codex: {
        state: 'unknown',
        reason: 'checking',
        checked_at: checkedAt,
        last_sign_in_failure: null,
      },
    },
    { claude: status.claude, codex: status.codex },
  ]
  for (const value of refused) {
    assert.throws(() => validate('ProviderStatus', value), { message: 'invalid_contract' })
  }
})

test('a provider status carries no token, account, key or credential revision', () => {
  for (const extra of [
    { token: 'sk-ant-oat01-sentinel' },
    { revision: '9f7a2b3c-0000-4000-8000-000000000000' },
    { email: 'operator@example.com' },
    { key: 'a'.repeat(64) },
  ]) {
    assert.throws(
      () => validate('ProviderStatus', { ...status, claude: { ...status.claude, ...extra } }),
      { message: 'invalid_contract' },
    )
    assert.throws(
      () => validate('ProviderStatus', { ...status, codex: { ...status.codex, ...extra } }),
      { message: 'invalid_contract' },
    )
    assert.throws(() => validate('ProviderStatus', { ...status, ...extra }), {
      message: 'invalid_contract',
    })
  }
  assert.throws(
    () =>
      validate('ProviderStatus', {
        ...status,
        claude: { ...status.claude, last_sign_in_failure: { ...failure, summary: 'private' } },
      }),
    { message: 'invalid_contract' },
  )
})

test('the agents client reads provider status and refuses an answer with a secret in it', async () => {
  const urls: string[] = []
  let answer: unknown = status
  const client = agentsClient('http://127.0.0.1:1', 'a'.repeat(64), async (url) => {
    urls.push(String(url instanceof Request ? url.url : url))
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  assert.deepEqual(await client.providerStatus(), status)
  // Check again asks the guest for a fresh check; the answer still comes at once.
  assert.deepEqual(await client.providerStatus({ refresh: true }), status)
  assert.deepEqual(urls, [
    'http://127.0.0.1:1/api/v1/agents/provider-status',
    'http://127.0.0.1:1/api/v1/agents/provider-status?refresh=true',
  ])
  answer = { ...status, codex: { ...status.codex, token: 'sentinel' } }
  await assert.rejects(client.providerStatus())
})
