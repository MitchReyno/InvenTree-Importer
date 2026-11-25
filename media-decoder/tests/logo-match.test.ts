import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  assertMediaLogoMatchOutputHeader,
  MEDIA_TOOLCHAIN,
  type MediaViewGeometryDto,
} from '@invimport/contracts/media'
import { LOGO_SET_DIRECTORY, matchLogo, SHEET_GEOMETRY } from '../src/logo-match.ts'
import type { LogoMatchInput } from '../src/decoder-protocol.ts'
import { fixtureBytes, parityFixtures, sha } from './support/parity.ts'

const SKILL_DATA = new URL('../../.claude/skills/chip-logo-identification/data/', import.meta.url)

async function logoInput(
  bytes: Buffer,
  view: Partial<MediaViewGeometryDto> = {},
  top = 5,
): Promise<LogoMatchInput> {
  const metadata = await sharp(bytes).metadata()
  return {
    version: 'media-logo-match/1',
    digest: sha(bytes),
    width: metadata.width,
    height: metadata.height,
    bytes,
    view: {
      region: { x: 0, y: 0, width: metadata.width, height: metadata.height },
      quarter_turns: 0,
      straighten_millidegrees: 0,
      ...view,
    },
    top,
  }
}

const { columns: SHEET_COLUMNS, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT } = SHEET_GEOMETRY

interface Grey {
  data: Buffer
  info: { width: number; height: number }
}

async function sheetPixels(bytes: Buffer) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width }
}

type Sheet = Awaited<ReturnType<typeof sheetPixels>>

function countIn(
  sheet: Sheet,
  tile: number,
  rows: [number, number],
  matches: (red: number, green: number, blue: number) => boolean,
) {
  let found = 0
  const left = (tile % SHEET_COLUMNS) * CELL_WIDTH
  const top = Math.floor(tile / SHEET_COLUMNS) * CELL_HEIGHT
  for (let y = top + rows[0]; y < top + rows[1]; y++) {
    for (let x = left + 4; x < left + CELL_WIDTH - 4; x++) {
      const offset = (y * sheet.width + x) * 3
      if (matches(sheet.data[offset], sheet.data[offset + 1], sheet.data[offset + 2])) {
        found++
      }
    }
  }
  return found
}

const isMarkInk = (red: number, green: number, blue: number) =>
  red > 150 && green > 150 && blue > 150
const isTitleInk = (red: number, green: number, blue: number) =>
  red > 200 && green > 150 && blue < 80
const isMakerInk = (red: number, green: number, blue: number) =>
  red > 150 && Math.abs(red - green) < 20 && Math.abs(red - blue) < 20

/** A tile's mark area, above its title, as greyscale. */
function tileGrey(sheet: Sheet, tile: number): Grey {
  const left = (tile % SHEET_COLUMNS) * CELL_WIDTH + 4
  const top = Math.floor(tile / SHEET_COLUMNS) * CELL_HEIGHT + 4
  const width = CELL_WIDTH - 8
  const height = 96
  const data = Buffer.alloc(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = ((top + y) * sheet.width + left + x) * 3
      data[y * width + x] = Math.round(
        (sheet.data[offset] + sheet.data[offset + 1] + sheet.data[offset + 2]) / 3,
      )
    }
  }
  return { data, info: { width, height } }
}

/** The bright mark's bounds, scaled to 24 × 24 and centred, as a unit vector. */
function markShape(image: Grey): Float64Array {
  const { width, height } = image.info
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (image.data[y * width + x] > 128) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  const side = 24
  const shape = new Float64Array(side * side)
  if (right < 0) {
    return shape
  }
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sourceX = left + Math.floor(((x + 0.5) * (right - left + 1)) / side)
      const sourceY = top + Math.floor(((y + 0.5) * (bottom - top + 1)) / side)
      shape[y * side + x] = image.data[sourceY * width + sourceX] > 128 ? 1 : 0
    }
  }
  const mean = shape.reduce((sum, value) => sum + value, 0) / shape.length
  const norm = Math.sqrt(shape.reduce((sum, value) => sum + (value - mean) ** 2, 0)) || 1
  return shape.map((value) => (value - mean) / norm)
}

function correlation(left: Float64Array, right: Float64Array) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

