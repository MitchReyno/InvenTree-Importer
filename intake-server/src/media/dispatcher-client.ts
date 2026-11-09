import { request } from 'node:http'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import { MEDIA_LIMITS } from './decoder-protocol.ts'

export function requestDecode(socketPath: string, image: string, packet: Buffer): Promise<Buffer> {
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
      async (res) => {
        try {
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
    )
    req.on('error', reject)
    req.end(packet)
  })
}
