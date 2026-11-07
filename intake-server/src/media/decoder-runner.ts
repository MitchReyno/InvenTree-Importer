import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseDecoderOutput } from './decoder-output.ts'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import {
  checkedInput,
  MEDIA_LIMITS,
  type DecodeInput,
  type DecodedMedia,
} from './decoder-protocol.ts'

/** Requires an operator-built immutable image, never a browser-selected image/command. */
export async function decodeIsolated(image: string, input: DecodeInput): Promise<DecodedMedia> {
  checkedInput(input)
  if (image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('immutable_decoder_image_required')
  }
  const protocolBytes = JSON.stringify({
    version: input.version,
    digest: input.digest,
    recipe: input.recipe ?? null,
  })
  const name = `bench-media-${randomUUID()}`
  const child = spawn(
    'docker',
    [
      'run',
      '--name',
      name,
      '--rm',
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
      '/app/intake-server/src/media/decoder-main.ts',
    ],
    { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let length = 0
  const chunks: Buffer[] = []
  let exceeded = false
  let cleanup: Promise<void> | null = null
  let discarded = false

  const discard = () => {
    if (discarded) {
      return
    }
    discarded = true
    child.kill('SIGKILL')
    // Killing the CLI does not prove its container died. Explicitly remove the named child.
    const cleanupProcess = spawn('docker', ['rm', '--force', name], {
      env: { PATH: process.env.PATH },
      stdio: 'ignore',
    })
    cleanup = new Promise<void>((resolveCleanup) => {
      const cleanupTimer = setTimeout(() => {
        cleanupProcess.kill('SIGKILL')
        resolveCleanup()
      }, 5000)
      cleanupProcess.once('error', () => {
        clearTimeout(cleanupTimer)
        resolveCleanup()
      })
      cleanupProcess.once('close', () => {
        clearTimeout(cleanupTimer)
        resolveCleanup()
      })
    })
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
  child.stdin.end(Buffer.concat([Buffer.from(protocolBytes + '\n'), input.bytes]))
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  }).finally(() => clearTimeout(timer))
  if (code !== 0 || exceeded || discarded) {
    discard()
    if (cleanup) {
      await cleanup
    }
    throw new Error('decoder_interrupted')
  }
  return parseDecoderOutput(Buffer.concat(chunks))
}
