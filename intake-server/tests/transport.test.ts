import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { inventoryTransport, type TargetProfile } from '../src/inventory/transport.ts'

test('protected aliases, external/DNS writes, mismatched binding and semantic non-read fail before transport', async () => {
  let requests = 0, transportCalls = 0
  const observations: { method: string | undefined; path: string | undefined }[] = []
  const endpoint = createServer((req, res) => { requests++; observations.push({ method: req.method, path: req.url }); res.end('{}') })
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const local = `http://127.0.0.1:${address.port}`
  const binding = { targetId: 'fixture-target', contextId: 'fixture-context' }
  const base: TargetProfile = { ...binding, kind: 'protected-read-only', origin: local, protectedOrigins: [local], credential: 'fake-only' }
  const observedSend: typeof fetch = async (url, init) => { transportCalls++; return fetch(url, init) }
  try {
    for (const overrides of [{}, { kind: 'owned-disposable', protectedOrigins: [`http://localhost:${address.port}`] }, { kind: 'owned-disposable', origin: 'http://localhost:4321' }, { kind: 'owned-disposable', origin: 'https://inventory.invalid' }, { kind: 'owned-disposable', protectedOrigins: [] }]) {
      const transport = inventoryTransport({ ...base, ...overrides } as TargetProfile, observedSend)
      await assert.rejects(transport.sendStock(binding, '{}'), /mutation_target_refused/)
    }
    const transport = inventoryTransport(base, observedSend)
    await assert.rejects(transport.read({ ...binding, contextId: 'other' }, { kind: 'get_part', pk: '1' }), /binding_mismatch/)
    await assert.rejects(transport.read(binding, { kind: 'delete_part', pk: '1' } as never), /read_operation_refused/)
    await assert.rejects(transport.read(binding, { kind: 'get_part', pk: '../delete' }), /read_operation_refused/)
    assert.equal(requests, 0)
    assert.equal(transportCalls, 0)
    const response = await transport.read(binding, { kind: 'get_part', pk: '1' })
    await response.text()
    assert.equal(requests, 1)
    await (await transport.read(binding, { kind: 'get_location', pk: '19' })).text()
    assert.deepEqual(observations, [{ method: 'GET', path: '/api/part/1/' }, { method: 'GET', path: '/api/stock/location/19/' }])
  } finally { await new Promise<void>(resolve => endpoint.close(() => resolve())) }
})
test('owned disposable writes exactly once; redirects never reach protected controlled sink', async () => {
  let sinkCount = 0, initialCount = 0
  const observed: { method: string | undefined; path: string | undefined; body: string }[] = []
  const sink = createServer((_req, res) => { sinkCount++; res.end('{}') })
  await new Promise<void>(resolve => sink.listen(0, '127.0.0.1', resolve))
  const sinkAddress = sink.address()
  assert(sinkAddress && typeof sinkAddress !== 'string')
  let redirect = false
  const endpoint = createServer(async (req, res) => {
    initialCount++
    let body = ''
    for await (const chunk of req) body += String(chunk)
    observed.push({ method: req.method, path: req.url, body })
    if (redirect) { res.writeHead(307, { location: `http://127.0.0.1:${sinkAddress.port}` }); res.end() }
    else res.end('{}')
  })
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve))
  const address = endpoint.address()
  assert(address && typeof address !== 'string')
  const binding = { targetId: 'owned-fixture', contextId: 'owned-context' }
  const transport = inventoryTransport({ ...binding, kind: 'owned-disposable', origin: `http://127.0.0.1:${address.port}`, protectedOrigins: ['https://protected.invalid'], credential: 'fake-only' })
  try {
    await (await transport.sendStock(binding, '{"quantity":"7.125","location":"19"}')).text()
    assert.equal(initialCount, 1)
    assert.deepEqual(observed, [{ method: 'POST', path: '/api/stock/', body: '{"quantity":"7.125","location":"19"}' }])
    redirect = true
    await assert.rejects(transport.sendStock(binding, '{}'), /redirect_refused/)
    assert.equal(initialCount, 2)
    assert.equal(sinkCount, 0)
  } finally {
    await new Promise<void>(resolve => endpoint.close(() => resolve()))
    await new Promise<void>(resolve => sink.close(() => resolve()))
  }
})