test('the bundled logo set is the skill reference set, byte for byte', async () => {
  const bundledIndex = await readFile(new URL('index.json', LOGO_SET_DIRECTORY))
  assert.ok(bundledIndex.equals(await readFile(new URL('index.json', SKILL_DATA))))
  const index = JSON.parse(bundledIndex.toString('utf8')) as { file: string }[]
  const bundledLogos = await readdir(new URL('logos/', LOGO_SET_DIRECTORY))
  assert.equal(bundledLogos.length, index.length)
  for (const entry of index) {
    const bundled = await readFile(new URL(entry.file, LOGO_SET_DIRECTORY))
    assert.ok(bundled.equals(await readFile(new URL(entry.file, SKILL_DATA))), entry.file)
  }
})

test('degraded logos rank their maker first, as the script ranks them', async () => {
  const fixtures = await parityFixtures()
  for (const fixture of fixtures.logos) {
    assert.equal(fixture.top[0], fixture.id, `the script ranks ${fixture.query} correctly`)
    const result = await matchLogo(await logoInput(await fixtureBytes(fixture.query)))
    assert.equal(result.state, 'ready')
    assert.equal(result.toolchain, MEDIA_TOOLCHAIN)
    assert.equal(result.candidates.length, 5)
    assert.equal(
      result.candidates[0].id,
      fixture.id,
      `${fixture.query} ranked ${result.candidates.map((item) => item.id).join(',')}`,
    )
    const scores = result.candidates.map((item) => item.score)
    assert.deepEqual(
      [...scores].sort((left, right) => right - left),
      scores,
    )
  }
})

test('a mark photographed sideways matches once the view turns it upright', async () => {
  const fixtures = await parityFixtures()
  const fixture = fixtures.logos.find((item) => item.degradation === 'etched')!
  const sideways = await sharp(await fixtureBytes(fixture.query))
    .rotate(90)
    .png()
    .toBuffer()
  const result = await matchLogo(await logoInput(sideways, { quarter_turns: 3 }))
  assert.equal(result.state, 'ready')
  assert.equal(result.candidates[0].id, fixture.id)
})

test('candidates carry their maker and the sheet shows the query and each candidate', async () => {
  const fixtures = await parityFixtures()
  const [fixture] = fixtures.logos
  const result = await matchLogo(await logoInput(await fixtureBytes(fixture.query), {}, 7))
  assert.equal(result.state, 'ready')
  const index = JSON.parse(await readFile(new URL('index.json', LOGO_SET_DIRECTORY), 'utf8')) as {
    id: string
    manufacturer: string
    family: string
    page: string
  }[]
  const first = index.find((entry) => entry.id === result.candidates[0].id)!
  assert.deepEqual(
    {
      id: result.candidates[0].id,
      manufacturer: result.candidates[0].manufacturer,
      family: result.candidates[0].family,
      page: result.candidates[0].page,
    },
    { id: first.id, manufacturer: first.manufacturer, family: first.family, page: first.page },
  )
  const { columns, cellWidth, cellHeight } = SHEET_GEOMETRY
  const rows = Math.ceil((7 + 1) / columns)
  const sheet = await sharp(result.sheet.bytes).metadata()
  assert.equal(sheet.format, 'png')
  assert.deepEqual([sheet.width, sheet.height], [columns * cellWidth, rows * cellHeight])
  assert.deepEqual([result.sheet.width, result.sheet.height], [sheet.width, sheet.height])

  // Every occupied tile shows a mark, a yellow title and, for a candidate, its maker in light grey,
  // and each candidate's mark is its own ranked logo rather than another's.
  assert.equal(result.candidates.length, 7, 'every requested candidate is returned')
  const sheetRaster = await sheetPixels(result.sheet.bytes)
  for (let tile = 0; tile <= result.candidates.length; tile++) {
    assert.ok(countIn(sheetRaster, tile, [5, 100], isMarkInk) > 30, `tile ${tile} shows a mark`)
    assert.ok(countIn(sheetRaster, tile, [100, 118], isTitleInk) > 20, `tile ${tile} has its title`)
    if (tile > 0) {
      assert.ok(
        countIn(sheetRaster, tile, [118, 136], isMakerInk) > 20,
        `tile ${tile} names its maker`,
      )
    }
  }
  const references = await Promise.all(
    result.candidates.map(async (candidate) => {
      const bytes = await readFile(new URL(`logos/${candidate.id}.gif`, LOGO_SET_DIRECTORY))
      return markShape(
        await sharp(bytes).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true }),
      )
    }),
  )
  for (const [index, candidate] of result.candidates.entries()) {
    const shown = markShape(tileGrey(sheetRaster, index + 1))
    const correlations = references.map((reference) => correlation(shown, reference))
    const best = correlations.indexOf(Math.max(...correlations))
    assert.equal(best, index, `tile ${index + 1} shows ${candidate.id}`)
  }
})

