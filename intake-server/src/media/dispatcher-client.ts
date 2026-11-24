import { request, type IncomingMessage } from 'node:http'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import { MEDIA_LIMITS } from '@invimport/media-decoder/protocol'
import { settled } from '#/events/settled.ts'

/** The dispatcher's one decode slot is taken; the request was not run and may be sent again. */
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
 * Sends one decode to the dispatcher. Its one slot may be taken by another decode, which it
 * answers with 503 before running anything, so the request is sent again until `busyWaitMs`
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

function requestDecodeOnce(socketPath: string, image: string, packet: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: '/decode',
        method: 'POST',
        agent: false,
        signal: AbortSignal.timeout(MEDIA_LIMITS.wallMilliseconds + 10000),
        headers: { 'content-length': packet.length, 'x-decoder-image': image },
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
