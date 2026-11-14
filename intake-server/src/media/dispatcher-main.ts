// Only this service receives Docker access. The sole operation accepts the decoder's byte protocol.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chmod, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { launchDecoder } from './decoder-runner.ts'
import { settled } from '#/events/settled.ts'
import { MEDIA_LIMITS } from '@invimport/media-decoder/protocol'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error('immutable_decoder_image_required')
}
const path = '/run/decoder/worker.sock'
const limit = Math.max(MEDIA_LIMITS.sourceBytes, MEDIA_LIMITS.outputBytes) + 8192
let busy = false
const server = createServer(
  settled(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (
        req.method !== 'POST' ||
        req.url !== '/decode' ||
        req.headers['x-decoder-image'] !== image
      ) {
        res.writeHead(403, { connection: 'close' }).end()
        return
      }
      const length = Number(req.headers['content-length'])
      if (!Number.isSafeInteger(length) || length < 1 || length > limit) {
        res.writeHead(413, { connection: 'close' }).end()
        return
      }
      if (busy) {
        res.writeHead(503, { connection: 'close' }).end()
        return
      }
      busy = true
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > length) {
            throw new Error('decoder_input_limit')
          }
          chunks.push(chunk)
        }
        if (size !== length) {
          throw new Error('incomplete_request')
        }
        const output = await launchDecoder(image, Buffer.concat(chunks))
        res.writeHead(200, { 'content-length': output.length }).end(output)
        // Retain the slot until buffered output is flushed or the caller disconnects.
        if (!res.writableFinished && !res.destroyed) {
          await once(res, 'close')
        }
      } catch {
        if (!res.headersSent) {
          res.writeHead(502)
        }
        res.end()
      } finally {
        busy = false
      }
    },
    // A failure the handler did not catch ends this request, not the dispatcher.
    (_error, _req, res) => res.destroy(),
  ),
)
server.maxConnections = 4
server.requestTimeout = 15000
server.headersTimeout = 10000
server.setTimeout(45000, (socket) => socket.destroy())
// The container entrypoint holds a nonblocking flock across cleanup, listen and exit.
await rm(path, { force: true })
server.listen(path)
await once(server, 'listening')
await chmod(path, 0o600)
