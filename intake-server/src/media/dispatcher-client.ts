import { Agent, request, type IncomingMessage } from 'node:http'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import { MEDIA_LIMITS } from '@invimport/media-decoder/protocol'
import { settled } from '#/events/settled.ts'

/** The dispatcher's decoder capacity is occupied; the request was not run and may be sent again. */
export class DecoderDispatcherBusyError extends Error {
  constructor() {
    super('decoder_dispatch_busy')
  }
}

/**
 * How long a decode waits for a busy dispatcher. The figure render consumer pauses between renders
 * and doesn't wait itself, so this covers several renders back to back, each within the wall time.
 */
export const DISPATCH_BUSY_WAIT_MS = 20 * MEDIA_LIMITS.wallMilliseconds
/** How often a request asks a busy dispatcher again. */
const DISPATCH_BUSY_RETRY_MS = 500

/**
 * Sends one decode to the dispatcher. If all slots are taken by other work, the dispatcher
 * answers with 503 before running anything. The request is sent again until `busyWaitMs`
 * passes and then fails as busy. Undefined waits the default; zero asks once.
 */
export async function requestDecode(
  socketPath: string,
  image: string,
  packet: Buffer,
  busyWaitMs: number = DISPATCH_BUSY_WAIT_MS,
): Promise<Buffer> {
  const deadline = Date.now() + busyWaitMs
  for (;;) {
    try {
      return await requestDecodeOnce(socketPath, image, packet)
    } catch (error) {
      const waitLonger = error instanceof DecoderDispatcherBusyError && Date.now() < deadline
      if (!waitLonger) {
        throw error
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DISPATCH_BUSY_RETRY_MS))
  }
}

function requestDecodeOnce(
  socketPath: string,
  image: string,
  packet: Buffer,
  reservation?: { agent: Agent; token: string },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: '/decode',
        method: 'POST',
        agent: reservation?.agent ?? false,
        signal: AbortSignal.timeout(MEDIA_LIMITS.wallMilliseconds + 10000),
        headers: {
          'content-length': packet.length,
          'x-decoder-image': image,
          ...(reservation ? { 'x-decoder-reservation': reservation.token } : {}),
        },
      },
      settled(
        async (res: IncomingMessage) => {
          try {
            if (res.statusCode === 503) {
              throw new DecoderDispatcherBusyError()
            }
            if (res.statusCode !== 200) {
              throw new Error('decoder_dispatch_refused')
            }
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of res) {
              size += chunk.length
              if (size > MEDIA_LIMITS.totalOutputBytes + MEDIA_DECODER_HEADER_MAX_BYTES) {
                throw new Error('decoder_output_limit')
              }
              chunks.push(chunk)
            }
            resolve(Buffer.concat(chunks))
          } catch (error) {
            res.destroy()
            reject(error)
          }
        },
        (error, res) => {
          res.destroy()
          reject(error)
        },
      ),
    )
    req.on('error', reject)
    req.end(packet)
  })
}

export type DecoderWork = 'decode' | 'figure' | 'backfill'

/** Own one connection through admission, claim, decode and publication. */
export async function reserveDispatcher(
  socketPath: string,
  image: string,
  kind: DecoderWork = 'decode',
) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  try {
    const token = await new Promise<string | null>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          agent,
          method: 'POST',
          path: '/reserve',
          signal: AbortSignal.timeout(10000),
          headers: { 'content-length': 0, 'x-decoder-image': image, 'x-decoder-work': kind },
        },
        (res) => {
          res.on('error', reject)
          res.resume()
          res.once('end', () => {
            const token = res.headers['x-decoder-reservation']
            if (res.statusCode === 503) {
              resolve(null)
            } else if (
              res.statusCode === 200 &&
              typeof token === 'string' &&
              /^[0-9a-f-]{36}$/.test(token)
            ) {
              resolve(token)
            } else {
              reject(new Error('decoder_reservation_refused'))
            }
          })
        },
      )
      req.once('error', reject)
      req.end()
    })
    if (!token) {
      agent.destroy()
      return null
    }
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          agent,
          path: '/activate',
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            'content-length': 0,
            'x-decoder-image': image,
            'x-decoder-reservation': token,
          },
        },
        (res) => {
          res.once('error', reject)
          res.resume()
          res.once('end', () =>
            res.statusCode === 204 ? resolve() : reject(new Error('decoder_activation_refused')),
          )
        },
      )
      req.once('error', reject)
      req.end()
    })
    return {
      run: (packet: Buffer) => requestDecodeOnce(socketPath, image, packet, { agent, token }),
      release: () => agent.destroy(),
    }
  } catch (error) {
    agent.destroy()
    throw error
  }
}
