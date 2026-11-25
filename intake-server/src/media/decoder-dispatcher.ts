import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { MEDIA_LIMITS } from '@invimport/media-decoder/protocol'
import { settled } from '#/events/settled.ts'

const limit = Math.max(MEDIA_LIMITS.sourceBytes, MEDIA_LIMITS.outputBytes) + 8192

/** Accept one bounded input. Legacy and reserved calls use the same launcher and capacity. */
async function decode(
  req: IncomingMessage,
  res: ServerResponse,
  length: number,
  launch: (packet: Buffer) => Promise<Buffer>,
) {
  const packet = Buffer.allocUnsafe(length)
  let size = 0
  for await (const chunk of req) {
    if (size + chunk.length > length) {
      throw new Error('decoder_input_limit')
    }
    chunk.copy(packet, size)
    size += chunk.length
  }
  if (size !== length) {
    throw new Error('incomplete_request')
  }
  const output = await launch(packet)
  res.writeHead(200, { 'content-length': output.length }).end(output)
  if (!res.writableFinished && !res.destroyed) {
    await once(res, 'close')
  }
}

/** A reservation occupies one slot from offer to expiry, disconnect, or completion of its one request. */
export function createDecoderDispatcher(
  image: string,
  capacity: 1 | 2,
  launch: (image: string, packet: Buffer) => Promise<Buffer>,
) {
  type Lease = {
    token: string
    maintenance: boolean
    state: 'reserved' | 'active' | 'running' | 'delivered'
    expiry?: NodeJS.Timeout
  }
  const leases = new Map<Socket, Lease>()
  let lastRelease = performance.now()
  let legacyRunning = 0
  let draining: Promise<void> | undefined
  let idle: (() => void) | undefined

  function inUse() {
    return leases.size + legacyRunning
  }

  function onReleased() {
    lastRelease = performance.now()
    if (inUse() === 0) {
      idle?.()
    }
  }

  function release(socket: Socket, lease: Lease) {
    clearTimeout(lease.expiry)
    leases.delete(socket)
    onReleased()
  }

  const server = createServer(
    settled(
      async (req: IncomingMessage, res: ServerResponse) => {
        const socket = req.socket

        const refuse = (status: number) => {
          res.writeHead(status, { connection: 'close' }).end()
        }

        if (req.method !== 'POST' || req.headers['x-decoder-image'] !== image) {
          return refuse(403)
        }
        const length = Number(req.headers['content-length'])
        const lease = leases.get(socket)
        const full = inUse() >= capacity
        if (req.url === '/reserve') {
          if (length !== 0 || req.headers['transfer-encoding'] || lease) {
            return refuse(400)
          }
          const kind = req.headers['x-decoder-work'] ?? 'decode'
          if (kind !== 'decode' && kind !== 'backfill' && kind !== 'figure') {
            return refuse(400)
          }
          const maintenance = kind !== 'decode'
          if (
            draining ||
            full ||
            (maintenance && [...leases.values()].some((item) => item.maintenance))
          ) {
            return refuse(503)
          }
          const next: Lease = { token: randomUUID(), maintenance, state: 'reserved' }
          next.expiry = setTimeout(() => socket.destroy(), 10000)
          leases.set(socket, next)
          socket.once('close', () => {
            if (next.state !== 'running') {
              release(socket, next)
            }
          })
          res.writeHead(200, { 'x-decoder-reservation': next.token, 'content-length': 0 }).end()
          return
        }
        if (
          req.url === '/activate' &&
          lease?.state === 'reserved' &&
          req.headers['x-decoder-reservation'] === lease.token &&
          length === 0 &&
          !req.headers['transfer-encoding']
        ) {
          clearTimeout(lease.expiry)
          lease.state = 'active'
          // A live worker owns the slot through DB claim, bounded blob staging, decode and publication.
          res.writeHead(204).end()
          return
        }
        if (req.url !== '/decode') {
          return refuse(403)
        }
        if (!Number.isSafeInteger(length) || length < 1 || length > limit) {
          return refuse(413)
        }
        const token = req.headers['x-decoder-reservation'] || undefined
        if (token !== lease?.token || (lease && lease.state !== 'active')) {
          return refuse(403)
        }
        if (!lease && (full || draining)) {
          return refuse(503)
        }
        if (lease) {
          clearTimeout(lease.expiry)
          lease.state = 'running'
        } else {
          legacyRunning++
        }
        try {
          await decode(req, res, length, (packet) => launch(image, packet))
        } catch {
          if (!res.headersSent) {
            res.writeHead(502)
          }
          res.end()
        } finally {
          if (lease) {
            lease.state = 'delivered'
            if (socket.destroyed) {
              release(socket, lease)
            }
          } else {
            legacyRunning--
            onReleased()
          }
        }
      },
      (_error, _req, res) => res.destroy(),
    ),
  )
  server.maxConnections = capacity + 4
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 0
  server.setTimeout(45000, (socket) => {
    const state = leases.get(socket)?.state
    if (state !== 'active' && state !== 'delivered') {
      socket.destroy()
    }
  })
  return Object.assign(server, {
    idleFor(ms: number) {
      return !inUse() && performance.now() - lastRelease >= ms
    },
    drain() {
      draining ??= (async () => {
        if (inUse()) {
          await new Promise<void>((resolve) => {
            idle = resolve
          })
        }
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      })()
      return draining
    },
  })
}
