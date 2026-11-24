import sharp from 'sharp'
import { createCanvas, ImageData, type SKRSContext2D } from '@napi-rs/canvas'
import { pngHeaderMatches } from './decode.ts'
import {
  checkedGridInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type GridInput,
  type GridResult,
} from './decoder-protocol.ts'
import { roundHalfEven } from './rounding.ts'
import { markFont } from './view-marks.ts'

/** A grid preview stays within this many pixels, and draws at most this many lines each way. */
const GRID_MAX_PREVIEW_PIXELS = 8_000_000
const GRID_MAX_LINES = 400
/** grid.py's grid steps; a step is the smallest one giving about 18 lines across the span. */
const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
const LINES_ACROSS = 18
/** A whole-page overview is for layout, so it gets a coarser grid. */
const OVERVIEW_SPAN_FACTOR = 1.6
/** Every fifth line is major. Labels go on every line when lines are this far apart, in preview pixels. */
const MAJOR_EVERY = 5
const LABEL_EVERY_LINE_MIN_PX = 45
/** Labels go on every line, every 2nd, 5th, 10th … line, whichever first leaves room between them. */
const LABEL_LINE_MULTIPLES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const LABEL_GAP_PX = 4
/** A label sits this far from its line, on a chip reaching 2 px beyond its text and 1 px above and below. */
const LABEL_OFFSET_PX = 3
const CHIP_PAD_X = 2
const CHIP_PAD_Y = 1
/** A box is off-centre when opposite margins differ by over 15% of the larger, and 10 px. */
const OFF_CENTRE_SHARE = 0.15
const OFF_CENTRE_MIN_PX = 10
const LABEL_FONT_PX = 14

const COLOURS = {
  majorX: '#e60000',
  minorX: '#ff6e6e',
  majorY: '#0000e6',
  minorY: '#6e6eff',
  labelX: '#c80000',
  labelY: '#0000c8',
  object: '#000000',
  boxes: ['#00c800', '#ff8c00', '#c800c8', '#00aadc'],
} as const

class GridMismatchError extends Error {}

class GridLimitError extends Error {}

interface Corners {
  x0: number
  y0: number
  x1: number
  y1: number
}

type Box = GridInput['boxes'][number]['box']

function corners(box: Box): Corners {
  return { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height }
}

function niceStep(span: number) {
  const raw = span / LINES_ACROSS
  return NICE_STEPS.find((step) => step >= raw) ?? NICE_STEPS.at(-1)!
}

/** Multiples of `every` after `from`, up to but not including `to`, as Python's range gives them. */
function multiples(from: number, to: number, every: number) {
  const values: number[] = []
  for (let value = (Math.floor(from / every) + 1) * every; value < to; value += every) {
    values.push(value)
  }
  return values
}

/** The region clipped to the page, as grid.py clips it; an empty one is a mismatch. */
function clippedRegion(input: GridInput): Corners {
  const requested = input.region
    ? corners(input.region)
    : { x0: 0, y0: 0, x1: input.width, y1: input.height }
  const region = {
    x0: Math.max(0, requested.x0),
    y0: Math.max(0, requested.y0),
    x1: Math.min(input.width, requested.x1),
    y1: Math.min(input.height, requested.y1),
  }
  if (region.x1 <= region.x0 || region.y1 <= region.y0) {
    throw new GridMismatchError('grid_region_outside_page')
  }
  return region
}

interface GridPlan {
  region: Corners
  scale: number
  previewWidth: number
  previewHeight: number
  step: number
}

function gridPlan(input: GridInput): GridPlan {
  const region = clippedRegion(input)
  const width = region.x1 - region.x0
  const height = region.y1 - region.y0
  const scale = input.preview_width / width
  const previewHeight = Math.max(1, roundHalfEven(height * scale))
  if (input.preview_width * previewHeight > GRID_MAX_PREVIEW_PIXELS) {
    throw new GridLimitError('grid_preview_limit')
  }
  const spanFactor = input.region ? 1 : OVERVIEW_SPAN_FACTOR
  const step = input.step ?? niceStep(Math.max(width, height) * spanFactor)
  if (width / step > GRID_MAX_LINES || height / step > GRID_MAX_LINES) {
    throw new GridLimitError('grid_line_limit')
  }
  return { region, scale, previewWidth: input.preview_width, previewHeight, step }
}

/**
 * A page coordinate's preview pixel, kept inside the preview, so a line at the region's edge is
 * drawn and its label sits on it.
 */
function previewPixel(value: number, origin: number, scale: number, size: number) {
  return Math.min(size - 1, Math.max(0, Math.floor((value - origin) * scale)))
}

interface Chip {
  left: number
  top: number
  right: number
  bottom: number
}

/** The chip behind a label whose text starts at (x, y). */
function chipAround(x: number, y: number, textWidth: number): Chip {
  return {
    left: x - CHIP_PAD_X,
    top: y - CHIP_PAD_Y,
    right: x + textWidth + CHIP_PAD_X,
    bottom: y + LABEL_FONT_PX + CHIP_PAD_Y,
  }
}

