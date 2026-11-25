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

  // The query tile and the first candidate's each show a light-on-dark mark over their black
  // tile, and a yellow title below it.
  const pixels = await sharp(result.sheet.bytes).removeAlpha().raw().toBuffer()
  const count = (
    tile: number,
    rows: [number, number],
    matches: (red: number, green: number, blue: number) => boolean,
  ) => {
    let found = 0
    const left = (tile % columns) * cellWidth
    const top = Math.floor(tile / columns) * cellHeight
    for (let y = top + rows[0]; y < top + rows[1]; y++) {
      for (let x = left + 4; x < left + cellWidth - 4; x++) {
        const offset = (y * columns * cellWidth + x) * 3
        if (matches(pixels[offset], pixels[offset + 1], pixels[offset + 2])) {
          found++
        }
      }
    }
    return found
  }
  const markInk = (red: number, green: number, blue: number) =>
    red > 150 && green > 150 && blue > 150
  const titleInk = (red: number, green: number, blue: number) =>
    red > 200 && green > 150 && blue < 80
  for (const tile of [0, 1]) {
    assert.ok(count(tile, [5, 100], markInk) > 100, `tile ${tile} shows a mark`)
    assert.ok(count(tile, [100, 118], titleInk) > 20, `tile ${tile} has its title`)
  }
  // The query's mark, an enlarged and blurred Motorola logo, differs from the reference's own.
  assert.notEqual(count(0, [5, 100], markInk), count(1, [5, 100], markInk))
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
