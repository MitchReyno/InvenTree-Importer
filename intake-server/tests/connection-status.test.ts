import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionStatus, observationFreshness } from '#/header/connection.ts'

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

test('actual default HTTP transport retains JSON content type for a healthy owned probe', async () => {
  const { createServer } = await import('node:http')
  const { inventoryTransport } = await import('#/inventory/transport.ts')
  let calls = 0
  const endpoint = createServer((request, response) => {
    calls += 1
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/api/part/?limit=1')
    assert.equal(request.headers.authorization, 'Token fake-probe-only')
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('x-private-test-header', 'private-target-detail')
    response.end('{"results":[]}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}/`
  const target = { targetId: binding.targetId, contextId: binding.targetContextId }
  const adapter = inventoryTransport({
    ...target,
    kind: 'protected-read-only',
    origin,
    protectedOrigins: [origin],
    credential: 'fake-probe-only',
  })
  try {
    const read = connectionStatus(binding, origin, () => adapter.probe(target))
    const observed = await read()
    assert.equal(observed.target.state, 'reachable')
    assert.equal(observed.target.failure_code, null)
    assert.equal(calls, 1)
    assert(!JSON.stringify(observed).includes('private-target-detail'))
    assert(!JSON.stringify(observed).includes('fake-probe-only'))
  } finally {
    await new Promise<void>((resolve, reject) =>
      endpoint.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('the connection names the owned test target, and anything else as configured', async () => {
  const healthy = async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  const owned = await connectionStatus(
    { ...binding, targetKind: 'owned_test' },
    'http://127.0.0.1:4999/',
    healthy,
  )()
  const configured = await connectionStatus(binding, 'https://inventory.example.test/', healthy)()
  const unconfigured = await connectionStatus({ ...binding, targetKind: 'owned_test' }, undefined)()

  assert.equal(owned.target.kind, 'owned_test')
  assert.equal(configured.target.kind, 'configured')
  assert.equal(unconfigured.target.kind, 'owned_test')
})

test('a reachable target carries its InvenTree version, read once with the probe', async () => {
  let clock = 100000
  let versions = 0
  const healthy = async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  const version = async () => {
    versions += 1
    return new Response(
      JSON.stringify({ server: 'InvenTree', version: '0.17.10', apiVersion: 300 }),
      {
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  const read = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    healthy,
    () => clock,
    version,
  )
  assert.equal((await read()).target.version, '0.17.10')
  clock += 29999
  assert.equal((await read()).target.version, '0.17.10')
  assert.equal(versions, 1)
})

test('an unreadable version is null and never makes a reachable target unavailable', async () => {
  const healthy = async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  const json =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  for (const version of [
    json({ version: 17 }),
    json({ version: '' }),
    json({ version: 'v'.repeat(65) }),
    json({ version: 'bad\u0000value' }),
    json({}),
    json([1]),
    json({ version: '0.17.10' }, 500),
    async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    async () =>
      new Response('x'.repeat(20000), { headers: { 'content-type': 'application/json' } }),
    async () => {
      throw new Error('private transport detail')
    },
  ]) {
    const observed = await connectionStatus(
      binding,
      'https://inventory.example.invalid/',
      healthy,
      Date.now,
      version,
    )()
    assert.equal(observed.target.state, 'reachable')
    assert.equal(observed.target.version, null)
    assert(!JSON.stringify(observed).includes('private transport detail'))
  }
})

test('an unavailable target reports no version, and a hung version read ends at the deadline', async (t) => {
  const failed = await connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    async () => new Response('{}', { status: 503 }),
    Date.now,
    async () =>
      new Response('{"version":"0.17.10"}', { headers: { 'content-type': 'application/json' } }),
  )()
  assert.equal(failed.target.state, 'unavailable')
  assert.equal(failed.target.version, null)

  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    Date.now,
    () => new Promise<Response>(() => {}),
  )()
  await Promise.resolve()
  t.mock.timers.tick(3000)
  const observed = await pending
  assert.equal(observed.target.state, 'reachable')
  assert.equal(observed.target.version, null)
})
