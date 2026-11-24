import sharp from 'sharp'
import { createCanvas, ImageData } from '@napi-rs/canvas'
import { viewLayout, type ViewLayout } from '@invimport/contracts/media'
import { pngHeaderMatches } from './decode.ts'
import {
  checkedPreviewInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type PreviewCrop,
  type PreviewCropOutcome,
  type PreviewInput,
  type PreviewPage,
  type PreviewResult,
} from './decoder-protocol.ts'
import { renderLitCrop } from './lit-crop.ts'
import { RotatedRegionLimitError } from './rotated-region.ts'
import { markFont } from './view-marks.ts'
import type { RawRgb } from './view-pixels.ts'

/**
 * montage.py's sheet: cells of 360 px in four columns, each crop scaled into its cell with a 4 px
 * inset and labelled with its name and size in a 22 px strip below.
 */
export const MONTAGE_GEOMETRY = Object.freeze({ cell: 360, columns: 4, labelHeight: 22, inset: 4 })
const LABEL_FONT_PX = 13

class PreviewMismatchError extends Error {}

class PreviewLimitError extends Error {}

/**
 * Two slots naming the same evidence page must hold the same page, so one recipe can't preview as
 * two different images.
 */
function checkConsistentPages(pages: PreviewPage[]) {
  const byPage = new Map<string, PreviewPage>()
  for (const page of pages) {
    const key = `${page.source_version_id}/${page.page}`
    const seen = byPage.get(key)
    const conflicts =
      seen !== undefined &&
      (seen.digest !== page.digest ||
        seen.source_digest !== page.source_digest ||
        seen.width !== page.width ||
        seen.height !== page.height)
    if (conflicts) {
      throw new PreviewMismatchError('preview_page_conflict')
    }
    byPage.set(key, page)
  }
}

/** Each crop's page and full-resolution layout, or a mismatch when a recipe doesn't fit its page. */
async function checkedLayouts(input: PreviewInput): Promise<ViewLayout[]> {
  checkConsistentPages(input.pages)
  const checkedPages = new Set<number>()
  const layouts: ViewLayout[] = []
  let totalPixels = 0
  for (const crop of input.crops) {
    const page = input.pages.at(crop.page)
    if (!page) {
      throw new PreviewMismatchError('preview_page_missing')
    }
    const { recipe } = crop
    const samePage =
      recipe.source_version_id === page.source_version_id &&
      recipe.source_digest === page.source_digest &&
      recipe.page === page.page &&
      recipe.page_width === page.width &&
      recipe.page_height === page.height
    if (!samePage) {
      throw new PreviewMismatchError('preview_page_mismatch')
    }
    if (!checkedPages.has(crop.page)) {
      await checkPagePng(page)
      checkedPages.add(crop.page)
    }
    let layout: ViewLayout
    try {
      layout = viewLayout(crop.recipe, 'full')
    } catch {
      throw new PreviewMismatchError('view_region_outside_page')
    }
    totalPixels += layout.width * layout.height
    layouts.push(layout)
  }
  if (totalPixels > MEDIA_LIMITS.totalPixels) {
    throw new PreviewLimitError('preview_pixel_limit')
  }
  return layouts
}

async function checkPagePng(page: PreviewPage) {
  if (!pngHeaderMatches(page.bytes, page.width, page.height)) {
    throw new PreviewMismatchError('preview_page_mismatch')
  }
  // Any library failure from here is not a claim about the bytes, so it propagates.
  const metadata = await sharp(page.bytes, { limitInputPixels: MEDIA_LIMITS.pixels }).metadata()
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) {
    throw new PreviewMismatchError('preview_page_not_png')
  }
}

interface MontageTile {
  label: string
  /** The crop scaled into its cell, as RGBA; null for a refused crop. */
  thumbnail: { data: Buffer; width: number; height: number } | null
}

async function thumbnail(image: RawRgb) {
  const side = MONTAGE_GEOMETRY.cell - 2 * MONTAGE_GEOMETRY.inset
  const { data, info } = await sharp(image.data, { raw: image.info })
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function renderCrop(page: PreviewPage, crop: PreviewCrop) {
  const rendered = await renderLitCrop(page, crop.recipe)
  if (rendered.state === 'refused') {
    const outcome: PreviewCropOutcome = {
      state: 'refused',
      label: crop.label,
      reason: rendered.reason,
    }
    return { outcome, tile: { label: `${crop.label}  refused`, thumbnail: null } }
  }
  const { width, height } = rendered.image.info
  const flags: ('corner_guard' | 'white_balance_held_back')[] = []
  if (rendered.cornerGuard) {
    flags.push('corner_guard')
  }
  if (rendered.whiteBalance?.heldBack) {
    flags.push('white_balance_held_back')
  }
  const outcome: PreviewCropOutcome = {
    state: 'rendered',
    label: crop.label,
    width,
    height,
    flags,
    white_balance_gains: rendered.whiteBalance?.gains ?? null,
  }
  const tile = {
    label: `${crop.label}  ${width}x${height}`,
    thumbnail: await thumbnail(rendered.image),
  }
  return { outcome, tile }
}

/** The labelled sheet: each tile in its cell on white, its label in the strip below. */
async function montage(tiles: MontageTile[]) {
  const { cell, columns, labelHeight, inset } = MONTAGE_GEOMETRY
  const rows = Math.ceil(tiles.length / columns)
  const canvas = createCanvas(columns * cell, rows * (cell + labelHeight))
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = `${LABEL_FONT_PX}px "${markFont()}"`
  context.textBaseline = 'top'
  context.fillStyle = '#000000'
  for (const [index, tile] of tiles.entries()) {
    const x = (index % columns) * cell
    const y = Math.floor(index / columns) * (cell + labelHeight)
    if (tile.thumbnail) {
      const { data, width, height } = tile.thumbnail
      context.putImageData(
        new ImageData(new Uint8ClampedArray(data), width, height),
        x + inset,
        y + inset,
      )
    }
    context.fillText(tile.label, x + inset, y + cell + 4, cell - 2 * inset)
  }
  const bytes = await canvas.encode('png')
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new PreviewLimitError('preview_output_limit')
  }
  return { width: canvas.width, height: canvas.height, bytes }
}

/**
 * `preview_images`: renders each lit recipe exactly as its derived crop would be, one at a time,
 * and lays them out on one labelled montage. A refused crop is reported and left blank.
 */
export async function renderPreview(input: PreviewInput): Promise<PreviewResult> {
  checkedPreviewInput(input)
  try {
    await checkedLayouts(input)
    const outcomes: PreviewCropOutcome[] = []
    const tiles: MontageTile[] = []
    for (const crop of input.crops) {
      const { outcome, tile } = await renderCrop(input.pages[crop.page], crop)
      outcomes.push(outcome)
      tiles.push(tile)
    }
    return {
      state: 'ready',
      toolchain: MEDIA_TOOLCHAIN,
      montage: await montage(tiles),
      crops: outcomes,
    }
  } catch (error) {
    if (error instanceof PreviewMismatchError) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }
    }
    if (error instanceof PreviewLimitError || error instanceof RotatedRegionLimitError) {
      return { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN }
    }
    throw error
  }
}
