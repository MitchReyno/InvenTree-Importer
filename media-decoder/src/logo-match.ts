import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { createCanvas, ImageData, type SKRSContext2D } from '@napi-rs/canvas'
import { viewLayout, type ViewLayout } from '@invimport/contracts/media'
import { pngHeaderMatches } from './decode.ts'
import {
  checkedLogoMatchInput,
  MEDIA_LIMITS,
  MEDIA_TOOLCHAIN,
  type LogoMatchInput,
  type LogoMatchResult,
} from './decoder-protocol.ts'
import { RotatedRegionLimitError } from './rotated-region.ts'
import { roundHalfEven } from './rounding.ts'
import { markFont } from './view-marks.ts'
import { viewPixels, type RawRgb } from './view-pixels.ts'

/**
 * The chip-logo-identification skill's reference set, bundled read-only: 483 chip logos from
 * 403 makers, each a light-on-dark GIF, with `index.json` naming each one's maker and page.
 */
export const LOGO_SET_DIRECTORY = new URL('./chip-logos/', import.meta.url)

/** match.py's candidate sheet: the query, then each candidate, in 250 × 140 px tiles, four across. */
export const SHEET_GEOMETRY = Object.freeze({ columns: 4, cellWidth: 250, cellHeight: 140 })
const SHEET_IMAGE_HEIGHT = 95
const SHEET_MAX_ZOOM = 4
const SHEET_FONT_PX = 15
const SHEET_MANUFACTURER_CHARACTERS = 30

/** Marks are compared as 48 × 48 normalised shapes. */
const FEATURE_SIDE = 48
const FEATURE_BLUR_SIGMA = 1.2
/** A mark with fewer foreground pixels than this has no shape to compare. */
const FEATURE_MIN_PIXELS = 4
const AUTOCONTRAST_CUTOFF_PERCENT = 1
/** A mark smaller than this is enlarged twice before thresholding. */
const SMALL_MARK_PX = 60
/**
 * A query is matched at most this large on its long edge, aspect kept, so an elongated crop can't
 * square up into a buffer beyond the decoder's memory. Shapes are compared at 48 px anyway.
 */
const QUERY_MAX_LONG_EDGE_PX = 1024
/** A score is the shape correlation weighted by how well the aspect ratios agree. */
const SHAPE_WEIGHT = 0.6
const ASPECT_WEIGHT = 0.4

const LOGO_FILE = /^logos\/[A-Za-z0-9_.-]+\.gif$/

class LogoMismatchError extends Error {}

interface LogoEntry {
  id: string
  manufacturer: string
  family: string
  page: string
  file: string
}

interface Shape {
  vector: Float64Array
  /** The mark's bounding box width over height. */
  aspect: number
}

interface Reference {
  entry: LogoEntry
  shape: Shape
}

interface Grey {
  data: Uint8Array
  width: number
  height: number
}

function isLogoEntry(value: unknown): value is LogoEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  return (
    ['id', 'manufacturer', 'family', 'page', 'file'].every(
      (key) => typeof entry[key] === 'string' && entry[key] !== '',
    ) && LOGO_FILE.test(entry.file as string)
  )
}

async function logoIndex(): Promise<LogoEntry[]> {
  const index: unknown = JSON.parse(
    await readFile(new URL('index.json', LOGO_SET_DIRECTORY), 'utf8'),
  )
  if (!Array.isArray(index) || !index.every(isLogoEntry)) {
    throw new Error('logo_set_invalid')
  }
  return index
}

/** Pillow's RGB to L conversion, in its fixed-point form. */
function greyscale(image: RawRgb): Grey {
  const { width, height } = image.info
  const data = new Uint8Array(width * height)
  for (let index = 0; index < data.length; index++) {
    const offset = index * 3
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    data[index] = (red * 19595 + green * 38470 + blue * 7471 + 0x8000) >> 16
  }
  return { data, width, height }
}

