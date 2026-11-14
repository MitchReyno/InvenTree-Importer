import { createHash } from 'node:crypto'
import { assertMediaDecoderInputHeader } from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { decode, renderRetained } from './decode.ts'
import { MEDIA_LIMITS } from './decoder-protocol.ts'

const MAX_HEADER_BYTES = 8192

/** Container-only bounded header plus raw bytes. No credentials, paths or HTTP clients. */
let length = 0
const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  const bytes = Buffer.from(chunk)
  length += bytes.length
  // The larger bound admits a retained page PNG; each version's own check then applies.
  if (length > Math.max(MEDIA_LIMITS.sourceBytes, MEDIA_LIMITS.outputBytes) + MAX_HEADER_BYTES) {
    throw new Error('decoder_input_limit')
  }
  chunks.push(bytes)
}
const protocol = Buffer.concat(chunks)
const headerEnd = protocol.indexOf(10)
if (headerEnd < 0 || headerEnd > MAX_HEADER_BYTES) {
  throw new Error('invalid_decoder_header')
}
const value = strictJson(protocol.subarray(0, headerEnd).toString('utf8'))
assertMediaDecoderInputHeader(value)

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const sizedHeader = (item: { size: string; width: number; height: number; bytes: Buffer }) => ({
  size: item.size,
  width: item.width,
  height: item.height,
  byte_size: item.bytes.length,
  digest: digest(item.bytes),
})

if (value.version === 'media-renditions/1') {
  const rendered = await renderRetained({
    version: value.version,
    digest: value.digest,
    width: value.width,
    height: value.height,
    bytes: protocol.subarray(headerEnd + 1),
  })
  process.stdout.write(
    JSON.stringify({
      state: rendered.state,
      toolchain: rendered.toolchain,
      renditions: rendered.renditions.map(sizedHeader),
    }) + '\n',
  )
  for (const item of rendered.renditions) {
    process.stdout.write(item.bytes)
  }
} else {
  const result = await decode({
    version: value.version,
    digest: value.digest,
    bytes: protocol.subarray(headerEnd + 1),
    recipe: value.recipe ?? undefined,
  })

  const resultHeader = JSON.stringify({
    state: result.state,
    toolchain: result.toolchain,
    pages: result.pages.map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      byte_size: page.bytes.length,
      digest: digest(page.bytes),
      renditions: page.renditions.map(sizedHeader),
    })),
  })
  process.stdout.write(resultHeader + '\n')
  // Each page's bytes are followed by its renditions, in header order.
  for (const page of result.pages) {
    process.stdout.write(page.bytes)
    for (const item of page.renditions) {
      process.stdout.write(item.bytes)
    }
  }
}
