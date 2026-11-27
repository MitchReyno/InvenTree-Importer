import { decoderSlots } from './local-launcher.ts'
import { retireOwnerDecoders } from './decoder-cleanup.ts'
import { chmod, lstat, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { launchDecoder } from './docker-decoder.ts'
import { createDecoderDispatcher } from './decoder-dispatcher.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error('immutable_decoder_image_required')
}
const owner = 'deployed'
const path = '/run/decoder/worker.sock'
const server = createDecoderDispatcher(
  image,
  decoderSlots(process.env.INTAKE_MEDIA_DECODER_SLOTS),
  (pinned, packet) => launchDecoder(pinned, packet, undefined, owner),
)
// The entrypoint holds flock while inspecting a stale socket and electing its replacement.
const old = await lstat(path).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') {
    return undefined
  }
  throw error
})
if (old) {
  if (!old.isSocket()) {
    throw new Error('unexpected_decoder_endpoint')
  }
  await retireOwnerDecoders(owner)
  await rm(path)
}
server.listen(path)
await once(server, 'listening')
await chmod(path, 0o600)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void server.drain().catch(() => {
      process.exitCode = 1
    })
  })
}
