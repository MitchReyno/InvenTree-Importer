import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { inventoryTransport } from '../src/inventory/transport.ts'

test('one authorized call makes exactly one POST even on HTTP 421 (fetch otherwise implicitly replays POST)', async () => {
  const observed: { method: string | undefined; path: string | undefined; body: string }[] = []
  const endpoint = createServer((request, response) => {
    void (async () => {
      const bytes: Buffer[] = []
      for await (const value of request) bytes.push(Buffer.from(value))
      observed.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(bytes).toString(),
      })
      response
        .writeHead(observed.length === 1 ? 421 : 201, { 'content-type': 'application/json' })
        .end('{}')
    })()
  })
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve))
  try {
    const address = endpoint.address()
    assert(address && typeof address !== 'string')
    const binding = { targetId: 'one-send-target', contextId: 'one-send-context' }
    const transport = inventoryTransport({
      ...binding,
      kind: 'owned-disposable',
      origin: `http://127.0.0.1:${address.port}`,
      protectedOrigins: ['https://protected.invalid'],
      credential: 'fake-only',
    })
    const response = await transport.sendStock(binding, '{"part":"29","quantity":"1.000001"}')
    await response.text()
    assert.deepEqual(observed, [
      { method: 'POST', path: '/api/stock/', body: '{"part":"29","quantity":"1.000001"}' },
    ])
    assert.equal(response.status, 421)
  } finally {
    endpoint.closeAllConnections()
    await new Promise<void>((resolve) => endpoint.close(() => resolve()))
  }
})