test('a blank region has no candidates', async () => {
  const blank = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#404040' },
  })
    .png()
    .toBuffer()
  const result = await matchLogo(await logoInput(blank))
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.candidates, [])
})

test('a view outside its page is malformed', async () => {
  const fixtures = await parityFixtures()
  const bytes = await fixtureBytes(fixtures.logos[0].query)
  const input = await logoInput(bytes)
  input.view.region.width += 1
  assert.deepEqual(await matchLogo(input), { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
})

test('a reference matched against itself scores at most 1, within the output contract', async () => {
  const bytes = await sharp(await readFile(new URL('logos/motorola1.gif', LOGO_SET_DIRECTORY)))
    .removeAlpha()
    .png()
    .toBuffer()
  const result = await matchLogo(await logoInput(bytes, {}, 3))
  assert.ok(result.state === 'ready')
  assert.equal(result.candidates[0].id, 'motorola1')
  const { sheet, ...header } = result
  assertMediaLogoMatchOutputHeader({
    ...header,
    sheet: {
      width: sheet.width,
      height: sheet.height,
      byte_size: sheet.bytes.length,
      digest: sha(sheet.bytes),
    },
  })
})

test('an elongated mark is matched within a bounded working size', async () => {
  // Twenty bright and dark stripes across 9 million × 2 pixels, inside the decoder's pixel limits.
  // Squared up at full size, its bounds would need 8 × 10^13 bytes; the query bound shrinks it to
  // 1024 px first.
  const width = 9_000_000
  const stripe = width / 20
  const raw = Buffer.alloc(width * 2 * 3)
  for (let x = 0; x < width; x++) {
    const level = Math.floor(x / stripe) % 2 === 0 ? 230 : 30
    raw.fill(level, x * 3, x * 3 + 3)
    raw.fill(level, (width + x) * 3, (width + x) * 3 + 3)
  }
  const bytes = await sharp(raw, { raw: { width, height: 2, channels: 3 } })
    .png()
    .toBuffer()
  const result = await matchLogo(await logoInput(bytes))
  assert.ok(result.state === 'ready', `state ${result.state}`)
  assert.equal(result.candidates.length, 5, 'the stripes have a shape to compare')
})

test('a small tilt is straightened by the view before matching', async () => {
  const fixtures = await parityFixtures()
  const fixture = fixtures.logos.find((item) => item.degradation === 'etched')!
  const upright = await fixtureBytes(fixture.query)
  // Tilted 9° clockwise on black, then straightened by turning the view 9° anticlockwise.
  const tilted = await sharp(upright).rotate(9, { background: '#000000' }).png().toBuffer()
  const straightened = await matchLogo(
    await logoInput(tilted, { straighten_millidegrees: -9000 }, 3),
  )
  const leftTilted = await matchLogo(await logoInput(tilted, {}, 3))
  const reference = await matchLogo(await logoInput(upright, {}, 3))
  assert.ok(
    straightened.state === 'ready' && leftTilted.state === 'ready' && reference.state === 'ready',
  )
  assert.equal(straightened.candidates[0].id, fixture.id)
  assert.ok(
    straightened.candidates[0].score >
      leftTilted.candidates.find((item) => item.id === fixture.id)!.score,
    'straightening raises the true maker’s score',
  )
  // The query tile shows the mark upright: closer to the upright query's tile than the tilted one is.
  const uprightShape = markShape(tileGrey(await sheetPixels(reference.sheet.bytes), 0))
  const straightShape = markShape(tileGrey(await sheetPixels(straightened.sheet.bytes), 0))
  const tiltedShape = markShape(tileGrey(await sheetPixels(leftTilted.sheet.bytes), 0))
  assert.ok(correlation(straightShape, uprightShape) > correlation(tiltedShape, uprightShape))
})
