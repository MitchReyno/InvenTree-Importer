import { createHash } from 'node:crypto'
import { strictJson } from '@invimport/contracts/json'
import {
  assertMediaOutputHeader,
  expectedRenditionSizes,
  MEDIA_DECODER_HEADER_MAX_BYTES,
  renditionDimensions,
  type MediaOutputPageDto,
  type MediaOutputRenditionDto,
} from '@invimport/contracts/media'
import {
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type DecodedMedia,
  type DecodedPage,
  type DecodedRendition,
  type RenderedPage,
} from './decoder-protocol.ts'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function decodedPage(page: MediaOutputPageDto, bytes: Buffer, expectedPage: number): DecodedPage {
  const pixelCount = page.width * page.height
  if (page.page !== expectedPage || pixelCount > MEDIA_LIMITS.pixels) {
    throw new Error('invalid_decoder_output')
  }
  if (bytes.length !== page.byte_size || bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new Error('invalid_decoder_output')
  }
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('invalid_decoder_output')
  }
  const pngDimensionsMatch =
    bytes.readUInt32BE(16) === page.width && bytes.readUInt32BE(20) === page.height
  if (!pngDimensionsMatch) {
    throw new Error('decoder_png_dimensions_mismatch')
  }
  if (createHash('sha256').update(bytes).digest('hex') !== page.digest) {
    throw new Error('decoder_output_digest_mismatch')
  }
  return { page: expectedPage, width: page.width, height: page.height, bytes }
}

/** Encoded dimensions of a simple-lossy, lossless or extended WebP, or null if it is not one. */
export function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  // Exact bytes: `ascii` decoding drops the high bit, so 0xD2 would read as `R`.
  const is = (start: number, text: string) =>
    bytes.subarray(start, start + 4).equals(Buffer.from(text))

  if (bytes.length < 30 || !is(0, 'RIFF') || !is(8, 'WEBP')) {
    return null
  }
  if (is(12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (is(12, 'VP8L') && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (is(12, 'VP8X')) {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
  }
  return null
}

function decodedRendition(
  page: MediaOutputPageDto,
  item: MediaOutputRenditionDto,
  bytes: Buffer,
): DecodedRendition {
  const expected = renditionDimensions(page.width, page.height, item.size)
  const encoded = webpDimensions(bytes)
  if (
    !expected ||
    expected.width !== item.width ||
    expected.height !== item.height ||
    bytes.length !== item.byte_size ||
    bytes.length > MEDIA_LIMITS.outputBytes ||
    encoded?.width !== item.width ||
    encoded.height !== item.height
  ) {
    throw new Error('invalid_decoder_rendition')
  }
  if (createHash('sha256').update(bytes).digest('hex') !== item.digest) {
    throw new Error('decoder_output_digest_mismatch')
  }
  return { size: item.size, width: item.width, height: item.height, bytes }
}

/** TypeBox owns structural validation; byte/hash/domain checks remain explicit. */
export function parseDecoderOutput(bytes: Buffer): DecodedMedia {
  const headerEnd = bytes.indexOf(10)
  if (headerEnd < 0 || headerEnd > MEDIA_DECODER_HEADER_MAX_BYTES) {
    throw new Error('invalid_decoder_header')
  }
  const header = strictJson(bytes.subarray(0, headerEnd).toString('utf8'))
  assertMediaOutputHeader(header)
  const payload = bytes.subarray(headerEnd + 1)
  if (header.state !== 'ready') {
    if (payload.length) {
      throw new Error('decoder_output_trailing_bytes')
    }
    return { state: header.state, toolchain: MEDIA_TOOLCHAIN, pages: [] }
  }
  if (payload.length > MEDIA_LIMITS.totalOutputBytes) {
    throw new Error('invalid_decoder_output')
  }
  let offset = 0
  let totalPixels = 0
  const pages: RenderedPage[] = []
  for (const [index, page] of header.pages.entries()) {
    const decoded = decodedPage(page, payload.subarray(offset, offset + page.byte_size), index + 1)
    offset += page.byte_size
    totalPixels += decoded.width * decoded.height
    if (totalPixels > MEDIA_LIMITS.totalPixels) {
      throw new Error('invalid_decoder_output')
    }
    // Exactly the sizes the page's dimensions call for, smallest first.
    const sizes = page.renditions.map((item) => item.size)
    if (sizes.join() !== expectedRenditionSizes(page.width, page.height).join()) {
      throw new Error('invalid_decoder_rendition')
    }
    const renditions = page.renditions.map((item) => {
      const bytes = payload.subarray(offset, offset + item.byte_size)
      offset += item.byte_size
      return decodedRendition(page, item, bytes)
    })
    pages.push({ ...decoded, renditions })
  }
  if (offset !== payload.length) {
    throw new Error('decoder_output_trailing_bytes')
  }
  return { state: 'ready', toolchain: MEDIA_TOOLCHAIN, pages }
}
