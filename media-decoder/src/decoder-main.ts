import { createHash } from 'node:crypto'
import { assertMediaDecoderInputHeader } from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { decode, renderRetained } from './decode.ts'
import { MEDIA_LIMITS, type PreviewPage, type ViewImage } from './decoder-protocol.ts'
import { renderGrid } from './grid.ts'
import { matchLogo } from './logo-match.ts'
import { renderPreview } from './preview.ts'
import { renderView } from './view.ts'

const MAX_HEADER_BYTES = 8192

/**
 * The header as UTF-8, refused rather than repaired when its bytes aren't valid UTF-8. A byte
 * order mark is kept, so the strict parser refuses it as before.
 */
function headerText(bytes: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error('invalid_decoder_header')
  }
}

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
const value = strictJson(headerText(protocol.subarray(0, headerEnd)))
assertMediaDecoderInputHeader(value)

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const sizedHeader = (item: { size: string; width: number; height: number; bytes: Buffer }) => ({
  size: item.size,
  width: item.width,
  height: item.height,
  byte_size: item.bytes.length,
  digest: digest(item.bytes),
})

const imageHeader = (item: ViewImage) => ({
  width: item.width,
  height: item.height,
  byte_size: item.bytes.length,
  digest: digest(item.bytes),
})

/** Writes a one-image result: its header with the image described under `key`, then the image. */
function writeImageResult(
  result: { state: string; toolchain: string },
  key: string,
  image: ViewImage | undefined,
) {
  if (!image) {
    process.stdout.write(JSON.stringify(result) + '\n')
    return
  }
  process.stdout.write(JSON.stringify({ ...result, [key]: imageHeader(image) }) + '\n')
  process.stdout.write(image.bytes)
}

/** The page bytes after the header, split in order by each page's declared size. */
function previewPages(
  pages: (Omit<PreviewPage, 'bytes'> & { byte_size: number })[],
  bytes: Buffer,
): PreviewPage[] {
  const declared = pages.reduce((sum, page) => sum + page.byte_size, 0)
  if (declared !== bytes.length) {
    throw new Error('invalid_decoder_input')
  }
  let offset = 0
  return pages.map((page) => {
    const pageBytes = bytes.subarray(offset, offset + page.byte_size)
    offset += page.byte_size
    const { byte_size: _size, ...identity } = page
    return { ...identity, bytes: pageBytes }
  })
}

if (value.version === 'media-preview/1') {
  const rendered = await renderPreview({
    version: value.version,
    pages: previewPages(value.pages, protocol.subarray(headerEnd + 1)),
    crops: value.crops,
  })
  if (rendered.state === 'ready') {
    const { montage, ...header } = rendered
    writeImageResult(header, 'montage', montage)
  } else {
    writeImageResult(rendered, 'montage', undefined)
  }
} else if (value.version === 'media-grid/1') {
  const rendered = await renderGrid({ ...value, bytes: protocol.subarray(headerEnd + 1) })
  if (rendered.state === 'ready') {
    const { image, ...header } = rendered
    writeImageResult(header, 'image', image)
  } else {
    writeImageResult(rendered, 'image', undefined)
  }
} else if (value.version === 'media-logo-match/1') {
  const matched = await matchLogo({ ...value, bytes: protocol.subarray(headerEnd + 1) })
  if (matched.state === 'ready') {
    const { sheet, ...header } = matched
    writeImageResult(header, 'sheet', sheet)
  } else {
    writeImageResult(matched, 'sheet', undefined)
  }
} else if (value.version === 'media-view/1') {
  const rendered = await renderView({
    version: value.version,
    digest: value.digest,
    width: value.width,
    height: value.height,
    bytes: protocol.subarray(headerEnd + 1),
    recipe: value.recipe,
    marks: value.marks,
  })
  if (rendered.state === 'ready') {
    const resultHeader = JSON.stringify({
      state: rendered.state,
      toolchain: rendered.toolchain,
      view: imageHeader(rendered.view),
      thumb: imageHeader(rendered.thumb),
      preview: rendered.preview ? imageHeader(rendered.preview) : null,
    })
    process.stdout.write(resultHeader + '\n')
    // The view, then the thumbnail, then the preview when there is one.
    process.stdout.write(rendered.view.bytes)
    process.stdout.write(rendered.thumb.bytes)
    if (rendered.preview) {
      process.stdout.write(rendered.preview.bytes)
    }
  } else {
    process.stdout.write(JSON.stringify(rendered) + '\n')
  }
} else if (value.version === 'media-renditions/1') {
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
