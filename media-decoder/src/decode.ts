import { decodeRotatedRegion, RotatedRegionLimitError } from './rotated-region.ts'
import {
  expectedRenditionSizes,
  renditionDimensions,
  requireMediaRecipeBounds,
} from '@invimport/contracts/media'
import sharp from 'sharp'
import { createCanvas } from '@napi-rs/canvas'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
  // A mismatch is identified from the bytes themselves: the PNG signature and IHDR dimensions.
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (
    input.bytes.length < 24 ||
    !input.bytes.subarray(0, 8).equals(signature) ||
    !input.bytes.subarray(12, 16).equals(Buffer.from('IHDR')) ||
    input.bytes.readUInt32BE(16) !== input.width ||
    input.bytes.readUInt32BE(20) !== input.height
  ) {
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

/** Called only inside the bounded decoder image; never from an HTTP route. */
export async function decode(input: DecodeInput): Promise<DecodedMedia> {
  checkedInput(input)
  try {
    const isPdf = input.bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    const jpegSignature = input.bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    const pngSignature = input.bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (!isPdf && !jpegSignature && !pngSignature) {
      throw new UnsupportedMediaError('unsupported_source_type')
    }
    if (jpegSignature && !input.bytes.subarray(-2).equals(Buffer.from([255, 217]))) {
      throw new MalformedMediaError('truncated_jpeg')
    }
    let pages = isPdf ? await pdfPages(input.bytes) : [await raster(input.bytes)]
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
