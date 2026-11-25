import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { viewLayout, type MediaLitViewRecipeDto } from '@invimport/contracts/media'
import { decode } from '../src/decode.ts'
import { renderLitCrop } from '../src/lit-crop.ts'
import {
  difference,
  fixtureBytes,
  hue,
  hueShift,
  NO_LIGHT,
  parityFixtures,
  recipeForCrop,
  rgbRaster,
  sha,
  type CropFixture,
  type Raster,
} from './support/parity.ts'

/**
 * Pillow's rotation uses a cubic with a = -1 and libvips, which renders every view, Catmull-Rom
 * (a = -0.5), so on a noisy photo a straightened crop matches the script's only closely. Measured
 * here: a mean of 0.8-1.2 levels with 1-6% of values over four levels apart. The same geometry off
 * by half a pixel measures over 2.5 levels and 14%, so these bounds still catch geometry errors.
 */
const STRAIGHTENED_MEAN_LEVELS = 1.5
const STRAIGHTENED_FAR_SHARE = 0.08
/** The renderer's hue guard holds white balance to this; resistor bands must stay within it. */
const MAX_BAND_HUE_SHIFT_DEGREES = 5
/** Luminance adjustments keep every saturated pixel's hue within the same 5° the guard allows. */
const LUMINANCE_HUE_TOLERANCE_DEGREES = 5

const BANDS = {
  brown: [120, 60, 30],
  red: [200, 30, 30],
  orange: [230, 120, 20],
  yellow: [220, 200, 40],
  green: [40, 160, 60],
  blue: [40, 80, 200],
  violet: [130, 60, 170],
} as const

interface Original {
  bytes: Buffer
  digest: string
  width: number
  height: number
}

async function benchPhoto(): Promise<Original> {
  const fixtures = await parityFixtures()
  const bytes = await fixtureBytes(fixtures.photo)
  const metadata = await sharp(bytes).metadata()
  return { bytes, digest: sha(bytes), width: metadata.width, height: metadata.height }
}

/** The derived crop, as approval would derive it: the original decoded with the recipe. */
async function derived(original: Original, recipe: MediaLitViewRecipeDto) {
  const result = await decode({
    version: 'media-decode/1',
    digest: original.digest,
    bytes: original.bytes,
    recipe,
  })
  assert.equal(result.state, 'ready')
  assert.equal(result.pages.length, 1)
  return result.pages[0]
}

async function cropFixtures(predicate: (fixture: CropFixture) => boolean) {
  const fixtures = await parityFixtures()
  const chosen = fixtures.crops.filter(predicate)
  assert.ok(chosen.length > 0)
  return chosen
}

function pixelAt(image: Raster, x: number, y: number): [number, number, number] {
  const offset = (y * image.width + x) * 3
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
}

function patchMean(image: Raster, x: number, y: number, radius: number) {
  const sums = [0, 0, 0]
  let count = 0
  for (let row = y - radius; row <= y + radius; row++) {
    for (let column = x - radius; column <= x + radius; column++) {
      const [red, green, blue] = pixelAt(image, column, row)
      sums[0] += red
      sums[1] += green
      sums[2] += blue
      count++
    }
  }
  return sums.map((sum) => sum / count)
}

function spread(colour: number[]) {
  return Math.max(...colour) - Math.min(...colour)
}

async function solidPage(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly number[],
): Promise<Original> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set(paint(x, y), (y * width + x) * 3)
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
  return { bytes, digest: sha(bytes), width, height }
}

/** The whole page, unturned, with these light adjustments. */
function wholePage(
  page: Original,
  light: Partial<MediaLitViewRecipeDto['light']>,
): MediaLitViewRecipeDto {
  const geometry = {
    region: [0, 0, page.width, page.height] as [number, number, number, number],
    quarter_turns: 0,
    straighten: 0,
    wb: false,
  }
  return { ...recipeForCrop(geometry, page), light: { ...NO_LIGHT, ...light } }
}

