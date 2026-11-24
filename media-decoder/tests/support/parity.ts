import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { MediaLitViewRecipeDto, MediaViewLightDto } from '@invimport/contracts/media'

const FIXTURES = new URL('../fixtures/parity/', import.meta.url)

export interface CropFixture {
  name: string
  /** X0 Y0 X1 Y1 in source pixels, as crop.py takes them. */
  region: [number, number, number, number]
  quarter_turns: number
  straighten: number
  wb: boolean
  /** The script's gains turn a saturated colour over 5°, so the renderer holds them back. */
  guard_holds_back: boolean
  output: string
  gains: [number, number, number] | null
}

export interface GridFixture {
  name: string
  arguments: string[]
  printed: string[]
}

export interface LogoFixture {
  id: string
  degradation: string
  query: string
  top: string[]
}

/** montage.py's sheet of the whole photo, then these crops, in 360 px cells four across. */
export interface MontageFixture {
  output: string
  whole_photo_first: true
  crops: string[]
}

export interface ParityFixtures {
  photo: string
  crops: CropFixture[]
  grids: GridFixture[]
  logos: LogoFixture[]
  montage: MontageFixture
}

export async function parityFixtures(): Promise<ParityFixtures> {
  return JSON.parse(await readFile(new URL('expected.json', FIXTURES), 'utf8')) as ParityFixtures
}

export function fixtureBytes(name: string) {
  return readFile(new URL(name, FIXTURES))
}

export const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export interface Raster {
  width: number
  height: number
  data: Buffer
}

/** Any image as 8-bit RGB, alpha dropped. */
export async function rgbRaster(bytes: Buffer): Promise<Raster> {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.equal(info.channels, 3)
  return { width: info.width, height: info.height, data }
}

export const NO_LIGHT: MediaViewLightDto = {
  white_balance: false,
  contrast_clip_permille: null,
  gamma_thousandths: null,
  sharpen: false,
}

/** The lit recipe for a crop.py invocation with `--exact --nosquare`. */
export function recipeForCrop(
  fixture: Pick<CropFixture, 'region' | 'quarter_turns' | 'straighten' | 'wb'>,
  page: { width: number; height: number; digest: string },
): MediaLitViewRecipeDto {
  const [x0, y0, x1, y1] = fixture.region
  return {
    version: 'bench-intake-view/2',
    source_version_id: '00000000-0000-4000-8000-000000000002',
    source_digest: page.digest,
    page: 1,
    page_width: page.width,
    page_height: page.height,
    view: {
      region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      quarter_turns: fixture.quarter_turns,
      straighten_millidegrees: Math.round(fixture.straighten * 1000),
    },
    light: { ...NO_LIGHT, white_balance: fixture.wb },
  }
}

/** The evidence page a recipe names, which a preview page must carry. */
export function sourceOf(recipe: MediaLitViewRecipeDto) {
  return {
    source_version_id: recipe.source_version_id,
    source_digest: recipe.source_digest,
    page: recipe.page,
  }
}

export interface Difference {
  mean: number
  max: number
  /** Share of channel values more than `near` levels apart. */
  farShare: number
}

export function difference(left: Raster, right: Raster, near = 4): Difference {
  assert.deepEqual([left.width, left.height], [right.width, right.height], 'same size')
  let total = 0
  let max = 0
  let far = 0
  for (let index = 0; index < left.data.length; index++) {
    const delta = Math.abs(left.data[index] - right.data[index])
    total += delta
    max = Math.max(max, delta)
    if (delta > near) {
      far++
    }
  }
  return { mean: total / left.data.length, max, farShare: far / left.data.length }
}

/** HSV hue in degrees, or null for a grey pixel. */
export function hue(red: number, green: number, blue: number): number | null {
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

export function hueShift(before: number, after: number) {
  const shift = Math.abs(before - after) % 360
  return Math.min(shift, 360 - shift)
}
