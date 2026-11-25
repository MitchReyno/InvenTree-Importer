import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmod, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { once } from 'node:events'
import { createDecoderDispatcher } from './decoder-dispatcher.ts'
import { launchDecoder } from './docker-decoder.ts'
import { retireOwnerDecoders } from './decoder-cleanup.ts'
import { localSlots } from './local-launcher.ts'

async function main() {
  const [directory, image] = process.argv.slice(2)
  if (!directory || !/^sha256:[a-f0-9]{64}$/.test(image ?? '') || !process.send) {
    throw new Error('local_owner_configuration_required')
  }
  // SQLite supplies a kernel-released POSIX writer lock. No inventory or job state is stored here.
  const lock = new DatabaseSync(join(directory, 'owner.sqlite'))
  try {
    try {
      lock.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if ((error as { errcode?: number }).errcode !== 5) {
        throw error
      }
      process.send('ready')
      return
    }
    const owner = createHash('sha256').update(directory).digest('hex')
    const path = join(directory, 'worker.sock')
    const old = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return undefined
      }
      throw error
    })
    if (old) {
      if (!old.isSocket()) {
        throw new Error('unexpected_local_decoder_endpoint')
      }
      await retireOwnerDecoders(owner)
      await rm(path)
    }
    const server = createDecoderDispatcher(image, await localSlots(directory), (pinned, packet) =>
      launchDecoder(pinned, packet, undefined, owner),
    )
    server.listen(path)
    await once(server, 'listening')
    await chmod(path, 0o600)
    process.send('ready')
    const stop = new AbortController()
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => stop.abort())
    }
    // Allow the electing caller time to connect. Requests rejected for another image do not extend ownership.
    const untilIdle = setInterval(() => {
      if (server.idleFor(900)) {
        stop.abort()
      }
    }, 200)
    try {
      await once(stop.signal, 'abort')
      await server.drain()
    } finally {
      clearInterval(untilIdle)
    }
  } finally {
    lock.close()
  }
}

main().catch(() => {
  if (process.connected) {
    process.send?.('failed')
  }
  process.exitCode = 1
})
