import { createHash } from 'node:crypto'
import {
  assertMediaDecoderInputHeader,
  assertMediaLitViewRecipe,
  assertMediaRecipe,
  MEDIA_PREVIEW_MAX_BYTES,
  MEDIA_SOURCE_MAX_BYTES,
  type MediaGridOutputHeaderDto,
  type MediaLitViewRecipeDto,
  type MediaLogoMatchOutputHeaderDto,
  type MediaPreviewOutputHeaderDto,
  type MediaRecipeDto,
  type MediaRenditionSize,
  type MediaViewGeometryDto,
  type MediaViewMarkDto,
  type MediaViewRecipeDto,
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
  recipe?: MediaRecipeDto | MediaLitViewRecipeDto
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

/** A retained page PNG the server sends: within the preview size, its digest and pixel limit. */
export interface RetainedPageBytes {
  digest: string
  bytes: Buffer
  width: number
  height: number
}

function checkedPageBytes(page: RetainedPageBytes) {
  if (
    page.bytes.length === 0 ||
    page.bytes.length > MEDIA_PREVIEW_MAX_BYTES ||
    !Number.isInteger(page.width) ||
    !Number.isInteger(page.height) ||
    page.width < 1 ||
    page.height < 1 ||
    page.width * page.height > MEDIA_LIMITS.pixels ||
    createHash('sha256').update(page.bytes).digest('hex') !== page.digest
  ) {
    throw new Error('invalid_decode_input')
  }
}

export function checkedRenditionInput(input: RenditionInput) {
  if (input.version !== 'media-renditions/1') {
    throw new Error('invalid_decode_input')
  }
  checkedPageBytes(input)
}

/**
 * One retained page PNG and a view of it. Marks are sent only for an agent's preview; `null`
 * renders no preview, and an empty list renders an unmarked one.
 */
export interface ViewInput {
  version: 'media-view/1'
  digest: string
  bytes: Buffer
  width: number
  height: number
  recipe: MediaViewRecipeDto
  marks: MediaViewMarkDto[] | null
}

export interface ViewImage {
  width: number
  height: number
  bytes: Buffer
}

/** The operator's WebP view and thumbnail, and the marked PNG preview when marks were sent. */
export type ViewResult =
  | {
      state: 'ready'
      toolchain: string
      view: ViewImage
      thumb: ViewImage
      preview: ViewImage | null
    }
  | { state: 'malformed'; toolchain: string }

/** Refuses input the server should never send; a page that doesn't fit the recipe is `malformed`. */
export function checkedViewInput(input: ViewInput) {
  if (input.version !== 'media-view/1') {
    throw new Error('invalid_decode_input')
  }
  checkedPageBytes(input)
  // The recipe and marks have the header's shape; it throws `invalid_decoder_input` otherwise.
  assertMediaDecoderInputHeader({
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
    recipe: input.recipe,
    marks: input.marks,
  })
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
    if (input.recipe.version === 'bench-intake-view/2') {
      assertMediaLitViewRecipe(input.recipe)
    } else {
      assertMediaRecipe(input.recipe)
    }
    if (input.recipe.source_digest !== input.digest) {
      throw new Error('invalid_decode_recipe')
    }
  }
}

/** A page a preview renders from, with the bytes the header's `byte_size` describes. */
export type PreviewPage = RetainedPageBytes

export interface PreviewCrop {
  label: string
  /** Index into the preview's pages. */
  page: number
  recipe: MediaLitViewRecipeDto
}

export interface PreviewInput {
  version: 'media-preview/1'
  pages: PreviewPage[]
  crops: PreviewCrop[]
}

type FailedOperation = { state: 'malformed' | 'limit_exceeded'; toolchain: string }
type ReadyPreviewHeader = Extract<MediaPreviewOutputHeaderDto, { state: 'ready' }>
export type PreviewCropOutcome = ReadyPreviewHeader['crops'][number]

/** The labelled montage PNG and what happened to each crop, in request order. */
export type PreviewResult =
  | { state: 'ready'; toolchain: string; montage: ViewImage; crops: PreviewCropOutcome[] }
  | FailedOperation

export function checkedPreviewInput(input: PreviewInput) {
  if (input.version !== 'media-preview/1') {
    throw new Error('invalid_decode_input')
  }
  let total = 0
  for (const page of input.pages) {
    checkedPageBytes(page)
    total += page.bytes.length
  }
  if (total > MEDIA_LIMITS.outputBytes) {
    throw new Error('invalid_decode_input')
  }
  assertMediaDecoderInputHeader({
    version: input.version,
    pages: input.pages.map((page) => ({
      digest: page.digest,
      width: page.width,
      height: page.height,
      byte_size: page.bytes.length,
    })),
    crops: input.crops,
  })
}

interface PageRegion {
  x: number
  y: number
  width: number
  height: number
}

/** `inspect_region` on one retained page PNG; see the `media-grid/1` header. */
export interface GridInput extends RetainedPageBytes {
  version: 'media-grid/1'
  region: PageRegion | null
  preview_width: number
  step: number | null
  object: PageRegion | null
  boxes: { name: string; box: PageRegion }[]
}

type ReadyGridHeader = Extract<MediaGridOutputHeaderDto, { state: 'ready' }>

export type GridResult = (Omit<ReadyGridHeader, 'image'> & { image: ViewImage }) | FailedOperation

export function checkedGridInput(input: GridInput) {
  if (input.version !== 'media-grid/1') {
    throw new Error('invalid_decode_input')
  }
  checkedPageBytes(input)
  assertMediaDecoderInputHeader({
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
    region: input.region,
    preview_width: input.preview_width,
    step: input.step,
    object: input.object,
    boxes: input.boxes,
  })
}

/** `match_logo` on a view of one retained page PNG. */
export interface LogoMatchInput extends RetainedPageBytes {
  version: 'media-logo-match/1'
  view: MediaViewGeometryDto
  top: number
}

type ReadyLogoMatchHeader = Extract<MediaLogoMatchOutputHeaderDto, { state: 'ready' }>

export type LogoMatchResult =
  (Omit<ReadyLogoMatchHeader, 'sheet'> & { sheet: ViewImage }) | FailedOperation

export function checkedLogoMatchInput(input: LogoMatchInput) {
  if (input.version !== 'media-logo-match/1') {
    throw new Error('invalid_decode_input')
  }
  checkedPageBytes(input)
  assertMediaDecoderInputHeader({
    version: input.version,
    digest: input.digest,
    width: input.width,
    height: input.height,
    view: input.view,
    top: input.top,
  })
}
