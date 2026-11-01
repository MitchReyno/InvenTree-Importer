import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  ProcessingFixtureHttpError,
  requestProcessingFixtureJson,
} from './support/processing-http.ts'

test('fixture socket-close reports the request phase and sends exactly one uncertain POST', async () => {
  let posts = 0
  const server = createServer((request) => {
    if (request.method === 'POST') {
      posts += 1
    }
    request.socket.destroy()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    await assert.rejects(
      () =>
        requestProcessingFixtureJson(`http://127.0.0.1:${address.port}`, '/batches', {
          method: 'POST',
          headers: { 'x-intake-csrf': 'fixture-private-token' },
          body: 'fixture-private-note',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProcessingFixtureHttpError)
        assert.equal(error.phase, 'request')
        assert.equal(error.method, 'POST')
        assert.equal(error.path, '/batches')
        assert.ok(error.cause instanceof TypeError)
        assert.equal(error.message.includes('fixture-private-token'), false)
        assert.equal(error.message.includes('fixture-private-note'), false)
        assert.equal(error.message.includes('127.0.0.1'), false)
        return true
      },
    )
    assert.equal(posts, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('fixture response-body stall aborts with the body phase and does not replay the POST', async () => {
  let posts = 0
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      posts += 1
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.flushHeaders()
    response.write('{"pending":')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    await assert.rejects(
      () =>
        requestProcessingFixtureJson(
          `http://127.0.0.1:${address.port}`,
          '/processing',
          { method: 'POST' },
          1000,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProcessingFixtureHttpError)
        assert.equal(error.phase, 'response_body')
        assert.ok(error.cause instanceof Error)
        assert.ok(['AbortError', 'TimeoutError'].includes(error.cause.name))
        return true
      },
    )
    assert.equal(posts, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('fixture HTTP refusal remains an observable status and is never retried', async () => {
  let posts = 0
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      posts += 1
    }
    response.writeHead(409, { 'content-type': 'application/json' })
    response.end('{"code":"fixture_conflict"}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const result = await requestProcessingFixtureJson(
      `http://127.0.0.1:${address.port}`,
      '/processing',
      { method: 'POST' },
    )
    assert.deepEqual(result, { status: 409, value: { code: 'fixture_conflict' } })
    assert.equal(posts, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
