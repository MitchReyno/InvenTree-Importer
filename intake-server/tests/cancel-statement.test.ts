import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import type { Pool, PoolClient } from 'pg'
import { cancelRunningStatement } from '#/db/database.ts'

/** A peer that accepts the cancel request's socket and never answers or closes it. */
async function stalledPeer() {
  const sockets: Socket[] = []
  const received: Buffer[] = []
  const closed: number[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('data', (chunk) => received.push(chunk))
    socket.on('close', () => closed.push(Date.now()))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    port: address.port,
    received,
    closed,
    async close() {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

function runningClient(): PoolClient {
  return {
    activeQuery: { text: 'SELECT pg_sleep(2)' },
    processID: 4242,
    secretKey: 99,
  } as unknown as PoolClient
}

test('a cancel request goes out on its own socket, which a stalled peer cannot keep open', async () => {
  const peer = await stalledPeer()
  try {
    const pool = { options: { host: '127.0.0.1', port: peer.port } } as unknown as Pool
    const sent = Date.now()
    cancelRunningStatement(pool, runningClient(), 200)
    for (let tries = 0; !peer.closed.length && tries < 100; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    // CancelRequest: length 16, code 80877102, then the backend's ID and secret.
    const request = Buffer.concat(peer.received)
    assert.equal(request.length, 16)
    assert.equal(request.readInt32BE(4), 80877102)
    assert.equal(request.readInt32BE(8), 4242)
    assert.equal(request.readInt32BE(12), 99)
    assert.equal(peer.closed.length, 1, 'the socket was closed')
    assert.ok(peer.closed[0] - sent < 1_000, `closed after ${peer.closed[0] - sent} ms`)
  } finally {
    await peer.close()
  }
})

test('a client with nothing running sends no cancel request', async () => {
  const peer = await stalledPeer()
  try {
    const pool = { options: { host: '127.0.0.1', port: peer.port } } as unknown as Pool
    const idle = { ...runningClient(), activeQuery: undefined } as unknown as PoolClient
    cancelRunningStatement(pool, idle, 200)
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.deepEqual(peer.received, [])
  } finally {
    await peer.close()
  }
})
