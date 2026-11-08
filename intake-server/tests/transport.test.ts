import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { inventoryTransport, type TargetProfile } from '../src/inventory/transport.ts'

test('protected loopback spellings deny before transport across ports; nearby non-loopbacks remain distinct', async (t) => {
  let transportCalls = 0,
    requests = 0
  const endpoint = createServer((_req, res) => {
    requests++
    res.end('{}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const otherPort = address.port === 65535 ? 65534 : address.port + 1
  const binding = { targetId: 'alias-fixture-target', contextId: 'alias-fixture-context' }
  const base: TargetProfile = {
    ...binding,
    kind: 'owned-disposable',
    origin: `http://127.0.0.1:${address.port}`,
    protectedOrigins: [],
    credential: 'fake-alias-only',
  }
  const observedSend: typeof fetch = async (url, init) => {
    transportCalls++
    return fetch(url, init)
  }
  try {
    for (const hostname of [
      'localhost.',
      'LOCALHOST.',
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
      '[0:0:0:0:0:ffff:7F00:0001]',
      '[::ffff:127.255.255.255]',
      '127.0.0.2',
      '127.255.255.255',
      '127.1',
      '[::1]',
    ]) {
      for (const port of [address.port, otherPort])
        await t.test(`${hostname} protected port ${port}`, async () => {
          transportCalls = 0
          requests = 0
          const transport = inventoryTransport(
            { ...base, protectedOrigins: [`http://${hostname}:${port}`] },
            observedSend,
          )
          let refused = false
          try {
            await (await transport.sendStock(binding, '{"quantity":"3.125"}')).text()
          } catch (error) {
            assert.match(String(error), /mutation_target_refused/)
            refused = true
          }
          assert.deepEqual(
            { refused, transportCalls, requests },
            { refused: true, transportCalls: 0, requests: 0 },
          )
        })
    }
    for (const hostname of [
      '126.255.255.255',
      '128.0.0.1',
      '[::ffff:126.255.255.255]',
      '[::ffff:128.0.0.1]',
      'localhost.invalid',
    ]) {
      await t.test(`${hostname} is not a protected loopback alias`, async () => {
        transportCalls = 0
        requests = 0
        const transport = inventoryTransport(
          { ...base, protectedOrigins: [`http://${hostname}:${otherPort}`] },
          observedSend,
        )
        const response = await transport.sendStock(binding, '{"quantity":"3.125"}')
        assert.equal(response.status, 200)
        await response.text()
        assert.deepEqual({ transportCalls, requests }, { transportCalls: 1, requests: 1 })
      })
    }
    for (const hostname of ['localhost.', '[::ffff:127.0.0.1]', '127.0.0.2']) {
      await t.test(`${hostname} does not become an allowed writable destination`, async () => {
        transportCalls = 0
        requests = 0
        const transport = inventoryTransport(
          {
            ...base,
            origin: `http://${hostname}:${address.port}`,
            protectedOrigins: ['https://protected.invalid'],
          },
          observedSend,
        )
        await assert.rejects(transport.sendStock(binding, '{}'), /mutation_target_refused/)
        assert.deepEqual({ transportCalls, requests }, { transportCalls: 0, requests: 0 })
      })
    }
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
  }
})

test('protected aliases, external/DNS writes, mismatched binding and semantic non-read fail before transport', async () => {
  let requests = 0,
    transportCalls = 0
  const observations: { method: string | undefined; path: string | undefined }[] = []
  const endpoint = createServer((req, res) => {
    requests++
    observations.push({ method: req.method, path: req.url })
    res.end('{}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const local = `http://127.0.0.1:${address.port}`
  const binding = { targetId: 'fixture-target', contextId: 'fixture-context' }
  const base: TargetProfile = {
    ...binding,
    kind: 'protected-read-only',
    origin: local,
    protectedOrigins: [local],
    credential: 'fake-only',
  }
  const observedSend: typeof fetch = async (url, init) => {
    transportCalls++
    return fetch(url, init)
  }
  try {
    for (const overrides of [
      {},
      { kind: 'owned-disposable', protectedOrigins: [`http://localhost:${address.port}`] },
      { kind: 'owned-disposable', origin: 'http://localhost:4321' },
      { kind: 'owned-disposable', origin: 'https://inventory.invalid' },
      { kind: 'owned-disposable', protectedOrigins: [] },
    ]) {
      const transport = inventoryTransport({ ...base, ...overrides } as TargetProfile, observedSend)
      await assert.rejects(transport.sendStock(binding, '{}'), /mutation_target_refused/)
    }
    const transport = inventoryTransport(base, observedSend)
    await assert.rejects(
      transport.read({ ...binding, contextId: 'other' }, { kind: 'get_part', pk: '1' }),
      /binding_mismatch/,
    )
    await assert.rejects(
      transport.read(binding, { kind: 'delete_part', pk: '1' } as never),
      /read_operation_refused/,
    )
    await assert.rejects(
      transport.read(binding, { kind: 'get_part', pk: '../delete' }),
      /read_operation_refused/,
    )
    assert.equal(requests, 0)
    assert.equal(transportCalls, 0)
    const response = await transport.read(binding, { kind: 'get_part', pk: '1' })
    await response.text()
    assert.equal(requests, 1)
    await (await transport.read(binding, { kind: 'get_location', pk: '19' })).text()
    assert.deepEqual(observations, [
      { method: 'GET', path: '/api/part/1/' },
      { method: 'GET', path: '/api/stock/location/19/' },
    ])
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
  }
})
test('owned disposable writes exactly once; redirects never reach protected controlled sink', async () => {
  let sinkCount = 0,
    initialCount = 0
  const observed: { method: string | undefined; path: string | undefined; body: string }[] = []
  const sink = createServer((_req, res) => {
    sinkCount++
    res.end('{}')
  })
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve))
  const sinkAddress = sink.address()
  assert(sinkAddress && typeof sinkAddress !== 'string')
  let redirect = false
  const endpoint = createServer(async (req, res) => {
    initialCount++
    let body = ''
    for await (const chunk of req) body += String(chunk)
    observed.push({ method: req.method, path: req.url, body })
    if (redirect) {
      res.writeHead(307, { location: `http://127.0.0.1:${sinkAddress.port}` })
      res.end()
    } else res.end('{}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const binding = { targetId: 'owned-fixture', contextId: 'owned-context' }
  const transport = inventoryTransport({
    ...binding,
    kind: 'owned-disposable',
    origin: `http://127.0.0.1:${address.port}`,
    protectedOrigins: ['https://protected.invalid'],
    credential: 'fake-only',
  })
  try {
    await (await transport.sendStock(binding, '{"quantity":"7.125","location":"19"}')).text()
    assert.equal(initialCount, 1)
    assert.deepEqual(observed, [
      { method: 'POST', path: '/api/stock/', body: '{"quantity":"7.125","location":"19"}' },
    ])
    redirect = true
    await assert.rejects(transport.sendStock(binding, '{}'), /redirect_refused/)
    assert.equal(initialCount, 2)
    assert.equal(sinkCount, 0)
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
    await new Promise<void>((resolve) => sink.close(() => resolve()))
  }
})

test('new Part creates and tagged reads opt into native tags on the collection and instance URLs', async () => {
  const observed: string[] = []
  const endpoint = createServer((_req, res) => {
    observed.push(`${_req.method} ${_req.url}`)
    res.writeHead(201).end('{"pk":"8101"}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const binding = { targetId: 'owned-fixture', contextId: 'owned-context' }
  const transport = inventoryTransport({
    ...binding,
    kind: 'owned-disposable',
    origin: `http://127.0.0.1:${address.port}`,
    protectedOrigins: ['https://protected.invalid'],
    credential: 'fake-only',
    effectsCapability: 'owned-fake-effects/1',
  })
  try {
    await (
      await transport.sendSupported(
        binding,
        'create_part',
        '{"category":"81","copy_category_parameters":false,"name":"R","tags":["SMD"]}',
      )
    ).text()
    await (await transport.readSupported(binding, 'create_part', '8101')).text()
    await (await transport.read(binding, { kind: 'get_tagged_part', pk: '8101' })).text()
    await (await transport.read(binding, { kind: 'get_part', pk: '8101' })).text()
    await (await transport.sendSupported(binding, 'create_stock', '{"part":"8101"}')).text()
    assert.deepEqual(observed, [
      'POST /api/part/?tags=true',
      'GET /api/part/8101/?tags=true',
      'GET /api/part/8101/?tags=true',
      'GET /api/part/8101/',
      'POST /api/stock/',
    ])
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
  }
})

test('fixed binding probe uses one harmless bounded GET, refuses redirects and never accepts browser scope', async () => {
  const binding = { targetId: 'probe-target', contextId: 'probe-context' }
  const calls: {
    url: string
    method: string | undefined
    redirect: RequestRedirect | undefined
  }[] = []
  const transport = inventoryTransport(
    {
      ...binding,
      kind: 'protected-read-only',
      origin: 'https://inventory.example.invalid/',
      protectedOrigins: [],
      credential: 'synthetic-probe-key',
    },
    async (url, init) => {
      calls.push({ url: String(url), method: init?.method, redirect: init?.redirect })
      assert.equal(new Headers(init?.headers).get('authorization'), 'Token synthetic-probe-key')
      return new Response(null, { status: 302 })
    },
  )
  await assert.rejects(
    transport.probe({ ...binding, contextId: 'foreign' }),
    /target_binding_mismatch/,
  )
  assert.equal(calls.length, 0)
  await assert.rejects(transport.probe(binding), /target_redirect_refused/)
  assert.deepEqual(calls, [
    {
      url: 'https://inventory.example.invalid/api/part/?limit=1',
      method: 'GET',
      redirect: 'manual',
    },
  ])
})

test('the server version is one bounded GET of the API root on the fixed binding', async () => {
  const binding = { targetId: 'version-target', contextId: 'version-context' }
  const calls: string[] = []
  const transport = inventoryTransport(
    {
      ...binding,
      kind: 'protected-read-only',
      origin: 'https://inventory.example.invalid/',
      protectedOrigins: [],
      credential: 'synthetic-version-key',
    },
    async (url, init) => {
      calls.push(`${init?.method} ${String(url)} ${init?.redirect}`)
      return new Response('{"version":"0.17.10"}', {
        headers: { 'content-type': 'application/json' },
      })
    },
  )
  await assert.rejects(
    transport.serverVersion({ ...binding, contextId: 'foreign' }),
    /target_binding_mismatch/,
  )
  const response = await transport.serverVersion(binding)
  assert.equal(response.status, 200)
  assert.deepEqual(calls, ['GET https://inventory.example.invalid/api/ manual'])
})

test('record creates need the /2 capability on an owned loopback target and never reach others', async () => {
  const observed: string[] = []
  const endpoint = createServer((req, res) => {
    observed.push(`${req.method} ${req.url}`)
    res.writeHead(201).end('{"pk":"12001"}')
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const binding = { targetId: 'owned-fixture', contextId: 'owned-context' }
  const owned = {
    ...binding,
    kind: 'owned-disposable' as const,
    origin: `http://127.0.0.1:${address.port}`,
    protectedOrigins: ['https://protected.invalid'],
    credential: 'fake-only',
  }
  const multipart = 'multipart/form-data; boundary=bench-0a1b'
  try {
    const legacy = inventoryTransport({ ...owned, effectsCapability: 'owned-fake-effects/1' })
    await assert.rejects(
      legacy.sendSupported(binding, 'create_location', '{}'),
      /effects_capability_refused/,
    )
    await assert.rejects(
      legacy.sendSupported(binding, 'create_company', '{}'),
      /effects_capability_refused/,
    )
    await assert.rejects(
      legacy.sendCompanyWithImage(binding, Buffer.from('x'), multipart),
      /company_image_send_refused/,
    )
    for (const profile of [
      { ...owned, kind: 'protected-read-only' as const },
      { ...owned, origin: 'http://inventory.example:8000' },
      { ...owned, protectedOrigins: [owned.origin] },
    ]) {
      const refused = inventoryTransport({ ...profile, effectsCapability: 'owned-fake-effects/2' })
      await assert.rejects(
        refused.sendSupported(binding, 'create_location', '{}'),
        /mutation_target_refused/,
      )
      await assert.rejects(
        refused.sendCompanyWithImage(binding, Buffer.from('x'), multipart),
        /mutation_target_refused/,
      )
    }
    assert.deepEqual(observed, [], 'no refused record create reaches any endpoint')
    const records = inventoryTransport({ ...owned, effectsCapability: 'owned-fake-effects/2' })
    await (await records.sendSupported(binding, 'create_location', '{"name":"Shelf"}')).text()
    await (await records.readSupported(binding, 'create_company', '12001')).text()
    assert.deepEqual(observed, ['POST /api/stock/location/', 'GET /api/company/12001/'])
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
  }
})
