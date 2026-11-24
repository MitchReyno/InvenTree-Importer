import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { MEDIA_TOOLCHAIN, type MediaLitViewRecipeDto } from '@invimport/contracts/media'
import { decode } from '../src/decode.ts'
import { renderLitCrop } from '../src/lit-crop.ts'
import { MONTAGE_GEOMETRY, renderPreview } from '../src/preview.ts'
import type { PreviewCropOutcome, PreviewInput } from '../src/decoder-protocol.ts'
import {
  difference,
  fixtureBytes,
  NO_LIGHT,
  parityFixtures,
  recipeForCrop,
  rgbRaster,
  sha,
  sourceOf,
  type Raster,
} from './support/parity.ts'

async function benchPage() {
  const fixtures = await parityFixtures()
  const original = await fixtureBytes(fixtures.photo)
  const decoded = await decode({
    version: 'media-decode/1',
    digest: sha(original),
    bytes: original,
  })
  assert.equal(decoded.state, 'ready')
  const page = decoded.pages[0]
  return { originalDigest: sha(original), page, digest: sha(page.bytes) }
}

function recipe(
  bench: Awaited<ReturnType<typeof benchPage>>,
  region: [number, number, number, number],
  options: {
    quarterTurns?: number
    straighten?: number
    light?: Partial<MediaLitViewRecipeDto['light']>
  } = {},
): MediaLitViewRecipeDto {
  const base = recipeForCrop(
    {
      region,
      quarter_turns: options.quarterTurns ?? 0,
      straighten: options.straighten ?? 0,
      wb: false,
    },
    { width: bench.page.width, height: bench.page.height, digest: bench.originalDigest },
  )
  return { ...base, light: { ...NO_LIGHT, ...options.light } }
}

function previewInput(
  bench: Awaited<ReturnType<typeof benchPage>>,
  crops: PreviewInput['crops'],
): PreviewInput {
  return {
    version: 'media-preview/1',
    pages: [
      {
        ...sourceOf(recipe(bench, [0, 0, 1, 1])),
        digest: bench.digest,
        width: bench.page.width,
        height: bench.page.height,
        bytes: bench.page.bytes,
      },
    ],
    crops,
  }
}

function cellOrigin(index: number) {
  const { cell, columns, labelHeight, inset } = MONTAGE_GEOMETRY
  return {
    x: (index % columns) * cell + inset,
    y: Math.floor(index / columns) * (cell + labelHeight) + inset,
  }
}

async function cell(
  montage: Buffer,
  index: number,
  width: number,
  height: number,
): Promise<Raster> {
  const origin = cellOrigin(index)
  return rgbRaster(
    await sharp(montage).extract({ left: origin.x, top: origin.y, width, height }).png().toBuffer(),
  )
}

test('the montage depicts each crop exactly as it renders for derivation', async () => {
  const bench = await benchPage()
  const crops = [
    {
      label: 'resistor',
      page: 0,
      recipe: recipe(bench, [150, 160, 330, 240], {
        quarterTurns: 1,
        straighten: -3.5,
        light: { white_balance: true },
      }),
    },
    {
      label: 'chip',
      page: 0,
      recipe: recipe(bench, [290, 50, 430, 150], {
        light: { gamma_thousandths: 1300, sharpen: true },
      }),
    },
  ]
  const result = await renderPreview(previewInput(bench, crops))
  assert.ok(result.state === 'ready')
  assert.equal(result.toolchain, MEDIA_TOOLCHAIN)
  assert.equal((await sharp(result.montage.bytes).metadata()).format, 'png')

  for (const [index, crop] of crops.entries()) {
    const rendered = await renderLitCrop(bench.page, crop.recipe)
    assert.equal(rendered.state, 'rendered')
    const outcome: PreviewCropOutcome = result.crops[index]
    assert.ok(outcome.state === 'rendered')
    assert.equal(outcome.label, crop.label)
    assert.deepEqual(
      [outcome.width, outcome.height],
      [rendered.image.info.width, rendered.image.info.height],
    )
    const thumbnail = await rgbRaster(
      await sharp(rendered.image.data, { raw: rendered.image.info })
        .resize({
          width: MONTAGE_GEOMETRY.cell - 2 * MONTAGE_GEOMETRY.inset,
          height: MONTAGE_GEOMETRY.cell - 2 * MONTAGE_GEOMETRY.inset,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer(),
    )
    const shown = await cell(result.montage.bytes, index, thumbnail.width, thumbnail.height)
    assert.deepEqual(difference(shown, thumbnail), { mean: 0, max: 0, farShare: 0 }, crop.label)
  }
  const [resistor, chip] = result.crops
  assert.ok(resistor.state === 'rendered' && resistor.white_balance_gains !== null)
  assert.ok(chip.state === 'rendered' && chip.white_balance_gains === null)
})

test('each crop is labelled with its name and size under its cell', async () => {
  const bench = await benchPage()
  const result = await renderPreview(
    previewInput(bench, [{ label: 'label', page: 0, recipe: recipe(bench, [0, 0, 120, 120]) }]),
  )
  assert.equal(result.state, 'ready')
  const { cell: size, labelHeight } = MONTAGE_GEOMETRY
  const strip = await rgbRaster(
    await sharp(result.montage.bytes)
      .extract({ left: 0, top: size, width: size, height: labelHeight })
      .png()
      .toBuffer(),
  )
  const dark = [...strip.data].filter((value) => value < 128).length
  assert.ok(dark > 50, 'the label strip has text')
})

test('a crop at the page edge reports the corner guard', async () => {
  const bench = await benchPage()
  const result = await renderPreview(
    previewInput(bench, [
      { label: 'edge', page: 0, recipe: recipe(bench, [0, 0, 480, 120], { straighten: 8 }) },
    ]),
  )
  assert.equal(result.state, 'ready')
  const [edge] = result.crops
  assert.equal(edge.state, 'rendered')
  assert.deepEqual(edge.flags, ['corner_guard'])
})

test('a refused crop is reported and the others still render', async () => {
  const pixels = Buffer.alloc(64 * 64 * 3)
  for (let index = 0; index < 64 * 64; index++) {
    const patch = index % 64 < 8 && index < 64 * 8
    pixels.set(patch ? [138, 134, 69] : [200, 120, 160], index * 3)
  }
  const bytes = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } })
    .png()
    .toBuffer()
  const base = recipeForCrop(
    { region: [0, 0, 64, 64], quarter_turns: 0, straighten: 0, wb: false },
    { width: 64, height: 64, digest: sha(bytes) },
  )
  const page = { ...sourceOf(base), digest: sha(bytes), width: 64, height: 64, bytes }
  const result = await renderPreview({
    version: 'media-preview/1',
    pages: [page],
    crops: [
      {
        label: 'refused',
        page: 0,
        recipe: { ...base, light: { ...NO_LIGHT, white_balance: true } },
      },
      { label: 'plain', page: 0, recipe: base },
    ],
  })
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.crops[0], {
    state: 'refused',
    label: 'refused',
    reason: 'white_balance_hue_guard',
  })
  assert.equal(result.crops[1].state, 'rendered')
})

