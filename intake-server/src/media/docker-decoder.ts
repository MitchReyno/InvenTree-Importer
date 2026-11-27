import { DECODER_LABEL, decoderEngine, reapDecoder } from './decoder-cleanup.ts'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import { MEDIA_LIMITS } from '@invimport/media-decoder/protocol'

// Called only by the trusted dispatcher or the existing local worker.
export async function launchDecoder(
  image: string,
  packet: Buffer,
  containerId = randomUUID(),
  owner = 'standalone',
): Promise<Buffer> {
  const name = `bench-media-${containerId}`
  // Create and start separately. Owner death during create can leave only an inert container.
  try {
    await decoderEngine([
      'create',
      '--name',
      name,
      '--rm',
      '--label',
      DECODER_LABEL + owner,
      '--pull=never',
      '--interactive',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      `--memory=${MEDIA_LIMITS.memoryMiB}m`,
      `--memory-swap=${MEDIA_LIMITS.memoryMiB}m`,
      '--cpus=1',
      '--pids-limit=32',
      '--user=1000:1000',
      `--tmpfs=/tmp:rw,noexec,nosuid,size=${MEDIA_LIMITS.scratchMiB}m`,
      image,
      'timeout',
      '--signal=KILL',
      '25s',
      'node',
      '--max-old-space-size=256',
      '--disallow-code-generation-from-strings',
      '/app/media-decoder/src/decoder-main.ts',
    ])
  } catch {
    await reapDecoder(name)
    throw new Error('decoder_interrupted')
  }
  const child = spawn('docker', ['start', '--attach', '--interactive', name], {
    env: { PATH: process.env.PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let length = 0
  const chunks: Buffer[] = []
  let exceeded = false
  let discarded = false

  const discard = () => {
    discarded = true
    child.kill('SIGKILL')
  }

  const timer = setTimeout(discard, MEDIA_LIMITS.wallMilliseconds)
  child.stdout.on('data', (chunk: Buffer) => {
    length += chunk.length
    if (length > MEDIA_LIMITS.totalOutputBytes + MEDIA_DECODER_HEADER_MAX_BYTES) {
      exceeded = true
      discard()
    } else {
      chunks.push(chunk)
    }
  })
  child.stderr.resume()
  child.stdin.on('error', () => undefined)
  child.stdin.end(packet)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
    .catch(async (error) => {
      await reapDecoder(name)
      throw error
    })
    .finally(() => clearTimeout(timer))
  if (code !== 0 || exceeded || discarded) {
    await reapDecoder(name)
    throw new Error('decoder_interrupted')
  }
  return Buffer.concat(chunks)
}
