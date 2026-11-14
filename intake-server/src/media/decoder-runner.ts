import { spawn } from 'node:child_process'
import { requestDecode } from './dispatcher-client.ts'
import { randomUUID } from 'node:crypto'
import { parseDecoderOutput, parseRenditionOutput } from './decoder-output.ts'
import { MEDIA_DECODER_HEADER_MAX_BYTES } from '@invimport/contracts/media'
import {
  checkedInput,
  checkedRenditionInput,
  MEDIA_LIMITS,
  type DecodeInput,
  type DecodedMedia,
  type RenditionInput,
  type RenditionResult,
} from '@invimport/media-decoder/protocol'

/** Requires an operator-built immutable image, never a browser-selected image/command. */
export async function decodeIsolated(image: string, input: DecodeInput): Promise<DecodedMedia> {
  checkedInput(input)
  const header = { version: input.version, digest: input.digest, recipe: input.recipe ?? null }
  return parseDecoderOutput(await runIsolated(image, header, input.bytes))
}

/** Renditions of one retained page PNG, rendered in the same bounded container. */
export async function renderIsolated(
  image: string,
  input: RenditionInput,
): Promise<RenditionResult> {
  checkedRenditionInput(input)
  const header = {
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
  }
  return parseRenditionOutput(await runIsolated(image, header, input.bytes), input)
}

async function runIsolated(image: string, header: object, bytes: Buffer): Promise<Buffer> {
  if (image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('immutable_decoder_image_required')
  }
  const packet = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), bytes])
  const socket = process.env.INTAKE_MEDIA_DISPATCH_SOCKET
  return socket ? requestDecode(socket, image, packet) : launchDecoder(image, packet)
}

// Called only by the trusted dispatcher or the existing local worker.
export async function launchDecoder(image: string, packet: Buffer): Promise<Buffer> {
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
      '/app/media-decoder/src/decoder-main.ts',
    ],
    { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let length = 0
  const chunks: Buffer[] = []
  let exceeded = false
  let cleanup: Promise<void> | undefined
  let discarded = false

  // Kills the decoder once and returns the removal of its container, which never rejects.
  const discard = (): Promise<void> => {
    if (cleanup) {
      return cleanup
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
    return cleanup
  }

  const timer = setTimeout(() => void discard(), MEDIA_LIMITS.wallMilliseconds)
  child.stdout.on('data', (chunk: Buffer) => {
    length += chunk.length
    if (length > MEDIA_LIMITS.totalOutputBytes + MEDIA_DECODER_HEADER_MAX_BYTES) {
      exceeded = true
      void discard()
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
  }).finally(() => clearTimeout(timer))
  if (code !== 0 || exceeded || discarded) {
    await discard()
    throw new Error('decoder_interrupted')
  }
  return Buffer.concat(chunks)
}