test('crops on two pages render from their own page', async () => {
  const bench = await benchPage()
  const second = await sharp({
    create: { width: 50, height: 40, channels: 3, background: '#2050c0' },
  })
    .png()
    .toBuffer()
  const secondRecipe = {
    ...recipeForCrop(
      { region: [0, 0, 50, 40], quarter_turns: 0, straighten: 0, wb: false },
      { width: 50, height: 40, digest: 'b'.repeat(64) },
    ),
    source_version_id: '00000000-0000-4000-8000-000000000004',
  }
  const input = previewInput(bench, [
    { label: 'photo', page: 0, recipe: recipe(bench, [0, 0, 100, 100]) },
    { label: 'card', page: 1, recipe: secondRecipe },
  ])
  input.pages.push({
    ...sourceOf(secondRecipe),
    digest: sha(second),
    width: 50,
    height: 40,
    bytes: second,
  })
  const result = await renderPreview(input)
  assert.equal(result.state, 'ready')
  const shown = await cell(result.montage.bytes, 1, 50, 40)
  assert.deepEqual([...shown.data.subarray(0, 3)], [0x20, 0x50, 0xc0])
})

test('a recipe naming another page of the same size is malformed, not rendered from this one', async () => {
  const red = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c02020' } })
    .png()
    .toBuffer()
  const blue = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#2020c0' },
  })
    .png()
    .toBuffer()
  const redRecipe = recipeForCrop(
    { region: [0, 0, 40, 30], quarter_turns: 0, straighten: 0, wb: false },
    { width: 40, height: 30, digest: 'd'.repeat(64) },
  )
  const blueSource = { ...sourceOf(redRecipe), source_digest: 'e'.repeat(64) }
  const result = await renderPreview({
    version: 'media-preview/1',
    pages: [
      { ...sourceOf(redRecipe), digest: sha(red), width: 40, height: 30, bytes: red },
      { ...blueSource, digest: sha(blue), width: 40, height: 30, bytes: blue },
    ],
    crops: [{ label: 'swapped', page: 1, recipe: redRecipe }],
  })
  assert.deepEqual(result, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
  for (const changed of [
    { page: 2 },
    { source_version_id: '00000000-0000-4000-8000-000000000003' },
  ]) {
    const other = await renderPreview({
      version: 'media-preview/1',
      pages: [
        { ...sourceOf(redRecipe), ...changed, digest: sha(red), width: 40, height: 30, bytes: red },
      ],
      crops: [{ label: 'other', page: 0, recipe: redRecipe }],
    })
    assert.deepEqual(other, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
  }
})

