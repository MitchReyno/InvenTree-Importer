import sharp from 'sharp'
import { viewLayout, type ViewLayout } from '@invimport/contracts/media'
import { pngHeaderMatches } from './decode.ts'
import {
  checkedViewInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type ViewImage,
  type ViewInput,
  type ViewResult,
} from './decoder-protocol.ts'
import { renderLitCrop } from './lit-crop.ts'
import { drawMarks } from './view-marks.ts'
import { viewPixels, type RawRgb } from './view-pixels.ts'

export { MARK_FONT_FAMILY, markFont } from './view-marks.ts'

const VIEW_WEBP = { quality: 80, effort: 4 } as const

class ViewMismatchError extends Error {}

function sized(bytes: Buffer, width: number, height: number): ViewImage {
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new Error('view_output_limit')
  }
  return { width, height, bytes }
}

/**
 * The view's pixels. A lit recipe `/2` is lit at full resolution, exactly as its derived crop is,
 * and then sized to the view; null when its white balance is refused.
 */
async function recipePixels(input: ViewInput, layout: ViewLayout): Promise<RawRgb | null> {
  const { recipe } = input
  if (recipe.version === 'bench-intake-view/1') {
    return viewPixels(input, recipe.view.quarter_turns, layout)
  }
  const lit = await renderLitCrop(input, recipe)
  if (lit.state === 'refused') {
    return null
  }
  const { data, info } = await sharp(lit.image.data, { raw: lit.image.info })
    .resize({ width: layout.width, height: layout.height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, info: { width: info.width, height: info.height, channels: 3 } }
}

/** The layout, or a mismatch when the page bytes, their size and the recipe disagree. */
async function checkedLayout(input: ViewInput): Promise<ViewLayout> {
  const { recipe } = input
  if (
    !pngHeaderMatches(input.bytes, input.width, input.height) ||
    recipe.page_width !== input.width ||
    recipe.page_height !== input.height
  ) {
    throw new ViewMismatchError('view_page_mismatch')
  }
  let layout: ViewLayout
  try {
    layout = viewLayout(recipe)
  } catch {
    throw new ViewMismatchError('view_region_outside_page')
  }
  // Any library failure from here is not a claim about the bytes, so it propagates.
  const metadata = await sharp(input.bytes, { limitInputPixels: MEDIA_LIMITS.pixels }).metadata()
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) {
    throw new ViewMismatchError('view_page_not_png')
  }
  return layout
}

/**
 * Renders one view of a retained page: the operator's WebP view and thumbnail, and a PNG preview
 * with the marks drawn in when marks are given. The view itself never carries marks.
 */
export async function renderView(input: ViewInput): Promise<ViewResult> {
  checkedViewInput(input)
  let layout: ViewLayout
  try {
    layout = await checkedLayout(input)
  } catch (error) {
    if (error instanceof ViewMismatchError) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }
    }
    throw error
  }

  const pixels = await recipePixels(input, layout)
  if (!pixels) {
    return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }
  }
  const view = await sharp(pixels.data, { raw: pixels.info }).webp(VIEW_WEBP).toBuffer()
  const thumb = await sharp(pixels.data, { raw: pixels.info })
    .resize({ width: layout.thumbWidth, height: layout.thumbHeight, fit: 'fill' })
    .webp(VIEW_WEBP)
    .toBuffer()
  let preview: ViewImage | null = null
  if (input.marks) {
    const rgba = await sharp(pixels.data, { raw: pixels.info }).ensureAlpha().raw().toBuffer()
    const bytes = await drawMarks(rgba, layout, input.marks)
    preview = sized(bytes, layout.width, layout.height)
  }
  return {
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    view: sized(view, layout.width, layout.height),
    thumb: sized(thumb, layout.thumbWidth, layout.thumbHeight),
    preview,
  }
}
