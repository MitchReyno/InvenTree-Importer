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
  const page = { digest: sha(bytes), width: 64, height: 64, bytes }
  const base = recipeForCrop(
    { region: [0, 0, 64, 64], quarter_turns: 0, straighten: 0, wb: false },
    { width: 64, height: 64, digest: sha(bytes) },
  )
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
  const secondRecipe = recipeForCrop(
    { region: [0, 0, 50, 40], quarter_turns: 0, straighten: 0, wb: false },
    { width: 50, height: 40, digest: 'b'.repeat(64) },
  )
  const input = previewInput(bench, [
    { label: 'photo', page: 0, recipe: recipe(bench, [0, 0, 100, 100]) },
    { label: 'card', page: 1, recipe: secondRecipe },
  ])
  input.pages.push({ digest: sha(second), width: 50, height: 40, bytes: second })
  const result = await renderPreview(input)
  assert.equal(result.state, 'ready')
  const shown = await cell(result.montage.bytes, 1, 50, 40)
  assert.deepEqual([...shown.data.subarray(0, 3)], [0x20, 0x50, 0xc0])
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
