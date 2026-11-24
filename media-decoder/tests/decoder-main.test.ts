import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  assertMediaGridOutputHeader,
  assertMediaLogoMatchOutputHeader,
  assertMediaPreviewOutputHeader,
} from '@invimport/contracts/media'
import { decode } from '../src/decode.ts'
import { fixtureBytes, NO_LIGHT, parityFixtures, recipeForCrop, sha } from './support/parity.ts'

const DECODER_MAIN = fileURLToPath(new URL('../src/decoder-main.ts', import.meta.url))

/** Runs the container entry point on one framed request: a header line, then the bytes. */
async function runDecoder(header: unknown, bytes: Buffer) {
  const child = spawn(process.execPath, [DECODER_MAIN], { stdio: ['pipe', 'pipe', 'pipe'] })
  const output: Buffer[] = []
  const errors: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
  child.stdin.end(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), bytes]))
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve))
  assert.equal(code, 0, Buffer.concat(errors).toString('utf8'))
  const result = Buffer.concat(output)
  const headerEnd = result.indexOf(10)
  return {
    header: JSON.parse(result.subarray(0, headerEnd).toString('utf8')) as Record<string, unknown>,
    body: result.subarray(headerEnd + 1),
  }
}

/** The single image after the header matches the size and digest the header gives it. */
function assertOneImage(body: Buffer, image: { byte_size: number; digest: string }) {
  assert.equal(body.length, image.byte_size)
  assert.equal(sha(body), image.digest)
}

async function benchPage() {
  const fixtures = await parityFixtures()
  const original = await fixtureBytes(fixtures.photo)
  const decoded = await decode({
    version: 'media-decode/1',
    digest: sha(original),
    bytes: original,
  })
  assert.equal(decoded.state, 'ready')
  return { page: decoded.pages[0], originalDigest: sha(original) }
}

test('the entry point frames a preview of crops on two pages', async () => {
  const { page, originalDigest } = await benchPage()
  const recipe = {
    ...recipeForCrop(
      { region: [150, 160, 330, 240], quarter_turns: 1, straighten: -3.5, wb: false },
      { width: page.width, height: page.height, digest: originalDigest },
    ),
    light: { ...NO_LIGHT, white_balance: true },
  }
  const pageEntry = {
    source_version_id: recipe.source_version_id,
    source_digest: recipe.source_digest,
    page: recipe.page,
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    byte_size: page.bytes.length,
  }
  const { header, body } = await runDecoder(
    {
      version: 'media-preview/1',
      pages: [pageEntry, pageEntry],
      crops: [
        { label: 'first', page: 0, recipe },
        { label: 'second', page: 1, recipe },
      ],
    },
    Buffer.concat([page.bytes, page.bytes]),
  )
  assertMediaPreviewOutputHeader(header)
  assert.ok(header.state === 'ready')
  assert.equal(header.crops.length, 2)
  assertOneImage(body, header.montage)
})

test('the entry point frames a grid and a logo match', async () => {
  const { page } = await benchPage()
  const grid = await runDecoder(
    {
      version: 'media-grid/1',
      digest: sha(page.bytes),
      width: page.width,
      height: page.height,
      region: { x: 100, y: 100, width: 200, height: 100 },
      preview_width: 600,
      step: null,
      object: { x: 170, y: 182, width: 140, height: 36 },
      boxes: [{ name: 'resistor', box: { x: 160, y: 172, width: 160, height: 56 } }],
    },
    page.bytes,
  )
  assertMediaGridOutputHeader(grid.header)
  assert.ok(grid.header.state === 'ready')
  assertOneImage(grid.body, grid.header.image)

  const fixtures = await parityFixtures()
  const query = await fixtureBytes(fixtures.logos[0].query)
  const logoPage = (await decode({ version: 'media-decode/1', digest: sha(query), bytes: query }))
    .pages[0]
  const match = await runDecoder(
    {
      version: 'media-logo-match/1',
      digest: sha(logoPage.bytes),
      width: logoPage.width,
      height: logoPage.height,
      view: {
        region: { x: 0, y: 0, width: logoPage.width, height: logoPage.height },
        quarter_turns: 0,
        straighten_millidegrees: 0,
      },
      top: 3,
    },
    logoPage.bytes,
  )
  assertMediaLogoMatchOutputHeader(match.header)
  assert.ok(match.header.state === 'ready')
  assert.equal(match.header.candidates[0].id, fixtures.logos[0].id)
  assertOneImage(match.body, match.header.sheet)
})

test('a failed operation writes its header alone', async () => {
  const { page } = await benchPage()
  const { header, body } = await runDecoder(
    {
      version: 'media-grid/1',
      digest: sha(page.bytes),
      width: page.width,
      height: page.height,
      region: { x: 5000, y: 0, width: 10, height: 10 },
      preview_width: 600,
      step: null,
      object: null,
      boxes: [],
    },
    page.bytes,
  )
  assertMediaGridOutputHeader(header)
  assert.equal(header.state, 'malformed')
  assert.equal(body.length, 0)
})
