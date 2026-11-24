import sharp from 'sharp'
import type { MediaViewLightDto } from '@invimport/contracts/media'
import { roundHalfEven } from './rounding.ts'
import type { RawRgb } from './view-pixels.ts'

/** Each white-balance gain stays within 15% of 1. */
const WHITE_BALANCE_MAX_GAIN_CHANGE = 0.15
/** The light step may turn no saturated pixel's hue further than this from its source, in degrees. */
const HUE_BUDGET_DEGREES = 5
/**
 * Luminance adjustments scale a pixel's channels together, so only rounding turns its hue: at most
 * 30° divided by the output's channel spread. A saturated pixel keeps a spread of at least 12
 * levels, so 2.5°, and white balance followed by them gets the rest of the budget.
 */
const LUMINANCE_ROUNDING_DEGREES = 2.5
const SATURATED_MIN_OUTPUT_CHROMA = 12
/**
 * The guard watches saturated pixels only: HSV saturation of at least one half, and channels at
 * least 48 levels apart. Near-neutral pixels are what white balance is meant to turn, and below
 * that spread one level of rounding turns a hue by several degrees.
 */
const SATURATED_MIN_SATURATION = 0.5
const SATURATED_MIN_CHROMA = 48
/** The guard tries the gains, then 7/8, 6/8 … 1/8 of the way from 1 to them, then refuses. */
const HOLD_BACK_STEPS = 8
/** The script's unsharp mask (radius 2, 80%, threshold 3), applied to luminance. */
const SHARPEN_SIGMA = 2
const SHARPEN_AMOUNT = 0.8
const SHARPEN_THRESHOLD_LEVELS = 3

const COLOUR_SPACE = 1 << 24

export interface WhiteBalanceGains {
  red: number
  green: number
  blue: number
}

export interface WhiteBalanceOutcome {
  gains: WhiteBalanceGains
  /** The guard scaled the gains towards 1 to keep saturated hues. */
  heldBack: boolean
}

export type LightResult =
  | { state: 'lit'; image: RawRgb; whiteBalance: WhiteBalanceOutcome | null }
  | { state: 'refused'; reason: 'white_balance_hue_guard' }

type Lut = Uint8Array

/** HSV hue in degrees of a packed 0xRRGGBB colour; null for grey. */
function packedHue(red: number, green: number, blue: number): number | null {
  const max = Math.max(red, green, blue)
  const chroma = max - Math.min(red, green, blue)
  if (chroma === 0) {
    return null
  }
  let sector: number
  if (max === red) {
    sector = ((green - blue) / chroma + 6) % 6
  } else if (max === green) {
    sector = (blue - red) / chroma + 2
  } else {
    sector = (red - green) / chroma + 4
  }
  return sector * 60
}

function hueDistance(left: number, right: number) {
  const shift = Math.abs(left - right) % 360
  return Math.min(shift, 360 - shift)
}

/** Grey-world gains, as crop.py computes them, each bounded to ±15%. */
function greyWorldGains(image: RawRgb): [number, number, number] {
  const sums = [0, 0, 0]
  const { data } = image
  for (let offset = 0; offset < data.length; offset += 3) {
    sums[0] += data[offset]
    sums[1] += data[offset + 1]
    sums[2] += data[offset + 2]
  }
  const pixels = data.length / 3
  const means = sums.map((sum) => sum / pixels)
  const grey = (means[0] + means[1] + means[2]) / 3

  const bound = (mean: number) =>
    Math.min(
      1 + WHITE_BALANCE_MAX_GAIN_CHANGE,
      Math.max(1 - WHITE_BALANCE_MAX_GAIN_CHANGE, grey / Math.max(mean, 1)),
    )

  return [bound(means[0]), bound(means[1]), bound(means[2])]
}

/** A channel's lookup table, rounding as Python's `round` does so script gains give its pixels. */
function gainLut(gain: number): Lut {
  const lut = new Uint8Array(256)
  for (let level = 0; level < 256; level++) {
    lut[level] = Math.min(255, roundHalfEven(level * gain))
  }
  return lut
}

function isSaturated(brightest: number, chroma: number) {
  return chroma >= SATURATED_MIN_CHROMA && chroma >= SATURATED_MIN_SATURATION * brightest
}

/** Every distinct saturated colour in the image, packed 0xRRGGBB. */
function saturatedColours(image: RawRgb): Int32Array {
  // Marked in a bitmap of every colour, then listed, so a busy photo stays off the V8 heap.
  const seen = new Uint8Array(COLOUR_SPACE)
  let count = 0
  const { data } = image
  for (let offset = 0; offset < data.length; offset += 3) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const brightest = Math.max(red, green, blue)
    if (!isSaturated(brightest, brightest - Math.min(red, green, blue))) {
      continue
    }
    const packed = (red << 16) | (green << 8) | blue
    if (seen[packed] === 0) {
      seen[packed] = 1
      count++
    }
  }
  const colours = new Int32Array(count)
  let next = 0
  for (let packed = 0; packed < COLOUR_SPACE && next < count; packed++) {
    if (seen[packed] === 1) {
      colours[next] = packed
      next++
    }
  }
  return colours
}

