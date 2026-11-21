import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  expectedRenditionSizes,
  MEDIA_TOOLCHAIN,
  renditionDimensions,
} from '@invimport/contracts/media'
import { decode, LimitError, rendered, renderRetained } from '../src/decode.ts'
import type { DecodeInput } from '../src/decoder-protocol.ts'

/** Reads a rendition's size with sharp, independently of the server's WebP header parser. */
async function webpSize(bytes: Buffer) {
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.format, 'webp')
  return { width: metadata.width, height: metadata.height }
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function input(bytes: Buffer, recipe?: DecodeInput['recipe']): DecodeInput {
  return { version: 'media-decode/1', digest: sha(bytes), bytes, recipe }
}

function photo(width: number, height: number, orientation?: number) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
  return (orientation ? image.withMetadata({ orientation }) : image).jpeg().toBuffer()
}

function pdf(pages: number, width: number, height: number) {
  const kids = Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
  ]
  for (let index = 0; index < pages; index++) {
    const content = `0 0 1 rg 0 0 ${width / 2} ${height} re f\n`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    )
  }
  let bytes = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(bytes))
    bytes += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(bytes)
  bytes += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    bytes += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  bytes += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(bytes)
}

test('rendition dimensions scale the long edge, round the short edge and never upscale', () => {
  assert.deepEqual(renditionDimensions(4032, 3024, 'thumb'), { width: 320, height: 240 })
  assert.deepEqual(renditionDimensions(4032, 3024, 'card'), { width: 960, height: 720 })
  assert.deepEqual(renditionDimensions(4032, 3024, 'view'), { width: 2048, height: 1536 })
  assert.deepEqual(renditionDimensions(3024, 4032, 'thumb'), { width: 240, height: 320 })
  assert.deepEqual(renditionDimensions(1000, 1000, 'thumb'), { width: 320, height: 320 })
  assert.deepEqual(renditionDimensions(1000, 101, 'thumb'), { width: 320, height: 32 })
  assert.deepEqual(renditionDimensions(10000, 101, 'view'), { width: 2048, height: 21 })
  assert.deepEqual(renditionDimensions(10000, 1, 'thumb'), { width: 320, height: 1 })
  assert.equal(renditionDimensions(320, 100, 'thumb'), null)
  assert.equal(renditionDimensions(1, 1, 'thumb'), null)
  assert.deepEqual(expectedRenditionSizes(800, 600), ['thumb'])
  assert.deepEqual(expectedRenditionSizes(4032, 3024), ['thumb', 'card', 'view'])
  assert.deepEqual(expectedRenditionSizes(300, 200), [])
})

test('a photo decodes to its unchanged full page plus WebP renditions of exact dimensions', async () => {
  const bytes = await photo(1200, 900, 6)
  const result = await decode(input(bytes))
  assert.equal(result.state, 'ready')
  assert.equal(result.toolchain, MEDIA_TOOLCHAIN)
  const [page] = result.pages
  // EXIF orientation 6 is a quarter turn: the full page is upright and still a PNG.
  assert.deepEqual([page.width, page.height], [900, 1200])
  assert.deepEqual((await sharp(page.bytes).metadata()).format, 'png')
  assert.deepEqual(
    page.renditions.map((item) => [item.size, item.width, item.height]),
    [
      ['thumb', 240, 320],
      ['card', 720, 960],
    ],
  )
  for (const item of page.renditions) {
    assert.deepEqual(await webpSize(item.bytes), { width: item.width, height: item.height })
  }
})

test('an awkward aspect ratio still gets exactly the predicted rendition size', async () => {
  const bytes = await sharp({
    create: { width: 1000, height: 101, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer()
  const [page] = (await decode(input(bytes))).pages
  assert.deepEqual(await webpSize(page.renditions[0].bytes), { width: 320, height: 32 })
})

test('a small source has no renditions', async () => {
  const bytes = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer()
  const result = await decode(input(bytes))
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.pages[0].renditions, [])
})

test('each page of a multi-page PDF gets its own renditions', async () => {
  const result = await decode(input(pdf(3, 900, 600)))
  assert.equal(result.state, 'ready')
  assert.deepEqual(
    result.pages.map((page) => [page.page, page.renditions.map((item) => item.size)]),
    [
      [1, ['thumb']],
      [2, ['thumb']],
      [3, ['thumb']],
    ],
  )
})

test('a documentary crop is sized from the crop output, not the source page', async () => {
  const bytes = await photo(1200, 900)
  const recipe = {
    version: 'documentary-crop/1' as const,
    source_version_id: '00000000-0000-4000-8000-000000000001',
    source_digest: sha(bytes),
    page: 1,
    source_width: 1200,
    source_height: 900,
    x: 100,
    y: 50,
    width: 500,
    height: 400,
    quarter_turns: 1 as const,
  }
  const result = await decode(input(bytes, recipe))
  assert.equal(result.state, 'ready')
  const [page] = result.pages
  assert.deepEqual([page.width, page.height], [400, 500])
  assert.deepEqual(
    page.renditions.map((item) => [item.size, item.width, item.height]),
    [['thumb', 256, 320]],
  )
})

test('renditions share the total output budget and report it as a limit', async () => {
  const bytes = await photo(1200, 900)
  const [page] = (await decode(input(bytes))).pages
  await assert.rejects(
    rendered([page], page.bytes.length + 10),
    (error) => error instanceof LimitError && error.message === 'total_output_limit',
  )
})

test('an encoder failure is not a limit, so the worker records it as interrupted', async () => {
  const broken = { page: 1, width: 2000, height: 1000, bytes: Buffer.from('not an image') }
  await assert.rejects(rendered([broken]), (error) => !(error instanceof LimitError))
})

test('a retained page is malformed only on positive evidence; other failures propagate', async () => {
  const page = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer()
  const input = (bytes: Buffer, width = 1200, height = 800) => ({
    version: 'media-renditions/1' as const,
    digest: sha(bytes),
    bytes,
    width,
    height,
  })
  const ready = await renderRetained(input(page))
  assert.deepEqual(
    ready.renditions.map((item) => item.size),
    ['thumb', 'card'],
  )
  assert.equal((await renderRetained(input(page, 1199))).state, 'malformed')
  const notPng = await sharp(page).jpeg().toBuffer()
  assert.equal((await renderRetained(input(notPng))).state, 'malformed')
  // An unexpected inspection failure is not evidence about the bytes.
  await assert.rejects(
    renderRetained(input(page), async () => {
      throw new Error('vips_out_of_memory')
    }),
    /vips_out_of_memory/,
  )
})
