import { createHash } from 'node:crypto'
import { strictJson } from '@invimport/contracts/json'
import { assertMediaOutputHeader, type MediaOutputPageDto } from '@invimport/contracts/media'
import {
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type DecodedMedia,
  type DecodedPage,
} from './decoder-protocol.ts'

const MAX_HEADER_BYTES = 8192
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

/** TypeBox owns structural validation; byte/hash/domain checks remain explicit. */
export function parseDecoderOutput(bytes: Buffer): DecodedMedia {
  const headerEnd = bytes.indexOf(10)
  if (headerEnd < 0 || headerEnd > MAX_HEADER_BYTES) {
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
  const pages: DecodedPage[] = []
  for (const [index, page] of header.pages.entries()) {
    const decoded = decodedPage(page, payload.subarray(offset, offset + page.byte_size), index + 1)
    offset += page.byte_size
    totalPixels += decoded.width * decoded.height
    if (totalPixels > MEDIA_LIMITS.totalPixels) {
      throw new Error('invalid_decoder_output')
    }
    pages.push(decoded)
  }
  if (offset !== payload.length) {
    throw new Error('decoder_output_trailing_bytes')
  }
  return { state: 'ready', toolchain: MEDIA_TOOLCHAIN, pages }
}