/** Pillow's autocontrast: cut `percent` of the pixels off each end, then stretch the rest. */
function autocontrast(grey: Grey, percent: number): Grey {
  const histogram = new Array<number>(256).fill(0)
  for (const level of grey.data) {
    histogram[level]++
  }

  const cutEnd = (levels: Iterable<number>) => {
    let cut = Math.floor((grey.data.length * percent) / 100)
    for (const level of levels) {
      if (cut <= 0) {
        break
      }
      const taken = Math.min(cut, histogram[level])
      histogram[level] -= taken
      cut -= taken
    }
  }

  cutEnd(Array.from({ length: 256 }, (_, level) => level))
  cutEnd(Array.from({ length: 256 }, (_, level) => 255 - level))
  const low = histogram.findIndex((count) => count > 0)
  const high = 255 - [...histogram].reverse().findIndex((count) => count > 0)
  if (low < 0 || high <= low) {
    return grey
  }
  const scale = 255 / (high - low)
  const offset = -low * scale
  const lut = Array.from({ length: 256 }, (_, level) =>
    Math.min(255, Math.max(0, Math.trunc(level * scale + offset))),
  )
  return { ...grey, data: grey.data.map((level) => lut[level]) }
}

async function enlargedIfSmall(grey: Grey): Promise<Grey> {
  if (Math.max(grey.width, grey.height) >= SMALL_MARK_PX) {
    return grey
  }
  const width = Math.max(1, grey.width * 2)
  const height = Math.max(1, grey.height * 2)
  const data = await sharp(Buffer.from(grey.data), {
    raw: { width: grey.width, height: grey.height, channels: 1 },
  })
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
    .extractChannel(0)
    .raw()
    .toBuffer()
  return { data: new Uint8Array(data), width, height }
}

/** Otsu's threshold, computed as match.py's numpy expression computes it. */
function otsu(grey: Grey) {
  const histogram = new Array<number>(256).fill(0)
  for (const level of grey.data) {
    histogram[level]++
  }
  const total = grey.data.length
  let weight = 0
  let moment = 0
  const weights: number[] = []
  const moments: number[] = []
  for (let level = 0; level < 256; level++) {
    const share = histogram[level] / total
    weight += share
    moment += share * level
    weights.push(weight)
    moments.push(moment)
  }
  const mean = moments[255]
  let best = -1
  let bestVariance = -Infinity
  for (let level = 0; level < 256; level++) {
    const variance =
      (mean * weights[level] - moments[level]) ** 2 / (weights[level] * (1 - weights[level]))
    if (!Number.isNaN(variance) && variance > bestVariance) {
      bestVariance = variance
      best = level
    }
  }
  return best
}

/** The foreground for each polarity: light on dark, then dark on light. Empty for a blank image. */
async function polarityMasks(
  image: RawRgb,
): Promise<{ masks: Uint8Array[]; width: number; height: number }> {
  const grey = await enlargedIfSmall(autocontrast(greyscale(image), AUTOCONTRAST_CUTOFF_PERCENT))
  const threshold = otsu(grey)
  if (threshold < 0) {
    return { masks: [], width: grey.width, height: grey.height }
  }
  const light = grey.data.map((level) => (level > threshold ? 1 : 0))
  const dark = grey.data.map((level) => (level <= threshold ? 1 : 0))
  return { masks: [light, dark], width: grey.width, height: grey.height }
}

