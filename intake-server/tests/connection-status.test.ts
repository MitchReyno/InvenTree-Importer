import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionStatus, observationFreshness } from '../src/header/connection.ts'

const binding = {
  actorId: '00000000-0000-4000-8000-000000000001',
  targetId: '00000000-0000-4000-8000-000000000002',
  targetContextId: '00000000-0000-4000-8000-000000000003',
}

test('unconfigured or unsafe target navigation never probes or exposes private input', async () => {
  let calls = 0
  for (const origin of [
    undefined,
    'https://user:secret@example.invalid/',
    'javascript:alert(1)',
    'https://example.invalid/?secret=token',
  ]) {
    const read = connectionStatus(binding, origin, async () => {
      calls += 1
      return new Response('{}')
    })
    const result = await read()
    assert.equal(result.target.state, 'unconfigured')
    assert.equal(result.target.navigation_url, null)
    assert(!JSON.stringify(result).includes('secret'))
  }
  assert.equal(calls, 0)
})

test('concurrent reads coalesce, completed probes cache30 seconds and fresh failure stays unavailable', async () => {
  let clock = 100000
  let calls = 0
  let settle: ((value: Response) => void) | undefined
  const read = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    () => {
      calls += 1
      return new Promise<Response>((resolve) => {
        settle = resolve
      })
    },
    () => clock,
  )
  const first = read()
  const second = read()
  assert.equal(calls, 1)
  settle?.(new Response('{}', { headers: { 'content-type': 'application/json' } }))
  const result = await first
  assert.deepEqual(await second, result)
  assert.equal(result.target.state, 'reachable')
  clock += 29999
  assert.deepEqual(await read(), result)
  assert.equal(calls, 1)
  clock += 1
  const failed = read()
  assert.equal(calls, 2)
  settle?.(new Response('{}', { status: 503 }))
  const observed = await failed
  assert.equal(observed.target.state, 'unavailable')
  assert.equal(observed.target.freshness, 'fresh')
  assert.equal(observed.target.observed_at, new Date(clock).toISOString())
})

test('probe deadline resolves an unavailable observation without disclosing transport errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const read = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    () => new Promise<Response>(() => {}),
  )
  const result = read()
  t.mock.timers.tick(3000)
  const observed = await result
  assert.equal(observed.target.state, 'unavailable')
  assert.equal(observed.target.failure_code, 'timeout')
  assert.equal(observed.target.freshness, 'fresh')
})

test('same target with a replaced context starts its own observation and never reuses prior health', async () => {
  const old = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
  )
  assert.equal((await old()).target.state, 'reachable')
  const next = connectionStatus(
    { ...binding, targetContextId: '00000000-0000-4000-8000-000000000004' },
    'https://inventory.example.invalid/',
    async () => {
      throw new Error('private-provider-token')
    },
  )
  const observed = await next()
  assert.equal(observed.target.state, 'unavailable')
  assert.equal(observed.target_context_id, '00000000-0000-4000-8000-000000000004')
  assert(!JSON.stringify(observed).includes('private-provider-token'))
})

test('freshness expires at60 seconds and a backward clock cannot preserve green', () => {
  assert.equal(observationFreshness(null, 1000), 'unobserved')
  assert.equal(observationFreshness(1000, 60999), 'fresh')
  assert.equal(observationFreshness(1000, 61000), 'stale')
  assert.equal(observationFreshness(1000, 999), 'stale')
})

test('successful HTTP without JSON, denied API and redirects never become reachable', async () => {
  for (const [status, contentType, failure] of [
    [200, 'text/html', 'unexpected_response'],
    [401, 'application/json', 'http_error'],
    [302, 'application/json', 'redirect_refused'],
  ] as const) {
    const read = connectionStatus(
      binding,
      'https://inventory.example.invalid/',
      async () => new Response('{}', { status, headers: { 'content-type': contentType } }),
    )
    const observed = await read()
    assert.equal(observed.target.state, 'unavailable')
    assert.equal(observed.target.failure_code, failure)
  }
})
