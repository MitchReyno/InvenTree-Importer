import sharp from 'sharp'
import { regionTrigonometry, type ViewLayout } from '@invimport/contracts/media'
import { MEDIA_LIMITS } from './decoder-protocol.ts'
import { sampleRotatedWindow, type RotatedWindow } from './rotated-region.ts'

/**
 * Page pixels kept around the sampling window, then repeated past the page's edge. Bicubic
 * sampling reads two pixels out, so a window touching the edge never blends in the background.
 */
const WINDOW_MARGIN_PX = 4

/** 8-bit RGB pixels, row by row. */
export interface RawRgb {
  data: Buffer
  info: { width: number; height: number; channels: 3 }
}

/** One page PNG to cut views from. */
export interface PagePng {
  bytes: Buffer
  width: number
  height: number
}

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
async function windowNeighbourhood(page: PagePng, window: RotatedWindow) {
  const halfX = (Math.abs(window.cosine) * window.width + Math.abs(window.sine) * window.height) / 2
  const halfY = (Math.abs(window.sine) * window.width + Math.abs(window.cosine) * window.height) / 2
  const left = Math.max(0, Math.floor(window.centerX - halfX) - WINDOW_MARGIN_PX)
  const top = Math.max(0, Math.floor(window.centerY - halfY) - WINDOW_MARGIN_PX)
  const right = Math.min(page.width, Math.ceil(window.centerX + halfX) + WINDOW_MARGIN_PX)
  const bottom = Math.min(page.height, Math.ceil(window.centerY + halfY) + WINDOW_MARGIN_PX)
  const cut = await sharp(page.bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
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
 * A view's pixels: the straightened window cut at page resolution, turned by quarter turns and
 * resized once to the layout's size, so a large region is filtered rather than aliased. A
 * full-resolution layout is not resized at all.
 */
export async function viewPixels(
  page: PagePng,
  quarterTurns: number,
  layout: ViewLayout,
): Promise<RawRgb> {
  const neighbourhood = await windowNeighbourhood(page, samplingWindow(layout))
  // The window is cut at page resolution, about 1:1, which lbb is made for; any shrinking to the
  // view's size happens in the filtered resize below.
  const cut = await sampleRotatedWindow(
    neighbourhood.source,
    neighbourhood.window,
    {
      width: Math.max(1, Math.round(layout.windowWidth)),
      height: Math.max(1, Math.round(layout.windowHeight)),
    },
    'lbb',
  )
  const turned = await sharp(cut.data, { raw: cut.info })
    .rotate(quarterTurns * 90)
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sized = turned
  if (turned.info.width !== layout.width || turned.info.height !== layout.height) {
    sized = await sharp(turned.data, { raw: turned.info })
      .resize({ width: layout.width, height: layout.height, fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })
  }
  if (sized.info.channels !== 3) {
    throw new Error('view_pixels_not_rgb')
  }
  return {
    data: sized.data,
    info: { width: sized.info.width, height: sized.info.height, channels: 3 },
  }
}