/** Seven band stripes on a background with a strong blue cast, so gains reach their bounds. */
function bandedPage(background: readonly number[]) {
  const colours = Object.values(BANDS)
  return solidPage(280, 120, (x, y) => {
    const band = Math.floor(x / 40)
    if (y >= 40 && y < 80 && x % 40 >= 8 && x % 40 < 32) {
      return colours[band]
    }
    return background
  })
}

test('crops and quarter turns match the script pixel for pixel', async () => {
  const original = await benchPhoto()
  for (const fixture of await cropFixtures((item) => !item.straighten && !item.wb)) {
    const page = await derived(original, recipeForCrop(fixture, original))
    const expected = await rgbRaster(await fixtureBytes(fixture.output))
    const actual = await rgbRaster(page.bytes)
    assert.deepEqual(difference(actual, expected), { mean: 0, max: 0, farShare: 0 }, fixture.name)
  }
})

test('straightened crops match the script within interpolation tolerance', async () => {
  const original = await benchPhoto()
  for (const fixture of await cropFixtures((item) => item.straighten !== 0)) {
    const recipe = recipeForCrop(fixture, original)
    assert.equal(viewLayout(recipe, 'full').guard, 1, `${fixture.name} needs no corner guard`)
    const actual = await rgbRaster((await derived(original, recipe)).bytes)
    const expected = await rgbRaster(await fixtureBytes(fixture.output))
    const measured = difference(actual, expected)
    assert.ok(measured.mean <= STRAIGHTENED_MEAN_LEVELS, `${fixture.name} mean ${measured.mean}`)
    assert.ok(
      measured.farShare <= STRAIGHTENED_FAR_SHARE,
      `${fixture.name} far share ${measured.farShare}`,
    )
  }
})

test('white balance keeps the script gains and pixels when the hue guard leaves them intact', async () => {
  const original = await benchPhoto()
  const page = (
    await decode({ version: 'media-decode/1', digest: original.digest, bytes: original.bytes })
  ).pages[0]
  for (const fixture of await cropFixtures((item) => item.wb && !item.guard_holds_back)) {
    const recipe = recipeForCrop(fixture, original)
    const rendered = await renderLitCrop(page, recipe)
    assert.equal(rendered.state, 'rendered')
    assert.ok(rendered.whiteBalance)
    assert.equal(rendered.whiteBalance.heldBack, false, `${fixture.name} gains kept`)
    const gains = [
      rendered.whiteBalance.gains.red,
      rendered.whiteBalance.gains.green,
      rendered.whiteBalance.gains.blue,
    ]
    assert.deepEqual(
      gains.map((gain) => gain.toFixed(2)),
      fixture.gains!.map((gain) => gain.toFixed(2)),
      fixture.name,
    )
    const expected = await rgbRaster(await fixtureBytes(fixture.output))
    const actual = await rgbRaster((await derived(original, recipe)).bytes)
    assert.deepEqual(difference(actual, expected), { mean: 0, max: 0, farShare: 0 }, fixture.name)
  }
})

test('white balance reduces the cast on a neutral grey card', async () => {
  const original = await benchPhoto()
  const [fixture] = await cropFixtures((item) => item.name === 'wb-card')
  const plain = recipeForCrop({ ...fixture, wb: false }, original)
  const balanced = recipeForCrop(fixture, original)
  // The card spans (30, 250)-(130, 330) on the photo; the crop starts at (20, 230).
  const before = patchMean(await rgbRaster((await derived(original, plain)).bytes), 60, 60, 15)
  const after = patchMean(await rgbRaster((await derived(original, balanced)).bytes), 60, 60, 15)
  assert.ok(spread(before) > 15, `the card shows a cast: ${before.join(',')}`)
  assert.ok(spread(after) < spread(before) / 2, `cast reduced: ${after.join(',')}`)
})