/** The mask's bounding box, centred on a square, as a normalised 48 × 48 shape. */
async function shapeOf(mask: Uint8Array, width: number, height: number): Promise<Shape | null> {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        count++
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (count < FEATURE_MIN_PIXELS) {
    return null
  }
  const boxWidth = right - left + 1
  const boxHeight = bottom - top + 1
  const side = Math.max(boxWidth, boxHeight)
  const square = Buffer.alloc(side * side)
  const offsetX = Math.floor((side - boxWidth) / 2)
  const offsetY = Math.floor((side - boxHeight) / 2)
  for (let y = 0; y < boxHeight; y++) {
    for (let x = 0; x < boxWidth; x++) {
      if (mask[(top + y) * width + left + x]) {
        square[(offsetY + y) * side + offsetX + x] = 255
      }
    }
  }
  const resized = await sharp(square, { raw: { width: side, height: side, channels: 1 } })
    .resize({ width: FEATURE_SIDE, height: FEATURE_SIDE, fit: 'fill', kernel: 'linear' })
    .extractChannel(0)
    .raw()
    .toBuffer()
  const blurred = await sharp(resized, {
    raw: { width: FEATURE_SIDE, height: FEATURE_SIDE, channels: 1 },
  })
    .blur(FEATURE_BLUR_SIGMA)
    .extractChannel(0)
    .raw()
    .toBuffer()
  const vector = Float64Array.from(blurred)
  const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length
  let norm = 0
  for (let index = 0; index < vector.length; index++) {
    vector[index] -= mean
    norm += vector[index] ** 2
  }
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let index = 0; index < vector.length; index++) {
      vector[index] /= norm
    }
  }
  return { vector, aspect: boxWidth / boxHeight }
}

async function logoPixels(entry: LogoEntry): Promise<RawRgb> {
  const { data, info } = await sharp(await readFile(new URL(entry.file, LOGO_SET_DIRECTORY)))
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, info: { width: info.width, height: info.height, channels: 3 } }
}

let references: Promise<Reference[]> | undefined

/** Each reference's light-on-dark shape, computed once per process. */
function referenceShapes(): Promise<Reference[]> {
  references ??= (async () => {
    const shapes: Reference[] = []
    for (const entry of await logoIndex()) {
      const { masks, width, height } = await polarityMasks(await logoPixels(entry))
      const shape = masks.length > 0 ? await shapeOf(masks[0], width, height) : null
      if (shape) {
        shapes.push({ entry, shape })
      }
    }
    return shapes
  })()
  return references
}

function score(query: Shape[], reference: Shape) {
  let best = -1
  for (const shape of query) {
    let correlation = 0
    for (let index = 0; index < shape.vector.length; index++) {
      correlation += shape.vector[index] * reference.vector[index]
    }
    const agreement =
      Math.min(shape.aspect, reference.aspect) / Math.max(shape.aspect, reference.aspect)
    best = Math.max(best, correlation * (SHAPE_WEIGHT + ASPECT_WEIGHT * agreement))
  }
  // Rounding can carry a perfect correlation just past 1.
  return Math.min(1, Math.max(-1, best))
}

interface Ranked {
  entry: LogoEntry
  score: number
}

/** The reference set ranked against the query's shapes in both polarities, best first. */
/** The query, shrunk to `QUERY_MAX_LONG_EDGE_PX` on its long edge when larger. */
async function boundedQuery(query: RawRgb): Promise<RawRgb> {
  const { width, height } = query.info
  const longEdge = Math.max(width, height)
  if (longEdge <= QUERY_MAX_LONG_EDGE_PX) {
    return query
  }
  const scale = QUERY_MAX_LONG_EDGE_PX / longEdge
  const { data, info } = await sharp(query.data, { raw: query.info })
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      fit: 'fill',
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, info: { width: info.width, height: info.height, channels: 3 } }
}

async function rank(query: RawRgb, top: number): Promise<Ranked[]> {
  const { masks, width, height } = await polarityMasks(await boundedQuery(query))
  const shapes: Shape[] = []
  for (const mask of masks) {
    const shape = await shapeOf(mask, width, height)
    if (shape) {
      shapes.push(shape)
    }
  }
  if (shapes.length === 0) {
    return []
  }
  const scored = (await referenceShapes()).map(({ entry, shape }) => ({
    entry,
    score: score(shapes, shape),
  }))
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, top)
}

