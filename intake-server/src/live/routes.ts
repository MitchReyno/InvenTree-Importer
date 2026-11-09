import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { WebSocket } from 'ws'
import {
  LIVE_PROTOCOL,
  validate,
  type LiveCursorDto,
  type LiveFrameDto,
  type LiveSubscribeDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { authorizeLive } from '../api/server.ts'
import { bootstrap, type DevConfig } from '../config.ts'
import { liveProjection } from './projection.ts'
import { sendLiveFrame } from './frames.ts'

const MAX_CONNECTIONS = 8
const READ_INTERVAL_MS = 1000
const HEARTBEAT_MS = 10000
const MAX_LIFETIME_MS = 5 * 60 * 1000

/** Explicit web-only projection service. No worker, inventory transport or mutation closure. */
export function registerLive(app: FastifyInstance, pool: Pool, config: DevConfig) {
  const configured = bootstrap(config).status === 'configured'
  const sockets = new Set<WebSocket>()
  app.register(async (scope) => {
    await scope.register(websocket, { options: { maxPayload: 16384, perMessageDeflate: false } })
    scope.get(
      '/api/v1/live',
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (
            request.headers.origin !== config.origin ||
            !configured ||
            sockets.size >= MAX_CONNECTIONS
          ) {
            return reply.code(403).send({
              code: 'live_unavailable',
              message: 'Live connection unavailable.',
              recovery: 'refresh',
              correlation_id: request.id,
            })
          }
        },
      },
      (socket) => {
        if (sockets.size >= MAX_CONNECTIONS) {
          socket.terminate()
          return
        }
        sockets.add(socket)
        let subscribed = false
        let reading = false
        let alive = true
        let batchId: string | null = null
        let cursors: LiveCursorDto[] = []
        let truncated = false
        let lastHeartbeat = Date.now()
        let interval: NodeJS.Timeout | undefined
        const authDeadline = setTimeout(() => socket.close(1008, 'subscription_required'), 5000)
        const lifetime = setTimeout(() => socket.close(1012, 'refresh_connection'), MAX_LIFETIME_MS)

        const send = (frame: LiveFrameDto) => sendLiveFrame(socket, frame)

        const read = async (initial: boolean) => {
          if (reading || socket.readyState !== socket.OPEN) {
            return
          }
          reading = true
          try {
            const state = await liveProjection(pool, config, batchId, cursors)
            if (socket.readyState !== socket.OPEN) {
              return
            }
            const previous = new Map(cursors.map((cursor) => [cursor.stream_id, cursor.sequence]))
            if (
              initial ||
              state.truncated !== truncated ||
              state.heads.some((head) => !previous.has(head.stream_id))
            ) {
              send({
                type: 'ready',
                protocol: LIVE_PROTOCOL,
                cursors: state.heads.map(({ stream_id, sequence }) => ({ stream_id, sequence })),
                truncated: state.truncated,
              })
            } else {
              for (const head of state.heads) {
                if (previous.get(head.stream_id) !== head.sequence) {
                  send({ type: 'changed', protocol: LIVE_PROTOCOL, ...head })
                }
              }
            }
            cursors = state.heads.map(({ stream_id, sequence }) => ({ stream_id, sequence }))
            truncated = state.truncated
            if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
              if (!alive) {
                socket.terminate()
                return
              }
              alive = false
              socket.ping()
              send({ type: 'heartbeat', protocol: LIVE_PROTOCOL })
              lastHeartbeat = Date.now()
            }
          } catch {
            socket.close(1012, 'projection_unavailable')
          } finally {
            reading = false
          }
        }

        socket.on('pong', () => {
          alive = true
        })
        socket.on('message', (bytes, binary) => {
          if (subscribed || binary) {
            socket.close(1008, 'invalid_subscription')
            return
          }
          subscribed = true
          try {
            const value = strictJson(bytes.toString())
            if (
              value &&
              typeof value === 'object' &&
              'protocol' in value &&
              value.protocol !== LIVE_PROTOCOL
            ) {
              socket.close(1002, 'version_mismatch')
              return
            }
            validate('LiveSubscribe', value)
            const subscription = value as LiveSubscribeDto
            if (
              !authorizeLive(app, subscription.csrf_token) ||
              new Set(subscription.cursors.map((cursor) => cursor.stream_id)).size !==
                subscription.cursors.length
            ) {
              socket.close(1008, 'subscription_refused')
              return
            }
            clearTimeout(authDeadline)
            batchId = subscription.batch_id
            cursors = subscription.cursors
            void read(true)
            interval = setInterval(() => {
              void read(false)
            }, READ_INTERVAL_MS)
          } catch {
            socket.close(1008, 'invalid_subscription')
          }
        })

        const cleanup = () => {
          clearTimeout(authDeadline)
          clearTimeout(lifetime)
          clearInterval(interval)
          sockets.delete(socket)
        }

        socket.on('close', cleanup)
        socket.on('error', () => {
          socket.terminate()
          cleanup()
        })
      },
    )
    scope.addHook('preClose', async () => {
      for (const socket of sockets) {
        socket.terminate()
      }
    })
  })
}