test("the guard holds the script's own gains back where they would turn saturated parts", async () => {
  const original = await benchPhoto()
  const [fixture] = await cropFixtures((item) => item.guard_holds_back)
  const recipe = recipeForCrop(fixture, original)
  const page = (
    await decode({ version: 'media-decode/1', digest: original.digest, bytes: original.bytes })
  ).pages[0]
  const rendered = await renderLitCrop(page, recipe)
  assert.equal(rendered.state, 'rendered')
  assert.ok(rendered.whiteBalance?.heldBack)
  const gains = rendered.whiteBalance.gains
  for (const [index, gain] of [gains.red, gains.green, gains.blue].entries()) {
    const scripted = fixture.gains![index]
    assert.ok(
      Math.abs(gain - 1) < Math.abs(scripted - 1),
      `gain ${index} ${gain} is nearer 1 than ${scripted}`,
    )
  }
  const before = await rgbRaster((await derived(original, { ...recipe, light: NO_LIGHT })).bytes)
  const after: Raster = {
    width: rendered.image.info.width,
    height: rendered.image.info.height,
    data: rendered.image.data,
  }
  for (let offset = 0; offset < before.data.length; offset += 3) {
    const colour = [before.data[offset], before.data[offset + 1], before.data[offset + 2]] as const
    const brightest = Math.max(...colour)
    if (spread([...colour]) < 48 || spread([...colour]) < brightest / 2) {
      continue
    }
    const adjusted = [after.data[offset], after.data[offset + 1], after.data[offset + 2]] as const
    const shift = hueShift(hue(...colour)!, hue(...adjusted)!)
    assert.ok(shift <= MAX_BAND_HUE_SHIFT_DEGREES, `${colour.join(',')} moved ${shift.toFixed(2)}°`)
  }
})

test('the hue guard holds white balance back so resistor bands shift at most 5°', async () => {
  const page = await bandedPage([120, 130, 190])
  const recipe = wholePage(page, { white_balance: true })
  const rendered = await renderLitCrop(page, recipe)
  assert.equal(rendered.state, 'rendered')
  assert.ok(rendered.whiteBalance)
  assert.equal(rendered.whiteBalance.heldBack, true)
  const { red, blue } = rendered.whiteBalance.gains
  assert.ok(red > 1 && red < 1.15, `red gain ${red} is held below its bound`)
  assert.ok(blue < 1 && blue > 0.85, `blue gain ${blue} is held above its bound`)

  const output: Raster = {
    width: rendered.image.info.width,
    height: rendered.image.info.height,
    data: rendered.image.data,
  }
  for (const [index, colour] of Object.values(BANDS).entries()) {
    const after = pixelAt(output, index * 40 + 20, 60)
    const [red, green, blue] = colour
    const shift = hueShift(hue(red, green, blue)!, hue(...after)!)
    assert.ok(shift <= MAX_BAND_HUE_SHIFT_DEGREES, `band ${index} moved ${shift.toFixed(2)}°`)
  }
  const background = pixelAt(output, 4, 4)
  assert.ok(spread(background) < spread([120, 130, 190]), 'the cast is still reduced')
})

test('a white balance the guard cannot keep within 5° is refused, and so is its derivation', async () => {
  // A magenta-grey background pulls the gains to their bounds (red 0.85, green 1.15), and the
  // olive patch sits where even an eighth of that turns its hue by over 5°.
  const page = await solidPage(64, 64, (x, y) =>
    x < 8 && y < 8 ? [138, 134, 69] : [200, 120, 160],
  )
  const recipe = wholePage(page, { white_balance: true })
  const rendered = await renderLitCrop(page, recipe)
  assert.deepEqual(rendered, { state: 'refused', reason: 'white_balance_hue_guard' })
  const result = await decode({
    version: 'media-decode/1',
    digest: page.digest,
    bytes: page.bytes,
    recipe,
  })
  assert.equal(result.state, 'malformed')
})