/** The largest hue shift these lookup tables give any of the colours. */
function largestHueShift(colours: Int32Array, luts: [Lut, Lut, Lut]) {
  let largest = 0
  for (const packed of colours) {
    const red = (packed >> 16) & 0xff
    const green = (packed >> 8) & 0xff
    const blue = packed & 0xff
    const before = packedHue(red, green, blue)!
    const after = packedHue(luts[0][red], luts[1][green], luts[2][blue])
    if (after === null) {
      return Infinity
    }
    largest = Math.max(largest, hueDistance(before, after))
  }
  return largest
}

function applyLuts(image: RawRgb, luts: [Lut, Lut, Lut]): RawRgb {
  const data = Buffer.alloc(image.data.length)
  for (let offset = 0; offset < data.length; offset += 3) {
    data[offset] = luts[0][image.data[offset]]
    data[offset + 1] = luts[1][image.data[offset + 1]]
    data[offset + 2] = luts[2][image.data[offset + 2]]
  }
  return { data, info: image.info }
}

/**
 * Grey-world white balance with the hue guard: the bounded gains, or the first step back towards
 * 1 that turns no saturated colour more than `maxShift` degrees; refused when even the smallest
 * step would.
 */
function balanceWhite(
  image: RawRgb,
  maxShift: number,
): { state: 'balanced'; image: RawRgb; outcome: WhiteBalanceOutcome } | { state: 'refused' } {
  const bounded = greyWorldGains(image)
  const colours = saturatedColours(image)
  for (let step = HOLD_BACK_STEPS; step >= 1; step--) {
    const share = step / HOLD_BACK_STEPS
    // The full step keeps the bounded gains exactly, so where the ±15% bound and the guard leave
    // crop.py's gains alone, its pixels match the script's.
    const gains = bounded.map((gain) => (step === HOLD_BACK_STEPS ? gain : 1 + share * (gain - 1)))
    const luts: [Lut, Lut, Lut] = [gainLut(gains[0]), gainLut(gains[1]), gainLut(gains[2])]
    if (largestHueShift(colours, luts) <= maxShift) {
      return {
        state: 'balanced',
        image: applyLuts(image, luts),
        outcome: {
          gains: { red: gains[0], green: gains[1], blue: gains[2] },
          heldBack: step < HOLD_BACK_STEPS,
        },
      }
    }
  }
  return { state: 'refused' }
}

function luminance(red: number, green: number, blue: number) {
  return 0.299 * red + 0.587 * green + 0.114 * blue
}

/**
 * The luminance histogram's ends after clipping `permille` tenths of a percent of the pixels from
 * each, as Pillow's autocontrast finds them; null when nothing is left to stretch.
 */
function contrastEnds(image: RawRgb, permille: number): { low: number; high: number } | null {
  const histogram = new Float64Array(256)
  const { data } = image
  for (let offset = 0; offset < data.length; offset += 3) {
    const level = Math.min(
      255,
      Math.round(luminance(data[offset], data[offset + 1], data[offset + 2])),
    )
    histogram[level]++
  }
  const pixels = data.length / 3

  const clip = (from: number, direction: 1 | -1) => {
    let remaining = Math.floor((pixels * permille) / 1000)
    for (let level = from; level >= 0 && level < 256 && remaining > 0; level += direction) {
      const taken = Math.min(remaining, histogram[level])
      histogram[level] -= taken
      remaining -= taken
    }
  }

  clip(0, 1)
  clip(255, -1)
  const low = histogram.findIndex((count) => count > 0)
  const high = 255 - [...histogram].reverse().findIndex((count) => count > 0)
  if (low < 0 || high <= low) {
    return null
  }
  return { low, high }
}

/** The tone curve on luminance: the contrast stretch, then gamma. */
function toneCurve(image: RawRgb, light: MediaViewLightDto): (level: number) => number {
  const ends =
    light.contrast_clip_permille === null ? null : contrastEnds(image, light.contrast_clip_permille)
  const exponent = light.gamma_thousandths === null ? 1 : 1000 / light.gamma_thousandths
  return (level) => {
    let toned = level
    if (ends) {
      toned = Math.min(255, Math.max(0, ((toned - ends.low) * 255) / (ends.high - ends.low)))
    }
    if (exponent !== 1) {
      toned = 255 * (toned / 255) ** exponent
    }
    return toned
  }
}

/** The toned luminance plane and its blur, for the unsharp mask. */
async function sharpenPlanes(image: RawRgb, tone: (level: number) => number) {
  const { width, height } = image.info
  const toned = Buffer.alloc(width * height)
  for (let index = 0; index < toned.length; index++) {
    const offset = index * 3
    toned[index] = Math.round(
      tone(luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2])),
    )
  }
  const blurred = await sharp(toned, { raw: { width, height, channels: 1 } })
    .blur(SHARPEN_SIGMA)
    .extractChannel(0)
    .raw()
    .toBuffer()
  return { toned, blurred }
}

