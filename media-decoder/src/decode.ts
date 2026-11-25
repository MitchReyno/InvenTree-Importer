import { decodeRotatedRegion, RotatedRegionLimitError } from './rotated-region.ts'
import {
  expectedRenditionSizes,
  renditionDimensions,
  requireMediaRecipeBounds,
  viewLayout,
  type MediaLitViewRecipeDto,
} from '@invimport/contracts/media'
import { renderLitCrop } from './lit-crop.ts'
import sharp from 'sharp'
import { createCanvas } from '@napi-rs/canvas'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'
import {
  checkedInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type DecodeInput,
  type DecodedMedia,
  type DecodedPage,
  type DecodedRendition,
  type RenderedPage,
  type RenditionInput,
  type RenditionResult,
  checkedRenditionInput,
} from './decoder-protocol.ts'

sharp.cache(false)
sharp.concurrency(1)

export class LimitError extends Error {}

class UnsupportedMediaError extends Error {}

class MalformedMediaError extends Error {}

function dimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MEDIA_LIMITS.pixels
  ) {
    throw new LimitError('pixel_limit')
  }
}

/** sharp enforces `limitInputPixels` before our own check can run; report it as a limit, not a crash. */
function sharpLimit(error: unknown): never {
  if (error instanceof Error && error.message.includes('exceeds pixel limit')) {
    throw new LimitError('pixel_limit')
  }
  throw error
}

async function raster(bytes: Buffer): Promise<DecodedPage> {
  const image = sharp(bytes, { limitInputPixels: MEDIA_LIMITS.pixels, failOn: 'warning', pages: 1 })
  const metadata = await image.metadata().catch(sharpLimit)
  if (!['jpeg', 'png'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
    throw new UnsupportedMediaError('unsupported_image')
  }
  const { data, info } = await image
    .autoOrient()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer({ resolveWithObject: true })
    .catch(sharpLimit)
  dimensions(info.width, info.height)
  if (data.length > MEDIA_LIMITS.outputBytes) {
    throw new LimitError('output_limit')
  }
  return { page: 1, width: info.width, height: info.height, bytes: data }
}

async function pdfPages(bytes: Buffer): Promise<DecodedPage[]> {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const loading = pdf.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    useWorkerFetch: false,
    cMapUrl: join(root, 'cmaps') + '/',
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    wasmUrl: join(root, 'wasm') + '/',
    // PDF.js can silently skip images above maxImageSize. Let the container's
    // hard memory boundary stop an oversized decode rather than return blank success.
    maxImageSize: -1,
    verbosity: 0,
  })
  try {
    const document = await loading.promise
    if (document.numPages < 1 || document.numPages > MEDIA_LIMITS.pages) {
      throw new LimitError('page_limit')
    }
    const pages: DecodedPage[] = []
    let totalPixels = 0
    let totalBytes = 0
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      const viewport = page.getViewport({ scale: 1 })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)
      dimensions(width, height)
      totalPixels += width * height
      if (totalPixels > MEDIA_LIMITS.totalPixels) {
        throw new LimitError('total_pixel_limit')
      }
      const canvas = createCanvas(width, height)
      try {
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise
        const rendered = await raster(canvas.toBuffer('image/png'))
        totalBytes += rendered.bytes.length
        if (totalBytes > MEDIA_LIMITS.totalOutputBytes) {
          throw new LimitError('total_output_limit')
        }
        pages.push({ ...rendered, page: index })
      } finally {
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
    }
    return pages
  } finally {
    await loading.destroy()
  }
}

/**
 * Display renditions of a decoded page. Resizing to the shared function's exact dimensions keeps
 * the bytes identical to what clients predict; `fit: 'inside'` can shrink the long edge again.
 */