for (const light of [
  { contrast_clip_permille: 20 },
  { gamma_thousandths: 1400 },
  { gamma_thousandths: 700 },
  { gamma_thousandths: 500 },
  { contrast_clip_permille: 50, gamma_thousandths: 500, sharpen: true },
  { sharpen: true },
  { contrast_clip_permille: 50, gamma_thousandths: 1500, sharpen: true },
]) {
  test(`luminance adjustment ${JSON.stringify(light)} keeps each colour's hue`, async () => {
    const colours = Object.values(BANDS)
    // Soft-edged band patches on a dim grey ramp, so contrast and gamma have range to work on, and a
    // row of dark saturated pixels that darkening could round to another hue or to grey.
    const page = await solidPage(280, 120, (x, y) => {
      const band = Math.floor(x / 40)
      if (y >= 100 && y < 110) {
        return [
          [48, 5, 0],
          [5, 48, 0],
          [0, 5, 48],
          [48, 0, 30],
          [60, 25, 0],
          [0, 50, 40],
          [50, 50, 0],
        ][band]
      }
      const inside = y >= 30 && y < 90 && x % 40 >= 6 && x % 40 < 34
      if (inside) {
        const shade = 0.7 + (0.3 * (y - 30)) / 60
        return colours[band].map((value) => Math.round(value * shade))
      }
      const grey = 40 + Math.round((x / 280) * 60)
      return [grey, grey, grey]
    })
    const recipe = wholePage(page, light)
    const rendered = await renderLitCrop(page, recipe)
    assert.equal(rendered.state, 'rendered')
    assert.equal(rendered.whiteBalance, null)
    const before = await rgbRaster(page.bytes)
    const after: Raster = {
      width: rendered.image.info.width,
      height: rendered.image.info.height,
      data: rendered.image.data,
    }
    let changed = 0
    for (let y = 0; y < page.height; y++) {
      for (let x = 0; x < page.width; x++) {
        const original = pixelAt(before, x, y)
        const adjusted = pixelAt(after, x, y)
        const saturated = spread(original) >= 48 && spread(original) >= Math.max(...original) / 2
        if (!saturated) {
          continue
        }
        if (adjusted.some((value, channel) => value !== original[channel])) {
          changed++
        }
        const shift = hueShift(hue(...original)!, hue(...adjusted)!)
        assert.ok(shift <= LUMINANCE_HUE_TOLERANCE_DEGREES, `${x},${y} moved ${shift.toFixed(2)}°`)
      }
    }
    assert.ok(changed > 0, 'the adjustment changed coloured pixels')
  })
}

test('gamma lifts and darkens the midtones', async () => {
  const page = await solidPage(32, 32, () => [100, 100, 100])
  const lifted = await renderLitCrop(page, wholePage(page, { gamma_thousandths: 1500 }))
  const darkened = await renderLitCrop(page, wholePage(page, { gamma_thousandths: 600 }))
  assert.equal(lifted.state, 'rendered')
  assert.equal(darkened.state, 'rendered')
  assert.ok(lifted.image.data[0] > 100)
  assert.ok(darkened.image.data[0] < 100)
})

