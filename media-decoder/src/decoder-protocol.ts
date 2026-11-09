import { createHash } from 'node:crypto'
import {
  assertMediaRecipe,
  MEDIA_PREVIEW_MAX_BYTES,
  MEDIA_SOURCE_MAX_BYTES,
  type MediaRecipeDto,
  type MediaRenditionSize,
} from '@invimport/contracts/media'

export const MEDIA_LIMITS = Object.freeze({
  sourceBytes: MEDIA_SOURCE_MAX_BYTES,
  pages: 30,
  // 50 MP phone photos decode in ~7 s at ~280 MiB; their lossless PNG previews reach ~25 MiB.
  pixels: 52_000_000,
  totalPixels: 104_000_000,
  outputBytes: MEDIA_PREVIEW_MAX_BYTES,
  totalOutputBytes: 96 * 1024 * 1024,
  wallMilliseconds: 30_000,
  memoryMiB: 1024,
  // libvips spills rotated full-size images to /tmp; a 50 MP photo needs ~150 MiB. Counts against memoryMiB.
  scratchMiB: 256,
})
export { MEDIA_TOOLCHAIN } from '@invimport/contracts/media'
export type DecodeFailure = 'unsupported' | 'encrypted' | 'malformed' | 'limit_exceeded'
export interface DecodeInput {
  version: 'media-decode/1'
  digest: string
  bytes: Buffer
  recipe?: MediaRecipeDto
}
export interface DecodedPage {
  page: number
  width: number
  height: number
  bytes: Buffer
}
export interface DecodedRendition {
  size: MediaRenditionSize
  width: number
  height: number
  bytes: Buffer
}
/** A ready page with its display renditions; the page bytes stay the full-resolution PNG. */
export interface RenderedPage extends DecodedPage {
  renditions: DecodedRendition[]
}
export type DecodedMedia =
  | { state: 'ready'; toolchain: string; pages: RenderedPage[] }
  | { state: DecodeFailure; toolchain: string; pages: [] }

/** One retained page PNG; bounded by the preview size, not the upload size. */
export interface RenditionInput {
  version: 'media-renditions/1'
  digest: string
  bytes: Buffer
  width: number
  height: number
}
export type RenditionResult =
  | { state: 'ready'; toolchain: string; renditions: DecodedRendition[] }
  | { state: 'malformed'; toolchain: string; renditions: [] }

export function checkedRenditionInput(input: RenditionInput) {
  if (
    input.version !== 'media-renditions/1' ||
    input.bytes.length === 0 ||
    input.bytes.length > MEDIA_PREVIEW_MAX_BYTES ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width * input.height > MEDIA_LIMITS.pixels ||
    createHash('sha256').update(input.bytes).digest('hex') !== input.digest
  ) {
    throw new Error('invalid_decode_input')
  }
}

export function checkedInput(input: DecodeInput) {
  if (
    input.version !== 'media-decode/1' ||
    input.bytes.length === 0 ||
    input.bytes.length > MEDIA_LIMITS.sourceBytes ||
    createHash('sha256').update(input.bytes).digest('hex') !== input.digest
  ) {
    throw new Error('invalid_decode_input')
  }
  if (input.recipe) {
    assertMediaRecipe(input.recipe)
    if (input.recipe.source_digest !== input.digest) {
      throw new Error('invalid_decode_recipe')
    }
  }
}