export async function renditions(page: DecodedPage): Promise<DecodedRendition[]> {
  const output: DecodedRendition[] = []
  for (const size of expectedRenditionSizes(page.width, page.height)) {
    const target = renditionDimensions(page.width, page.height, size)!
    const bytes = await sharp(page.bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
      .resize({ width: target.width, height: target.height, fit: 'fill' })
      .webp({ quality: 80, effort: 4 })
      .toBuffer()
    if (bytes.length > MEDIA_LIMITS.outputBytes) {
      throw new LimitError('output_limit')
    }
    output.push({ size, ...target, bytes })
  }
  return output
}

/** Pages and renditions share the total output budget; only that identified limit fails here. */
export async function rendered(
  pages: DecodedPage[],
  budget: number = MEDIA_LIMITS.totalOutputBytes,
): Promise<RenderedPage[]> {
  let total = 0
  const output: RenderedPage[] = []
  for (const page of pages) {
    const sized = await renditions(page)
    total += page.bytes.length + sized.reduce((sum, item) => sum + item.bytes.length, 0)
    if (total > budget) {
      throw new LimitError('total_output_limit')
    }
    output.push({ ...page, renditions: sized })
  }
  return output
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Whether the bytes start as a PNG of exactly these dimensions, read from the signature and IHDR. */
export function pngHeaderMatches(bytes: Buffer, width: number, height: number) {
  return (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.subarray(12, 16).equals(Buffer.from('IHDR')) &&
    bytes.readUInt32BE(16) === width &&
    bytes.readUInt32BE(20) === height
  )
}

/** Bit depths each IHDR colour type allows. */
const PNG_BIT_DEPTHS = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
])
const PNG_CHUNK_NAME = /^[A-Za-z]{4}$/
const PNG_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])

/** Whether an IHDR's 13 bytes name a valid colour type, bit depth and methods. */
function pngHeaderValid(data: Buffer) {
  const depths = PNG_BIT_DEPTHS.get(data[9])
  return (
    data.length === 13 &&
    depths !== undefined &&
    depths.includes(data[8]) &&
    data[10] === 0 &&
    data[11] === 0 &&
    data[12] <= 1
  )
}

/** Whether a PLTE fits its header: 1-256 RGB entries, none for greyscale, within an indexed depth. */
function pngPaletteValid(data: Buffer, header: Buffer) {
  const [bitDepth, colourType] = [header[8], header[9]]
  const entries = data.length / 3
  const entriesValid = Number.isInteger(entries) && entries >= 1 && entries <= 256
  const indexedFits = colourType !== 3 || entries <= 2 ** bitDepth
  return entriesValid && colourType !== 0 && colourType !== 4 && indexedFits
}

/**
 * Whether a PNG's critical chunks are whole and in order: four-letter chunk names, each length
 * fitting and its CRC matching; a valid 13-byte IHDR first; at most one PLTE, valid for the header
 * and before the data, and required for indexed colour; one run of IDAT; no other critical chunk;
 * and an empty IEND ending the bytes. Ancillary chunks' placement and the compressed stream aren't
 * checked: a damaged stream with intact CRCs fails later as a library error.
 */
export function pngChunksIntact(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false
  }
  let header: Buffer | null = null
  let palette = false
  let data: 'before' | 'open' | 'closed' = 'before'
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) {
      return false
    }
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length)
    if (zlib.crc32(typeAndData) !== bytes.readUInt32BE(offset + 8 + length)) {
      return false
    }
    const type = typeAndData.subarray(0, 4).toString('latin1')
    const chunk = typeAndData.subarray(4)
    if (!PNG_CHUNK_NAME.test(type)) {
      return false
    }
    if (header === null) {
      if (type !== 'IHDR' || !pngHeaderValid(chunk)) {
        return false
      }
      header = chunk
    } else if (type === 'IEND') {
      const paletteSatisfied = palette || header[9] !== 3
      return length === 0 && end === bytes.length && data !== 'before' && paletteSatisfied
    } else if (type === 'IDAT') {
      if (data === 'closed') {
        return false
      }
      data = 'open'
    } else {
      if (data === 'open') {
        data = 'closed'
      }
      const critical = type[0] === type[0].toUpperCase()
      if (critical && !PNG_CRITICAL_CHUNKS.has(type)) {
        return false
      }
      if (type === 'IHDR') {
        return false
      }
      if (type === 'PLTE') {
        if (palette || data !== 'before' || !pngPaletteValid(chunk, header)) {
          return false
        }
        palette = true
      }
    }
    offset = end
  }
  return false
}

/**
 * Renditions of a retained page PNG for the backfill. Only bytes that are a single PNG of exactly
 * the recorded dimensions are rendered; anything else is `malformed`, a positive mismatch.
 */