test('a straightened, lit crop is cut from the upright source with its bands kept', async () => {
  const original = await benchPhoto()
  // The resistor body spans (170, 182)-(310, 218); its brown band is at x 190-202.
  const geometry = {
    region: [150, 150, 330, 250] as [number, number, number, number],
    quarter_turns: 1,
    straighten: -3.5,
  }
  const lit = recipeForCrop({ ...geometry, wb: true }, original)
  const unlit = recipeForCrop({ ...geometry, wb: false }, original)
  const layout = viewLayout(lit, 'full')
  const litPage = await derived(original, lit)
  const unlitPage = await derived(original, unlit)
  assert.deepEqual([litPage.width, litPage.height], [layout.width, layout.height])
  assert.ok(litPage.height > litPage.width, 'one quarter turn stands the crop upright')

  const litPixels = await rgbRaster(litPage.bytes)
  const unlitPixels = await rgbRaster(unlitPage.bytes)
  for (const [x, y] of [
    [0, 0],
    [litPixels.width - 1, 0],
    [0, litPixels.height - 1],
    [litPixels.width - 1, litPixels.height - 1],
  ]) {
    assert.notDeepEqual(pixelAt(unlitPixels, x, y), [255, 255, 255], `corner ${x},${y} is photo`)
  }
  // After a clockwise quarter turn, source (x, y) in the region lands at (bottom - y, x).
  const bandX = 100 - (200 - 150)
  const bandY = 196 - 150
  const before = pixelAt(unlitPixels, bandX, bandY)
  const after = pixelAt(litPixels, bandX, bandY)
  const shift = hueShift(hue(...before)!, hue(...after)!)
  assert.ok(shift <= MAX_BAND_HUE_SHIFT_DEGREES, `brown band moved ${shift.toFixed(2)}°`)
  const backgroundBefore = patchMean(unlitPixels, 10, 10, 4)
  const backgroundAfter = patchMean(litPixels, 10, 10, 4)
  assert.ok(spread(backgroundAfter) < spread(backgroundBefore), 'the warm cast is reduced')
})

test('a straightened crop at the page edge is shrunk by the corner guard, never padded', async () => {
  const page = await solidPage(400, 300, (x, y) =>
    x < 200 === y < 150 ? [200, 40, 40] : [40, 40, 200],
  )
  const recipe = recipeForCrop(
    { region: [0, 0, 400, 150], quarter_turns: 0, straighten: 10, wb: false },
    page,
  )
  const layout = viewLayout(recipe, 'full')
  assert.ok(layout.guard < 1)
  const rendered = await renderLitCrop(page, recipe)
  assert.equal(rendered.state, 'rendered')
  assert.equal(rendered.cornerGuard, true)
  const image: Raster = {
    width: rendered.image.info.width,
    height: rendered.image.info.height,
    data: rendered.image.data,
  }
  assert.deepEqual([image.width, image.height], [layout.width, layout.height])
  for (let x = 0; x < image.width; x += 5) {
    for (const y of [0, image.height - 1]) {
      assert.notDeepEqual(pixelAt(image, x, y), [255, 255, 255], `edge ${x},${y}`)
    }
  }
})

test('a derived crop renders at full resolution beyond the question view size', async () => {
  const page = await solidPage(2600, 300, (x) => [x % 256, 90, 160])
  const recipe = wholePage(page, {})
  const derivedPage = await derived(page, recipe)
  assert.deepEqual([derivedPage.width, derivedPage.height], [2600, 300])
  assert.deepEqual((await rgbRaster(derivedPage.bytes)).data, (await rgbRaster(page.bytes)).data)
})

test('the preview render and the derived crop are the same pixels', async () => {
  const original = await benchPhoto()
  const [fixture] = await cropFixtures((item) => item.name === 'straight-neg-3.5')
  const recipe = recipeForCrop(fixture, original)
  recipe.light = {
    white_balance: true,
    contrast_clip_permille: 10,
    gamma_thousandths: 1200,
    sharpen: true,
  }
  const page = (
    await decode({ version: 'media-decode/1', digest: original.digest, bytes: original.bytes })
  ).pages[0]
  const previewed = await renderLitCrop(page, recipe)
  assert.equal(previewed.state, 'rendered')
  const derivedPage = await rgbRaster((await derived(original, recipe)).bytes)
  assert.deepEqual(
    [previewed.image.info.width, previewed.image.info.height],
    [derivedPage.width, derivedPage.height],
  )
  assert.ok(previewed.image.data.equals(derivedPage.data))
})