function fitsPreview(chipBounds: Chip, plan: GridPlan) {
  return (
    chipBounds.left >= 0 &&
    chipBounds.top >= 0 &&
    chipBounds.right <= plan.previewWidth &&
    chipBounds.bottom <= plan.previewHeight
  )
}

/** A label on a white chip, so it stays legible on foil, glare and busy backgrounds. */
function chip(context: SKRSContext2D, x: number, y: number, text: string, colour: string) {
  const bounds = chipAround(x, y, context.measureText(text).width)
  context.fillStyle = '#ffffff'
  context.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
  context.fillStyle = colour
  context.fillText(text, x, y)
}

/**
 * The label interval: grid.py's (every line when lines are 45 px apart, else every other), widened
 * to a further multiple of the step until labels `room` px across are at least that far apart.
 */
function labelStep(plan: GridPlan, room: number) {
  const scriptMultiple = plan.step * plan.scale >= LABEL_EVERY_LINE_MIN_PX ? 1 : 2
  const candidates = LABEL_LINE_MULTIPLES.filter((multiple) => multiple >= scriptMultiple)
  const fitting = candidates.find((multiple) => plan.step * multiple * plan.scale >= room)
  return plan.step * (fitting ?? candidates.at(-1)!)
}

function drawLines(context: SKRSContext2D, plan: GridPlan) {
  const { region, scale, step, previewWidth, previewHeight } = plan
  const major = step * MAJOR_EVERY
  for (const x of multiples(region.x0, region.x1, step)) {
    const isMajor = x % major === 0
    const thickness = isMajor ? 2 : 1
    context.fillStyle = isMajor ? COLOURS.majorX : COLOURS.minorX
    context.fillRect(
      Math.max(0, previewPixel(x, region.x0, scale, previewWidth) - thickness + 1),
      0,
      thickness,
      previewHeight,
    )
  }
  for (const y of multiples(region.y0, region.y1, step)) {
    const isMajor = y % major === 0
    const thickness = isMajor ? 2 : 1
    context.fillStyle = isMajor ? COLOURS.majorY : COLOURS.minorY
    context.fillRect(
      0,
      Math.max(0, previewPixel(y, region.y0, scale, previewHeight) - thickness + 1),
      previewWidth,
      thickness,
    )
  }
}

/**
 * Labels go on last, so no line crosses them. A label that would run off the right or bottom edge
 * goes on its line's other side; one that still doesn't fit, or would cover the previous label, is
 * left out. Only the labels drawn are returned.
 */
function drawLabels(context: SKRSContext2D, plan: GridPlan) {
  const { region, scale, previewWidth, previewHeight } = plan
  const widest = context.measureText(String(region.x1)).width
  const xStep = labelStep(plan, widest + 2 * CHIP_PAD_X + LABEL_GAP_PX)
  const yStep = labelStep(plan, LABEL_FONT_PX + 2 * CHIP_PAD_Y + LABEL_GAP_PX)
  const xLabels: number[] = []
  let previousRight = -Infinity
  for (const x of multiples(region.x0, region.x1, xStep)) {
    const line = previewPixel(x, region.x0, scale, previewWidth)
    const width = context.measureText(String(x)).width
    let left = line + LABEL_OFFSET_PX
    if (left + width + CHIP_PAD_X > previewWidth) {
      left = line - LABEL_OFFSET_PX - width
    }
    const bounds = chipAround(left, LABEL_OFFSET_PX, width)
    if (fitsPreview(bounds, plan) && bounds.left >= previousRight) {
      chip(context, left, LABEL_OFFSET_PX, String(x), COLOURS.labelX)
      xLabels.push(x)
      previousRight = bounds.right
    }
  }
  // y labels start below the row of x labels, so the two never overlap in the corner.
  let previousBottom = xLabels.length > 0 ? chipAround(0, LABEL_OFFSET_PX, 0).bottom : -Infinity
  const yLabels: number[] = []
  for (const y of multiples(region.y0, region.y1, yStep)) {
    const line = previewPixel(y, region.y0, scale, previewHeight)
    let top = line + LABEL_OFFSET_PX
    if (top + LABEL_FONT_PX + CHIP_PAD_Y > previewHeight) {
      top = line - LABEL_OFFSET_PX - LABEL_FONT_PX
    }
    const bounds = chipAround(LABEL_OFFSET_PX, top, context.measureText(String(y)).width)
    if (fitsPreview(bounds, plan) && bounds.top >= previousBottom) {
      chip(context, LABEL_OFFSET_PX, top, String(y), COLOURS.labelY)
      yLabels.push(y)
      previousBottom = bounds.bottom
    }
  }
  return { xLabels, yLabels }
}

/** The object's bounds, dashed. */
function drawObject(context: SKRSContext2D, plan: GridPlan, object: Corners) {
  const { region, scale } = plan
  const left = (object.x0 - region.x0) * scale
  const right = (object.x1 - region.x0) * scale
  const top = (object.y0 - region.y0) * scale
  const bottom = (object.y1 - region.y0) * scale
  context.strokeStyle = COLOURS.object
  context.lineWidth = 2
  context.setLineDash([6, 6])
  context.strokeRect(left, top, right - left, bottom - top)
  context.setLineDash([])
}