export async function renderRetained(
  input: RenditionInput,
  inspect: (bytes: Buffer) => Promise<{ format?: string; pages?: number }> = (bytes) =>
    sharp(bytes, { limitInputPixels: MEDIA_LIMITS.pixels }).metadata(),
): Promise<RenditionResult> {
  checkedRenditionInput(input)
  const malformed: RenditionResult = {
    state: 'malformed',
    toolchain: MEDIA_TOOLCHAIN,
    renditions: [],
  }
  if (!pngHeaderMatches(input.bytes, input.width, input.height)) {
    return malformed
  }
  // Any library failure from here is not a claim about the bytes, so it propagates as interrupted.
  const metadata = await inspect(input.bytes)
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) {
    return malformed
  }
  const page = { page: 1, width: input.width, height: input.height, bytes: input.bytes }
  return { state: 'ready', toolchain: MEDIA_TOOLCHAIN, renditions: await renditions(page) }
}

/**
 * A recipe `/2` crop of a decoded page as a lossless PNG at full resolution. A recipe that doesn't
 * fit the page, or whose white balance the hue guard refuses, is `malformed`.
 */
async function deriveLitCrop(
  source: DecodedPage,
  recipe: MediaLitViewRecipeDto,
): Promise<DecodedPage> {
  try {
    viewLayout(recipe, 'full')
  } catch {
    throw new MalformedMediaError('view_region_outside_page')
  }
  const crop = await renderLitCrop(source, recipe)
  if (crop.state === 'refused') {
    throw new MalformedMediaError(crop.reason)
  }
  const { width, height } = crop.image.info
  const bytes = await sharp(crop.image.data, { raw: crop.image.info })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new LimitError('output_limit')
  }
  return { page: 1, width, height, bytes }
}

/** Called only inside the bounded decoder image; never from an HTTP route. */
export async function decode(input: DecodeInput): Promise<DecodedMedia> {
  checkedInput(input)
  try {
    const isPdf = input.bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    const jpegSignature = input.bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    const pngSignature = input.bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    if (!isPdf && !jpegSignature && !pngSignature) {
      throw new UnsupportedMediaError('unsupported_source_type')
    }
    if (jpegSignature && !input.bytes.subarray(-2).equals(Buffer.from([255, 217]))) {
      throw new MalformedMediaError('truncated_jpeg')
    }
    let pages = isPdf ? await pdfPages(input.bytes) : [await raster(input.bytes)]
    if (input.recipe?.version === 'bench-intake-view/2') {
      const recipe = input.recipe
      const source = pages.find((page) => page.page === recipe.page)
      if (!source || source.width !== recipe.page_width || source.height !== recipe.page_height) {
        throw new MalformedMediaError('lit_recipe_page_mismatch')
      }
      return {
        state: 'ready',
        toolchain: MEDIA_TOOLCHAIN,
        pages: await rendered([await deriveLitCrop(source, recipe)]),
      }
    }
    if (input.recipe) {
      const recipe = input.recipe
      const source = pages.find((page) => page.page === recipe.page)
      if (
        !source ||
        source.width !== recipe.source_width ||
        source.height !== recipe.source_height
      ) {
        throw new Error('invalid_recipe_coordinates')
      }
      requireMediaRecipeBounds(recipe)
      if (recipe.version === 'documentary-rotated-region/1') {
        return {
          state: 'ready',
          toolchain: MEDIA_TOOLCHAIN,
          pages: await rendered([await decodeRotatedRegion(source, recipe)]),
        }
      }
      const { data, info } = await sharp(source.bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
        .extract({ left: recipe.x, top: recipe.y, width: recipe.width, height: recipe.height })
        .rotate(recipe.quarter_turns * 90)
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
        .toBuffer({ resolveWithObject: true })
      if (data.length > MEDIA_LIMITS.outputBytes) {
        throw new LimitError('output_limit')
      }
      pages = [{ page: 1, width: info.width, height: info.height, bytes: data }]
    }
    return { state: 'ready', toolchain: MEDIA_TOOLCHAIN, pages: await rendered(pages) }
  } catch (error) {
    if (error instanceof LimitError || error instanceof RotatedRegionLimitError) {
      return { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN, pages: [] }
    }
    if (error instanceof UnsupportedMediaError) {
      return { state: 'unsupported', toolchain: MEDIA_TOOLCHAIN, pages: [] }
    }
    if (error instanceof MalformedMediaError) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN, pages: [] }
    }
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (error instanceof pdf.PasswordException) {
      return { state: 'encrypted', toolchain: MEDIA_TOOLCHAIN, pages: [] }
    }
    if (error instanceof pdf.InvalidPDFException) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN, pages: [] }
    }
    // Unknown infrastructure/library failures are not claims about source validity.
    throw error
  }
}