test('a recipe /2 that does not fit its page derives as malformed', async () => {
  const original = await benchPhoto()
  const fitting = recipeForCrop(
    { region: [0, 0, 100, 100], quarter_turns: 0, straighten: 0, wb: false },
    original,
  )
  const misfits: MediaLitViewRecipeDto[] = [
    { ...fitting, page_width: original.width + 1 },
    { ...fitting, page: 2 },
    { ...fitting, view: { ...fitting.view, region: { x: 400, y: 0, width: 100, height: 100 } } },
  ]
  for (const recipe of misfits) {
    const result = await decode({
      version: 'media-decode/1',
      digest: original.digest,
      bytes: original.bytes,
      recipe,
    })
    assert.equal(result.state, 'malformed', JSON.stringify(recipe.view.region))
  }
})

/** The largest hue turn, from source to output, over pixels saturated in the source. */
function largestSaturatedShift(before: Raster, after: Raster) {
  let largest = 0
  for (let offset = 0; offset < before.data.length; offset += 3) {
    const source = [before.data[offset], before.data[offset + 1], before.data[offset + 2]] as const
    const brightest = Math.max(...source)
    if (spread([...source]) < 48 || spread([...source]) < brightest / 2) {
      continue
    }
    const output = [after.data[offset], after.data[offset + 1], after.data[offset + 2]] as const
    const turned = hue(...output)
    largest = Math.max(largest, turned === null ? 180 : hueShift(hue(...source)!, turned))
  }
  return largest
}

for (const [name, paint, light] of [
  [
    'white balance then deep gamma',
    (x: number) => (x < 4 ? [48, 7, 0] : [120, 130, 170]),
    { white_balance: true, gamma_thousandths: 500 },
  ],
  [
    'autocontrast beside white',
    (x: number) => (x < 4 ? [110, 30, 22] : [255, 255, 255]),
    { contrast_clip_permille: 0 },
  ],
  [
    'every adjustment on dark bands',
    (x: number) =>
      [
        [48, 7, 0],
        [7, 48, 0],
        [0, 7, 48],
        [110, 30, 22],
        [90, 140, 200],
      ][x % 5],
    { white_balance: true, contrast_clip_permille: 50, gamma_thousandths: 500, sharpen: true },
  ],
] as const) {
  test(`the light step keeps saturated hues within 5° of the source: ${name}`, async () => {
    const page = await solidPage(40, 8, (x) => paint(x))
    const rendered = await renderLitCrop(page, wholePage(page, light))
    assert.ok(rendered.state === 'rendered')
    const after: Raster = {
      width: rendered.image.info.width,
      height: rendered.image.info.height,
      data: rendered.image.data,
    }
    const shift = largestSaturatedShift(await rgbRaster(page.bytes), after)
    assert.ok(shift <= MAX_BAND_HUE_SHIFT_DEGREES, `turned ${shift.toFixed(2)}°`)
  })
}

test('a recipe /2 on an EXIF-oriented photo crops the upright source, then turns', async () => {
  // Upright, the photo is 300 × 200 with a red block top right and a blue block bottom left.
  const upright = await solidPage(300, 200, (x, y) => {
    if (x >= 200 && x < 240 && y >= 40 && y < 70) {
      return [210, 30, 30]
    }
    if (x >= 20 && x < 60 && y >= 140 && y < 180) {
      return [30, 50, 210]
    }
    return [128, 128, 128]
  })
  // Stored turned a quarter anticlockwise, with EXIF orientation 6 saying to turn it back.
  const stored = await sharp(upright.bytes)
    .rotate(270)
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer()
  assert.equal((await sharp(stored).metadata()).orientation, 6)
  const original = { bytes: stored, digest: sha(stored), width: 300, height: 200 }
  const region: [number, number, number, number] = [180, 20, 280, 90]
  const recipe = recipeForCrop({ region, quarter_turns: 1, straighten: 0, wb: false }, original)
  const page = await derived(original, recipe)
  assert.deepEqual([page.width, page.height], [70, 100])

  const expected = await rgbRaster(
    await sharp(upright.bytes)
      .extract({ left: 180, top: 20, width: 100, height: 70 })
      .rotate(90)
      .png()
      .toBuffer(),
  )
  const actual = await rgbRaster(page.bytes)
  assert.ok(difference(actual, expected, 24).farShare < 0.02, 'the turned crop shows the red block')
  // The red block, at region x 20-60 and y 20-50, lands at x 20-50 and y 20-60 after the turn.
  const red = pixelAt(actual, 35, 40)
  assert.ok(red[0] > 150 && red[2] < 90, `red block at its turned place: ${red.join(',')}`)
  assert.equal((await rgbRaster(original.bytes)).width, 200, 'the stored original is unchanged')
})

