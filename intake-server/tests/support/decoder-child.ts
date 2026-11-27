import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  checkedGridInput,
  checkedLogoMatchInput,
  checkedPreviewInput,
} from '@invimport/media-decoder/protocol'
import { previewPacket } from '#/media/decoder-runner.ts'
import {
  parseGridOutput,
  parseLogoMatchOutput,
  parsePreviewOutput,
} from '#/media/decoder-output.ts'
import type { SessionImageOperations } from '#/agents/tools/image-tools.ts'

const DECODER_MAIN = fileURLToPath(
  new URL('../../../media-decoder/src/decoder-main.ts', import.meta.url),
)

/** Runs the decoder program as a plain child, without its container, and returns its stdout. */
async function decoderChild(header: object, bytes: Buffer) {
  const packet = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), bytes])
  const child = spawn(process.execPath, [DECODER_MAIN], { stdio: ['pipe', 'pipe', 'inherit'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stdin.end(packet)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) {
    throw new Error('decoder_child_failed')
  }
  return Buffer.concat(chunks)
}

/** The image tools' operations on the real decoder program and output parsers, run in-process. */
export function childImageOperations(calls: string[] = []): SessionImageOperations {
  return {
    grid: async (input) => {
      calls.push('grid')
      checkedGridInput(input)
      const { bytes, ...header } = input
      return parseGridOutput(await decoderChild(header, bytes))
    },
    preview: async (input) => {
      calls.push('preview')
      checkedPreviewInput(input)
      const { header, pages } = previewPacket(input)
      return parsePreviewOutput(await decoderChild(header, pages))
    },
    logo: async (input) => {
      calls.push('logo')
      checkedLogoMatchInput(input)
      const { bytes, ...header } = input
      return parseLogoMatchOutput(await decoderChild(header, bytes))
    },
  }
}