async function drawTile(
  context: SKRSContext2D,
  index: number,
  image: RawRgb,
  lines: { title: string; subtitle: string; outline: string },
) {
  const { columns, cellWidth, cellHeight } = SHEET_GEOMETRY
  const x = (index % columns) * cellWidth
  const y = Math.floor(index / columns) * cellHeight
  const zoom = Math.min(
    SHEET_MAX_ZOOM,
    (cellWidth - 12) / image.info.width,
    SHEET_IMAGE_HEIGHT / image.info.height,
  )
  const width = Math.max(1, roundHalfEven(image.info.width * zoom))
  const height = Math.max(1, roundHalfEven(image.info.height * zoom))
  const scaled = await sharp(image.data, { raw: image.info })
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  context.fillStyle = '#000000'
  context.fillRect(x + 2, y + 2, cellWidth - 3, cellHeight - 3)
  context.strokeStyle = lines.outline
  context.lineWidth = 1
  context.strokeRect(x + 2.5, y + 2.5, cellWidth - 4, cellHeight - 4)
  context.putImageData(
    new ImageData(new Uint8ClampedArray(scaled), width, height),
    x + Math.floor((cellWidth - width) / 2),
    y + 5 + Math.floor((SHEET_IMAGE_HEIGHT - height) / 2),
  )
  // Text is squeezed to the tile's inner width, so a long maker name never runs into the next tile.
  const textWidth = cellWidth - 12
  context.fillStyle = '#ffd200'
  context.fillText(lines.title, x + 6, y + 102, textWidth)
  context.fillStyle = '#ebebeb'
  context.fillText(lines.subtitle, x + 6, y + 119, textWidth)
}

/** The query, then each candidate with its rank, id, score and maker. */
async function candidateSheet(query: RawRgb, ranked: Ranked[]) {
  const { columns, cellWidth, cellHeight } = SHEET_GEOMETRY
  const rows = Math.ceil((ranked.length + 1) / columns)
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#18181c'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = `${SHEET_FONT_PX}px "${markFont()}"`
  context.textBaseline = 'top'
  await drawTile(context, 0, query, { title: 'QUERY', subtitle: '', outline: '#ffaa3c' })
  for (const [index, item] of ranked.entries()) {
    await drawTile(context, index + 1, await logoPixels(item.entry), {
      title: `#${index + 1} ${item.entry.id} (${item.score.toFixed(2)})`,
      subtitle: item.entry.manufacturer.slice(0, SHEET_MANUFACTURER_CHARACTERS),
      outline: '#464646',
    })
  }
  const bytes = await canvas.encode('png')
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new RotatedRegionLimitError('logo_sheet_output_limit')
  }
  return { width: canvas.width, height: canvas.height, bytes }
}

async function checkedQueryLayout(input: LogoMatchInput): Promise<ViewLayout> {
  if (!pngHeaderMatches(input.bytes, input.width, input.height)) {
    throw new LogoMismatchError('logo_page_mismatch')
  }
  let layout: ViewLayout
  try {
    layout = viewLayout(
      { page_width: input.width, page_height: input.height, view: input.view },
      'full',
    )
  } catch {
    throw new LogoMismatchError('view_region_outside_page')
  }
  // Any library failure from here is not a claim about the bytes, so it propagates.
  const metadata = await sharp(input.bytes, { limitInputPixels: MEDIA_LIMITS.pixels }).metadata()
  if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) {
    throw new LogoMismatchError('logo_page_not_png')
  }
  return layout
}

/**
 * `match_logo`, ported from chip-logo-identification's match.py: the view of the page is turned
 * upright with the shared view geometry, thresholded in both polarities and compared with every
 * bundled logo. The ranking is a shortlist to confirm by eye on the candidate sheet.
 */
export async function matchLogo(input: LogoMatchInput): Promise<LogoMatchResult> {
  checkedLogoMatchInput(input)
  try {
    const layout = await checkedQueryLayout(input)
    const query = await viewPixels(input, input.view.quarter_turns, layout)
    const ranked = await rank(query, input.top)
    return {
      state: 'ready',
      toolchain: MEDIA_TOOLCHAIN,
      sheet: await candidateSheet(query, ranked),
      candidates: ranked.map(({ entry, score: value }) => ({
        id: entry.id,
        manufacturer: entry.manufacturer,
        family: entry.family,
        page: entry.page,
        score: value,
      })),
    }
  } catch (error) {
    if (error instanceof LogoMismatchError) {
      return { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }
    }
    if (error instanceof RotatedRegionLimitError) {
      return { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN }
    }
    throw error
  }
}
