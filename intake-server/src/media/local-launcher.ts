import { fork } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { reserveDispatcher, type DecoderWork } from './dispatcher-client.ts'

/** One POSIX host directory across worktrees, database namespaces and one-shot processes. */
const hostDirectory = '/tmp/bench-intake-media-launcher'

export function decoderSlots(setting: string | undefined): 1 | 2 {
  if (setting === undefined || setting === '1') {
    return 1
  }
  if (setting === '2') {
    return 2
  }
  throw new Error('invalid_decoder_slot_count')
}

export async function localSlots(directory = hostDirectory) {
  const file = await open(
    join(directory, 'slots'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined
    }
    throw error
  })
  if (!file) {
    return 1
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o022) {
      throw new Error('unsafe_local_decoder_configuration')
    }
    const value = Buffer.alloc(4)
    const { bytesRead } = await file.read(value)
    if (bytesRead >= value.length) {
      throw new Error('invalid_decoder_slot_count')
    }
    return decoderSlots(value.subarray(0, bytesRead).toString().trim())
  } finally {
    await file.close()
  }
}

/** The owner outlives a killed claimant and retires after its final client releases capacity. */
async function electOwner(directory: string) {
  const child = fork(
    fileURLToPath(new URL('./local-dispatcher-main.ts', import.meta.url)),
    [directory],
    {
      execArgv: ['--import', 'tsx'],
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  )
  let timeout: NodeJS.Timeout | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('local_decoder_owner_start_timeout')), 5000)
      child.once('error', reject)
      child.once('exit', () => reject(new Error('local_decoder_owner_stopped')))
      child.once('message', (message) =>
        message === 'ready' ? resolve() : reject(new Error('local_decoder_owner_failed')),
      )
    })
  } finally {
    clearTimeout(timeout)
    if (child.connected) {
      child.disconnect()
    }
    child.unref()
  }
}

export async function reserveLocalDecoder(
  image: string,
  kind: DecoderWork,
  directory = hostDirectory,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const root = await lstat(directory)
  if (!root.isDirectory() || root.uid !== process.getuid?.() || (root.mode & 0o077) !== 0) {
    throw new Error('private_decoder_launcher_directory_required')
  }
  const socket = join(directory, 'worker.sock')
  const deadline = performance.now() + 5000
  do {
    try {
      return await reserveDispatcher(socket, image, kind)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        await electOwner(directory)
      } else if (code !== 'ECONNRESET') {
        throw error
      }
      await delay(40)
    }
  } while (performance.now() < deadline)
  return null
}
