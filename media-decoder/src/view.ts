import sharp from 'sharp'
import { regionTrigonometry, viewLayout, type ViewLayout } from '@invimport/contracts/media'
import { pngHeaderMatches } from './decode.ts'
import {
  checkedViewInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type ViewImage,
  type ViewInput,
  type ViewResult,
} from './decoder-protocol.ts'
import { sampleRotatedWindow, type RotatedWindow } from './rotated-region.ts'
import { drawMarks } from './view-marks.ts'

export { MARK_FONT_FAMILY, markFont } from './view-marks.ts'

/**
 * Page pixels kept around the sampling window, then repeated past the page's edge. Bicubic
 * sampling reads two pixels out, so a window touching the edge never blends in the background.
 */
const WINDOW_MARGIN_PX = 4

const VIEW_WEBP = { quality: 80, effort: 4 } as const

class ViewMismatchError extends Error {}

/** The window turns against the straightening, so its content turns by the angle. */
function samplingWindow(layout: ViewLayout): RotatedWindow {
  const { cosine, sine } = regionTrigonometry(-layout.straightenMillidegrees)
  return {
    centerX: layout.centerX,
    centerY: layout.centerY,
    width: layout.windowWidth,
    height: layout.windowHeight,
    cosine,
    sine,
  }
}

/** The page's pixels around the window, edges repeated outward, with the window moved to match. */
async function windowNeighbourhood(
  page: Buffer,
  size: { width: number; height: number },
  window: RotatedWindow,
) {
  const halfX = (Math.abs(window.cosine) * window.width + Math.abs(window.sine) * window.height) / 2
  const halfY = (Math.abs(window.sine) * window.width + Math.abs(window.cosine) * window.height) / 2
  const left = Math.max(0, Math.floor(window.centerX - halfX) - WINDOW_MARGIN_PX)
  const top = Math.max(0, Math.floor(window.centerY - halfY) - WINDOW_MARGIN_PX)
  const right = Math.min(size.width, Math.ceil(window.centerX + halfX) + WINDOW_MARGIN_PX)
  const bottom = Math.min(size.height, Math.ceil(window.centerY + halfY) + WINDOW_MARGIN_PX)
  const cut = await sharp(page, { limitInputPixels: MEDIA_LIMITS.pixels })
    .flatten({ background: '#ffffff' })
    .extract({ left, top, width: right - left, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const padded = await sharp(cut.data, { raw: cut.info })
    .extend({
      top: WINDOW_MARGIN_PX,
      bottom: WINDOW_MARGIN_PX,
      left: WINDOW_MARGIN_PX,
      right: WINDOW_MARGIN_PX,
      extendWith: 'copy',
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    source: {
      input: padded.data,
      raw: { width: padded.info.width, height: padded.info.height, channels: padded.info.channels },
      width: padded.info.width,
      height: padded.info.height,
    },
    window: {
      ...window,
      centerX: window.centerX - left + WINDOW_MARGIN_PX,
      centerY: window.centerY - top + WINDOW_MARGIN_PX,
    },
  }
}

/**
 * The view's pixels: the straightened window cut at page resolution, turned by quarter turns and
 * resized once to the layout's size, so a large region is filtered rather than aliased.
 */
async function viewPixels(input: ViewInput, layout: ViewLayout) {
  const neighbourhood = await windowNeighbourhood(input.bytes, input, samplingWindow(layout))
  const cut = await sampleRotatedWindow(neighbourhood.source, neighbourhood.window, {
    width: Math.max(1, Math.round(layout.windowWidth)),
    height: Math.max(1, Math.round(layout.windowHeight)),
  })
  const turned = await sharp(cut.data, { raw: cut.info })
    .rotate(input.recipe.view.quarter_turns * 90)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return sharp(turned.data, { raw: turned.info })
    .resize({ width: layout.width, height: layout.height, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
}

function sized(bytes: Buffer, width: number, height: number): ViewImage {
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new Error('view_output_limit')
  }
  return { width, height, bytes }
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

  const pixels = await viewPixels(input, layout)
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