test('two slots claiming the same evidence page with different pixels are malformed', async () => {
  const red = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c02020' } })
    .png()
    .toBuffer()
  const blue = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#2020c0' },
  })
    .png()
    .toBuffer()
  const redRecipe = recipeForCrop(
    { region: [0, 0, 40, 30], quarter_turns: 0, straighten: 0, wb: false },
    { width: 40, height: 30, digest: 'd'.repeat(64) },
  )
  const result = await renderPreview({
    version: 'media-preview/1',
    pages: [
      { ...sourceOf(redRecipe), digest: sha(red), width: 40, height: 30, bytes: red },
      { ...sourceOf(redRecipe), digest: sha(blue), width: 40, height: 30, bytes: blue },
    ],
    crops: [
      { label: 'first', page: 0, recipe: redRecipe },
      { label: 'second', page: 1, recipe: redRecipe },
    ],
  })
  assert.deepEqual(result, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
})

test('two slots giving one evidence version different originals are malformed', async () => {
  const red = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c02020' } })
    .png()
    .toBuffer()
  const first = recipeForCrop(
    { region: [0, 0, 40, 30], quarter_turns: 0, straighten: 0, wb: false },
    { width: 40, height: 30, digest: 'd'.repeat(64) },
  )
  const second = { ...first, page: 2, source_digest: 'e'.repeat(64) }
  const result = await renderPreview({
    version: 'media-preview/1',
    pages: [
      { ...sourceOf(first), digest: sha(red), width: 40, height: 30, bytes: red },
      { ...sourceOf(second), digest: sha(red), width: 40, height: 30, bytes: red },
    ],
    crops: [
      { label: 'first', page: 0, recipe: first },
      { label: 'second', page: 1, recipe: second },
    ],
  })
  assert.deepEqual(result, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
})

test('a recipe that does not fit its page is malformed', async () => {
  const bench = await benchPage()
  const wrong = recipe(bench, [0, 0, 100, 100])
  wrong.page_width = bench.page.width + 1
  const result = await renderPreview(
    previewInput(bench, [{ label: 'wrong', page: 0, recipe: wrong }]),
  )
  assert.deepEqual(result, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
  const missing = await renderPreview(
    previewInput(bench, [{ label: 'missing', page: 1, recipe: recipe(bench, [0, 0, 10, 10]) }]),
  )
  assert.deepEqual(missing, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
})

test('page bytes that do not match their digest are refused before rendering', async () => {
  const bench = await benchPage()
  const input = previewInput(bench, [
    { label: 'any', page: 0, recipe: recipe(bench, [0, 0, 10, 10]) },
  ])
  input.pages[0].digest = 'c'.repeat(64)
  await assert.rejects(renderPreview(input), /invalid_decode_input/)
})

/** The bounds of the non-white pixels in one montage cell, above its label strip. */
function shownBounds(sheet: Raster, index: number) {
  const { cell, columns, labelHeight } = MONTAGE_GEOMETRY
  const left = (index % columns) * cell
  const top = Math.floor(index / columns) * (cell + labelHeight)
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = top; y < top + cell; y++) {
    for (let x = left; x < left + cell; x++) {
      const offset = (y * sheet.width + x) * 3
      const white =
        sheet.data[offset] === 255 &&
        sheet.data[offset + 1] === 255 &&
        sheet.data[offset + 2] === 255
      if (!white) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function cutRaster(sheet: Raster, bounds: ReturnType<typeof shownBounds>): Raster {
  const data = Buffer.alloc(bounds.width * bounds.height * 3)
  for (let row = 0; row < bounds.height; row++) {
    const start = ((bounds.y + row) * sheet.width + bounds.x) * 3
    sheet.data.copy(data, row * bounds.width * 3, start, start + bounds.width * 3)
  }
  return { width: bounds.width, height: bounds.height, data }
}

test('the montage lays crops out as montage.py does', async () => {
  const bench = await benchPage()
  const fixtures = await parityFixtures()
  const named = fixtures.montage.crops.map((name) =>
    fixtures.crops.find((item) => item.name === name)!,
  )
  const crops = [
    { label: 'photo', page: 0, recipe: recipe(bench, [0, 0, bench.page.width, bench.page.height]) },
    ...named.map((fixture) => ({
      label: fixture.name,
      page: 0,
      recipe: recipe(bench, fixture.region, { quarterTurns: fixture.quarter_turns }),
    })),
  ]
  const result = await renderPreview(previewInput(bench, crops))
  assert.ok(result.state === 'ready')
  const ours = await rgbRaster(result.montage.bytes)
  const script = await rgbRaster(await fixtureBytes(fixtures.montage.output))
  assert.deepEqual([ours.width, ours.height], [script.width, script.height])
  for (const index of crops.keys()) {
    const expected = shownBounds(script, index)
    const shown = shownBounds(ours, index)
    assert.deepEqual(shown, expected, `cell ${index} placement and size`)
    // Pillow and libvips downscale with different filters, so the pixels agree only closely.
    const measured = difference(cutRaster(ours, shown), cutRaster(script, expected), 8)
    assert.ok(measured.mean <= 3, `cell ${index} mean ${measured.mean}`)
  }
})