/** Which pixels were saturated before any light adjustment, one byte per pixel. */
function saturatedPixels(image: RawRgb): Uint8Array {
  const marks = new Uint8Array(image.data.length / 3)
  for (let index = 0; index < marks.length; index++) {
    const offset = index * 3
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    const brightest = Math.max(red, green, blue)
    marks[index] = isSaturated(brightest, brightest - Math.min(red, green, blue)) ? 1 : 0
  }
  return marks
}

/**
 * Contrast, gamma and sharpening on luminance only: each pixel's channels are scaled together to
 * its new luminance, held back where a channel would clip. A pixel that was saturated before the
 * light step keeps an output spread of 12 levels, so rounding turns its hue at most 2.5°.
 */
async function adjustLuminance(
  image: RawRgb,
  light: MediaViewLightDto,
  protectedPixels: Uint8Array,
): Promise<RawRgb> {
  const tone = toneCurve(image, light)
  const planes = light.sharpen ? await sharpenPlanes(image, tone) : null
  const data = Buffer.alloc(image.data.length)
  for (let index = 0; index < data.length / 3; index++) {
    const offset = index * 3
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    const before = luminance(red, green, blue)
    let after = tone(before)
    if (planes) {
      const detail = planes.toned[index] - planes.blurred[index]
      if (Math.abs(detail) >= SHARPEN_THRESHOLD_LEVELS) {
        after = Math.min(255, Math.max(0, after + SHARPEN_AMOUNT * detail))
      }
    }
    const brightest = Math.max(red, green, blue)
    if (brightest === 0) {
      data.fill(Math.round(after), offset, offset + 3)
      continue
    }
    const minimumSpread = protectedPixels[index] === 1 ? SATURATED_MIN_OUTPUT_CHROMA : 0
    scaleKeepingHue(image.data, data, offset, after / before, minimumSpread)
  }
  return { data, info: image.info }
}

/**
 * Scales one pixel's channels by `factor`, held back where a channel would clip and raised so the
 * rounded output spans at least `minimumSpread` levels. The brightest and dimmest channels are
 * rounded, and the middle one is placed between them in its original proportion, so rounding
 * moves hue at most 30° divided by the output's spread.
 */
function scaleKeepingHue(
  source: Buffer,
  target: Buffer,
  offset: number,
  requested: number,
  minimumSpread: number,
) {
  // Channel offsets ordered dimmest to brightest, without allocating per pixel.
  let low = offset
  let middle = offset + 1
  let high = offset + 2
  if (source[low] > source[middle]) {
    ;[low, middle] = [middle, low]
  }
  if (source[middle] > source[high]) {
    ;[middle, high] = [high, middle]
  }
  if (source[low] > source[middle]) {
    ;[low, middle] = [middle, low]
  }
  const spread = source[high] - source[low]
  let factor = requested
  if (minimumSpread > 0 && spread > 0) {
    // One level more than the minimum, so independent rounding of the ends can't fall below it.
    factor = Math.max(factor, (minimumSpread + 1) / spread)
  }
  factor = Math.min(factor, 255 / source[high])
  const scaledLow = Math.round(source[low] * factor)
  const scaledHigh = Math.round(source[high] * factor)
  let scaledMiddle = Math.round(source[middle] * factor)
  if (spread > 0) {
    const share = (source[middle] - source[low]) / spread
    scaledMiddle = scaledLow + Math.round(share * (scaledHigh - scaledLow))
  }
  target[low] = scaledLow
  target[middle] = scaledMiddle
  target[high] = scaledHigh
}

/** Recipe `/2`'s light step, in the contract's order: white balance, contrast, gamma, sharpening. */
export async function applyLight(image: RawRgb, light: MediaViewLightDto): Promise<LightResult> {
  let current = image
  let whiteBalance: WhiteBalanceOutcome | null = null
  // Gamma 1000 is the identity curve, so it adjusts nothing and takes none of the hue budget.
  const adjustsGamma = light.gamma_thousandths !== null && light.gamma_thousandths !== 1000
  const adjustsLuminance = light.contrast_clip_permille !== null || adjustsGamma || light.sharpen
  // Saturation is judged on the source, so white balance can't take a pixel out of protection.
  const protectedPixels = adjustsLuminance ? saturatedPixels(image) : null
  if (light.white_balance) {
    const budget = adjustsLuminance
      ? HUE_BUDGET_DEGREES - LUMINANCE_ROUNDING_DEGREES
      : HUE_BUDGET_DEGREES
    const balanced = balanceWhite(current, budget)
    if (balanced.state === 'refused') {
      return { state: 'refused', reason: 'white_balance_hue_guard' }
    }
    current = balanced.image
    whiteBalance = balanced.outcome
  }
  if (protectedPixels) {
    current = await adjustLuminance(current, light, protectedPixels)
  }
  return { state: 'lit', image: current, whiteBalance }
}