test('gamma 1000 is the identity: it changes no pixel and takes none of the hue budget', async () => {
  const original = await benchPhoto()
  const [fixture] = await cropFixtures((item) => item.guard_holds_back)
  const plain = recipeForCrop(fixture, original)
  const neutral = { ...plain, light: { ...plain.light, gamma_thousandths: 1000 } }
  const plainPage = await derived(original, plain)
  const neutralPage = await derived(original, neutral)
  assert.ok(plainPage.bytes.equals(neutralPage.bytes))
})

/** A brightest channel and a channel spread of at least 16 levels each make a hue meaningful in 8 bits. */
const LUMINANCE_FLOOR_LEVELS = 16

for (const light of [
  { gamma_thousandths: 500 },
  { gamma_thousandths: 1800 },
  { contrast_clip_permille: 50, gamma_thousandths: 500, sharpen: true },
]) {
  test(`luminance ${JSON.stringify(light)} holds every pixel at or above the hue floor within 5°`, async () => {
    // At the floor and just above it, under the guard's 48-level cutoff; then a ramp of dim colours.
    const colours = [
      [47, 5, 0],
      [16, 0, 0],
      [16, 16, 0],
      [40, 24, 24],
      [0, 20, 36],
      [30, 14, 2],
    ]
    const page = await solidPage(48, 8, (x) => colours[x % colours.length])
    const rendered = await renderLitCrop(page, wholePage(page, light))
    assert.ok(rendered.state === 'rendered')
    const before = await rgbRaster(page.bytes)
    const after: Raster = {
      width: rendered.image.info.width,
      height: rendered.image.info.height,
      data: rendered.image.data,
    }
    for (let x = 0; x < page.width; x++) {
      const source = pixelAt(before, x, 4)
      const output = pixelAt(after, x, 4)
      const turned = hue(...output)
      const shift = turned === null ? 180 : hueShift(hue(...source)!, turned)
      assert.ok(
        shift <= MAX_BAND_HUE_SHIFT_DEGREES,
        `${source.join(',')} -> ${output.join(',')} turned ${shift.toFixed(2)}°`,
      )
    }
  })
}

test('below the hue floor a pixel is not protected: gamma may darken it to grey, never brighten it', async () => {
  const below = [
    [15, 2, 0],
    [40, 30, 26],
  ]
  for (const colour of below) {
    const brightest = Math.max(...colour)
    assert.ok(brightest < LUMINANCE_FLOOR_LEVELS || spread(colour) < LUMINANCE_FLOOR_LEVELS)
  }
  const page = await solidPage(2, 1, (x) => below[x])
  const rendered = await renderLitCrop(page, wholePage(page, { gamma_thousandths: 500 }))
  assert.ok(rendered.state === 'rendered')
  const after: Raster = { width: 2, height: 1, data: rendered.image.data }
  for (const [index, colour] of below.entries()) {
    const output = pixelAt(after, index, 0)
    assert.ok(Math.max(...output) < Math.max(...colour), `${output.join(',')} is darkened`)
    assert.ok(spread(output) < 12, `${output.join(',')} keeps no protected spread`)
  }
})
