import { createHash } from 'node:crypto'
import {
  assertMediaRecipe,
  MEDIA_SOURCE_MAX_BYTES,
  type MediaRecipeDto,
} from '@invimport/contracts/media'

export const MEDIA_LIMITS = Object.freeze({
  sourceBytes: MEDIA_SOURCE_MAX_BYTES,
  pages: 30,
  pixels: 24_000_000,
  totalPixels: 48_000_000,
  outputBytes: 20 * 1024 * 1024,
  totalOutputBytes: 32 * 1024 * 1024,
  wallMilliseconds: 30_000,
  memoryMiB: 512,
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
export type DecodedMedia =
  | { state: 'ready'; toolchain: string; pages: DecodedPage[] }
  | { state: DecodeFailure; toolchain: string; pages: [] }

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