/** A proposed box with its centre crosshair and name. */
function drawBox(
  context: SKRSContext2D,
  plan: GridPlan,
  box: Corners,
  name: string,
  colour: string,
) {
  const { region, scale } = plan
  const left = (box.x0 - region.x0) * scale
  const top = (box.y0 - region.y0) * scale
  const right = (box.x1 - region.x0) * scale
  const bottom = (box.y1 - region.y0) * scale
  const centreX = (left + right) / 2
  const centreY = (top + bottom) / 2
  context.strokeStyle = colour
  context.lineWidth = 3
  context.strokeRect(left, top, right - left, bottom - top)
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(centreX - 12, centreY)
  context.lineTo(centreX + 12, centreY)
  context.moveTo(centreX, centreY - 12)
  context.lineTo(centreX, centreY + 12)
  context.stroke()
  chip(context, left + 4, top + 4, name, colour)
}

/** A box's size and its margins to the object, flagged as grid.py flags them. */
function measure(box: Corners, object: Corners | null) {
  const width = box.x1 - box.x0
  const height = box.y1 - box.y0
  if (!object) {
    return { aspect: width / height, margins: null, clips: false, off_centre: [] }
  }
  const margins = {
    left: object.x0 - box.x0,
    right: box.x1 - object.x1,
    top: object.y0 - box.y0,
    bottom: box.y1 - object.y1,
  }

  const lopsided = (first: number, second: number) =>
    Math.abs(first - second) >
    Math.max(OFF_CENTRE_MIN_PX, OFF_CENTRE_SHARE * Math.max(first, second))

  const clips = Math.min(margins.left, margins.right, margins.top, margins.bottom) < 0
  const offCentre: ('x' | 'y')[] = []
  if (!clips && lopsided(margins.left, margins.right)) {
    offCentre.push('x')
  }
  if (!clips && lopsided(margins.top, margins.bottom)) {
    offCentre.push('y')
  }
  return { aspect: width / height, margins, clips, off_centre: offCentre }
}

async function previewPixels(input: GridInput, plan: GridPlan) {
  const { region } = plan
  const { data, info } = await sharp(input.bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .extract({
      left: region.x0,
      top: region.y0,
      width: region.x1 - region.x0,
      height: region.y1 - region.y0,
    })
    .resize({ width: plan.previewWidth, height: plan.previewHeight, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return new ImageData(new Uint8ClampedArray(data), info.width, info.height)
}

async function checkPagePng(input: GridInput) {
  if (!pngHeaderMatches(input.bytes, input.width, input.height)) {
    throw new GridMismatchError('grid_page_mismatch')
  }
  // Any library failure from here is not a claim about the bytes, so it propagates.
  const metadata = await sharp(input.bytes, { limitInputPixels: MEDIA_LIMITS.pixels }).metadata()
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) {
    throw new GridMismatchError('grid_page_not_png')
  }
}

async function drawGrid(input: GridInput, plan: GridPlan) {
  const canvas = createCanvas(plan.previewWidth, plan.previewHeight)
  const context = canvas.getContext('2d')
  context.putImageData(await previewPixels(input, plan), 0, 0)
  context.font = `${LABEL_FONT_PX}px "${markFont()}"`
  context.textBaseline = 'top'
  drawLines(context, plan)
  const labels = drawLabels(context, plan)
  const object = input.object ? corners(input.object) : null
  if (object) {
    drawObject(context, plan, object)
  }
  for (const [index, item] of input.boxes.entries()) {
    drawBox(
      context,
      plan,
      corners(item.box),
      item.name,
      COLOURS.boxes[index % COLOURS.boxes.length],
    )
  }
  const bytes = await canvas.encode('png')
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new GridLimitError('grid_output_limit')
  }
  return { image: { width: canvas.width, height: canvas.height, bytes }, labels }
}

/**
 * `inspect_region`, ported from image-grid-overlay's grid.py: a grid labelled in page pixels over
 * the page or a region of it, so positions read off it go straight into a recipe, with proposed
 * boxes, their centre crosshairs and their margins to the object.
 */
export async function renderGrid(input: GridInput): Promise<GridResult> {
  checkedGridInput(input)
  try {
    await checkPagePng(input)
    const plan = gridPlan(input)
    const drawn = await drawGrid(input, plan)
    const object = input.object ? corners(input.object) : null
    const { region } = plan
    return {
      state: 'ready',
      toolchain: MEDIA_TOOLCHAIN,
      image: drawn.image,
      region: {
        x: region.x0,
        y: region.y0,
        width: region.x1 - region.x0,
        height: region.y1 - region.y0,
      },
      scale: plan.scale,
      step: plan.step,
      x_labels: drawn.labels.xLabels,
      y_labels: drawn.labels.yLabels,
      boxes: input.boxes.map((item) => ({
        name: item.name,
        box: item.box,
        ...measure(corners(item.box), object),
      })),
    }
  } catch (error) {
    if (error instanceof GridMismatchError) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }
    }
    if (error instanceof GridLimitError) {
      return { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN }
    }
    throw error
  }
}
