import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import WebSocket from 'ws'
import { LIVE_PROTOCOL, validate, type LiveFrameDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { until } from '../support/manual-process.ts'
import { appendEvent } from '../../src/db/authority.ts'
import { liveProjection } from '../../src/live/projection.ts'

async function connect(fixture: Awaited<ReturnType<typeof manualFixture>>) {
  const frames: LiveFrameDto[] = []
  const socket = new WebSocket(fixture.config.origin.replace('http:', 'ws:') + '/api/v1/live', {
    headers: { origin: fixture.config.origin },
    handshakeTimeout: 5000,
  })
  socket.on('message', (bytes) => {
    const frame: unknown = JSON.parse(bytes.toString())
    validate('LiveFrame', frame)
    frames.push(frame as LiveFrameDto)
  })
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
  const bootstrap = await fixture.http('/bootstrap')
  return {
    socket,
    frames,
    subscribe: (batchId: string | null, cursors: unknown[] = []) =>
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          protocol: LIVE_PROTOCOL,
          csrf_token: bootstrap.value.csrf_token,
          batch_id: batchId,
          cursors,
        }),
      ),
  }
}

test('commit-ordered projection hints retain exact cursors, reset gaps and refuse other scopes', async () => {
  const fixture = await manualFixture()
  const client = await fixture.db.pool.connect()
  try {
    const capture = await fixture.seedCapture()
    const stream = capture.batch.cursor.stream_id
    const before = capture.batch.cursor.sequence
    await client.query('BEGIN')
    const next = await appendEvent(client, stream, 'qualification', { safe: true })
    assert.equal(BigInt(next), BigInt(before) + 1n)
    const hidden = await liveProjection(fixture.api.pool, fixture.config, capture.batch.id, [
      capture.batch.cursor,
    ])
    assert.equal(hidden.heads[0].sequence, before)
    await client.query('COMMIT')
    const committed = await liveProjection(fixture.api.pool, fixture.config, capture.batch.id, [
      capture.batch.cursor,
    ])
    assert.equal(committed.heads[0].sequence, next)
    assert.equal(committed.heads[0].reset, false)
    await fixture.db.pool.query('UPDATE ui_stream SET head=$2 WHERE id=$1', [
      stream,
      '9007199254740992',
    ])
    await client.query('BEGIN')
    await appendEvent(client, stream, 'qualification', {})
    await client.query('COMMIT')
    const exact = await liveProjection(fixture.api.pool, fixture.config, capture.batch.id, [
      { stream_id: stream, sequence: '9007199254740992' },
    ])
    assert.equal(exact.heads[0].sequence, '9007199254740993')
    assert.equal(exact.heads[0].reset, false)
    const expired = await liveProjection(fixture.api.pool, fixture.config, null, [
      capture.batch.cursor,
    ])
    assert.equal(expired.heads[0].reset, true)
    const future = await liveProjection(fixture.api.pool, fixture.config, null, [
      { stream_id: stream, sequence: '9007199254740994' },
    ])
    assert.equal(future.heads[0].reset, true)
    const otherActor = { ...fixture.config, actorId: randomUUID() }
    assert.deepEqual((await liveProjection(fixture.api.pool, otherActor, null, [])).heads, [])
    await assert.rejects(
      liveProjection(fixture.api.pool, otherActor, capture.batch.id, []),
      /live_batch_unavailable/,
    )
    await assert.rejects(
      liveProjection(
        fixture.api.pool,
        { ...fixture.config, targetContextId: randomUUID() },
        null,
        [],
      ),
      /live_context_changed/,
    )
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
    await fixture.dispose()
  }
})

test('actual WebSocket publishes committed edits, reconnects from retained cursors, and never dispatches effects', async () => {
  const fixture = await manualFixture()
  let socket: WebSocket | undefined
  try {
    const capture = await fixture.seedCapture()
    const first = await connect(fixture)
    socket = first.socket
    first.subscribe(capture.batch.id)
    await until(
      async () => first.frames,
      (frames) => frames.some((frame) => frame.type === 'ready'),
    )
    const ready = first.frames.find((frame) => frame.type === 'ready')!
    assert.equal(ready.type, 'ready')
    const edited = await fixture.http(`/batches/${capture.batch.id}/edits`, {
      expected_revision: capture.batch.revision,
      change: { kind: 'batch', title: 'Changed with a live channel' },
    })
    assert.equal(edited.status, 200)
    await until(
      async () => first.frames,
      (frames) => frames.some((frame) => frame.type === 'changed'),
    )
    const changed = first.frames.find((frame) => frame.type === 'changed')!
    assert.equal(changed.type, 'changed')
    assert.equal(changed.sequence, edited.value.cursor.sequence)
    assert.equal(changed.reset, false)
    assert.equal('payload' in changed, false)
    socket.close()
    await once(socket, 'close')
    const second = await connect(fixture)
    socket = second.socket
    second.subscribe(capture.batch.id, ready.cursors)
    await until(
      async () => second.frames,
      (frames) => frames.some((frame) => frame.type === 'ready'),
    )
    const current = second.frames.find((frame) => frame.type === 'ready')!
    assert.equal(current.type, 'ready')
    assert.equal(current.cursors[0].sequence, changed.sequence)
    assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
  } finally {
    socket?.terminate()
    await fixture.dispose()
  }
})

test('WebSocket rejects cross-origin upgrades, bad authorization, stale protocol and command frames', async () => {
  const fixture = await manualFixture()
  const sockets: WebSocket[] = []
  try {
    const rejected = new WebSocket(fixture.config.origin.replace('http:', 'ws:') + '/api/v1/live', {
      headers: { origin: 'http://127.0.0.1:9999' },
    })
    sockets.push(rejected)
    rejected.on('error', () => undefined)
    const [, response] = await once(rejected, 'unexpected-response', {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.statusCode, 403)
    response.destroy()
    rejected.terminate()
    for (const [message, code] of [
      [
        {
          type: 'subscribe',
          protocol: LIVE_PROTOCOL,
          csrf_token: '0'.repeat(64),
          batch_id: null,
          cursors: [],
        },
        1008,
      ],
      [{ type: 'subscribe', protocol: 'bench-intake-live/0' }, 1002],
      [{ type: 'cancel', run_id: randomUUID() }, 1008],
    ] as const) {
      const { socket } = await connect(fixture)
      sockets.push(socket)
      const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) })
      socket.send(JSON.stringify(message))
      assert.equal((await closed)[0], code)
    }
    assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
  } finally {
    for (const socket of sockets) socket.terminate()
    await fixture.dispose()
  }
})

test('WebSocket connection and input bounds reject excess peers without any target effects', async () => {
  const fixture = await manualFixture()
  const sockets: WebSocket[] = []
  try {
    for (let index = 0; index < 8; index++) {
      const connection = await connect(fixture)
      sockets.push(connection.socket)
      connection.subscribe(null)
    }
    const excess = new WebSocket(fixture.config.origin.replace('http:', 'ws:') + '/api/v1/live', {
      headers: { origin: fixture.config.origin },
    })
    sockets.push(excess)
    excess.on('error', () => undefined)
    const [, response] = await once(excess, 'unexpected-response', {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.statusCode, 403)
    response.destroy()
    excess.terminate()
    const oversized = sockets[0]
    const closed = once(oversized, 'close', { signal: AbortSignal.timeout(5000) })
    oversized.send('x'.repeat(16385))
    assert.notEqual((await closed)[0], 1000)
    assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
  } finally {
    for (const socket of sockets) socket.terminate()
    await fixture.dispose()
  }
})
