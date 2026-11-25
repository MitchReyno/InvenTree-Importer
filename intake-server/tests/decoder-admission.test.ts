import { barrier } from './support/test-barrier.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reserveDispatcher } from '#/media/dispatcher-client.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Agent, request } from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createDecoderDispatcher } from '#/media/decoder-dispatcher.ts'

const image = `sha256:${'a'.repeat(64)}`

test('two clients can reserve before sending bytes and a third stays unadmitted', async (t) => {
  const executed: string[] = []
  const server = createDecoderDispatcher(image, 2, async (_image, packet) => {
    executed.push(packet.toString())
    return packet
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const clients = Array.from({ length: 3 }, () => new Agent({ keepAlive: true, maxSockets: 1 }))
  t.after(async () => {
    for (const client of clients) client.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const send = (agent: Agent, path: string, body = '', reservation = '') =>
    new Promise<{ status: number | undefined; token: string }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          agent,
          method: 'POST',
          path,
          headers: {
            'x-decoder-image': image,
            'x-decoder-reservation': reservation,
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume()
          res.once('end', () =>
            resolve({
              status: res.statusCode,
              token: String(res.headers['x-decoder-reservation'] ?? ''),
            }),
          )
        },
      )
      req.on('error', reject)
      req.end(body)
    })
  const first = await send(clients[0]!, '/reserve')
  const second = await send(clients[1]!, '/reserve')
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.ok(first.token && second.token && first.token !== second.token)
  assert.equal((await send(clients[2]!, '/reserve')).status, 503)
  assert.deepEqual(executed, [])
  assert.equal((await send(clients[2]!, '/decode', 'stolen', second.token)).status, 403)
  assert.equal((await send(clients[1]!, '/activate', '', second.token)).status, 204)
  assert.equal((await send(clients[1]!, '/decode', 'second', second.token)).status, 200)
  assert.equal((await send(clients[2]!, '/reserve')).status, 503)
  assert.equal((await send(clients[1]!, '/decode', 'duplicate', second.token)).status, 403)
  assert.equal((await send(clients[2]!, '/reserve')).status, 200)
  assert.equal((await send(clients[0]!, '/activate', '', first.token)).status, 204)
  assert.equal((await send(clients[0]!, '/decode', 'first', first.token)).status, 200)
  assert.deepEqual(executed, ['second', 'first'])
})

test('a worker releases an unused reservation and the next worker can decode', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'media-admit-'))
  const socket = join(root, 'worker.sock')
  const server = createDecoderDispatcher(image, 1, async (_image, packet) => packet)
  server.listen(socket)
  await once(server, 'listening')
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })
  const first = await reserveDispatcher(socket, image)
  assert.ok(first)
  try {
    assert.equal(await reserveDispatcher(socket, image), null)
  } finally {
    first.release()
  }
  const next = await reserveDispatcher(socket, image)
  assert.ok(next)
  try {
    assert.deepEqual(await next.run(Buffer.from('one job')), Buffer.from('one job'))
    await assert.rejects(next.run(Buffer.from('again')), /decoder_dispatch_refused/)
  } finally {
    next.release()
  }
})

test('activated staging survives the unused-offer deadline and holds output capacity until release', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'media-active-'))
  const socket = join(root, 'worker.sock')
  const server = createDecoderDispatcher(image, 1, async (_image, packet) => packet)
  server.listen(socket)
  await once(server, 'listening')
  t.after(async () => {
    await server.drain()
    await rm(root, { recursive: true, force: true })
  })
  const held = await reserveDispatcher(socket, image, 'figure')
  assert.ok(held)
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    t.mock.timers.tick(12_000)
    t.mock.timers.reset()
    assert.deepEqual(await held.run(Buffer.from('staged')), Buffer.from('staged'))
    assert.equal(await reserveDispatcher(socket, image), null)
  } finally {
    held.release()
  }
})

test('an unconfirmed Docker removal keeps the slot until the engine confirms absence', async () => {
  const { reapDecoder } = await import('#/media/decoder-cleanup.ts')
  const attempts: string[] = []
  let retries = 0
  await reapDecoder(
    'bench-media-test',
    async (args) => {
      attempts.push(args[0])
      if (args[0] === 'rm' || retries === 0) throw new Error('engine unavailable')
      return retries === 1 ? 'existing-child' : ''
    },
    async () => {
      retries++
    },
  )
  assert.deepEqual(attempts, ['rm', 'container', 'rm', 'container', 'rm', 'container'])
  assert.equal(retries, 2)
})

test('disconnecting during a launch holds capacity through child exit and repeated drain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-running-'))
  const socket = join(root, 'worker.sock')
  const started = barrier()
  const exited = barrier()
  const server = createDecoderDispatcher(image, 1, async (_image, bytes) => {
    started.resolve()
    await exited.promise
    return bytes
  })
  server.listen(socket)
  await once(server, 'listening')
  try {
    const first = await reserveDispatcher(socket, image)
    assert.ok(first)
    const interrupted = assert.rejects(first.run(Buffer.from('in flight')))
    await started.promise
    first.release()
    await interrupted
    assert.equal(await reserveDispatcher(socket, image), null)
    const closing = server.drain()
    assert.equal(server.drain(), closing)
    assert.equal(await reserveDispatcher(socket, image), null)
    exited.resolve()
    await closing
  } finally {
    exited.resolve()
    await server.drain()
    await rm(root, { recursive: true, force: true })
  }
})

test('a replacement fences an already-created decoder before its delayed start can run', async () => {
  const { retireOwnerDecoders } = await import('#/media/decoder-cleanup.ts')
  const id = 'a'.repeat(64)
  let created = true
  const calls: string[][] = []
  await retireOwnerDecoders('test-owner', async (args) => {
    calls.push(args)
    if (args[0] === 'rm') {
      created = false
      return ''
    }
    assert.ok(args.includes('--all'))
    assert.ok(args.includes('label=bench.intake.decoder-owner=test-owner'))
    return id
  })
  assert.equal(created, false)
  assert.deepEqual(calls[1], ['rm', '--force', id])
})
