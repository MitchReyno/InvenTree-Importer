import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  expectedRenditionSizes,
  MEDIA_TOOLCHAIN,
  renditionDimensions,
} from '@invimport/contracts/media'
import { decode, LimitError, rendered } from '../src/media/decode.ts'
import { parseDecoderOutput, webpDimensions } from '../src/media/decoder-output.ts'
import type { DecodeInput } from '../src/media/decoder-protocol.ts'

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
    assert.deepEqual(webpDimensions(item.bytes), { width: item.width, height: item.height })
    assert.equal((await sharp(item.bytes).metadata()).format, 'webp')
  }
})

test('an awkward aspect ratio still gets exactly the predicted rendition size', async () => {
  const bytes = await sharp({
    create: { width: 1000, height: 101, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer()
  const [page] = (await decode(input(bytes))).pages
  assert.deepEqual(webpDimensions(page.renditions[0].bytes), { width: 320, height: 32 })
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

function fakePng(width: number, height: number) {
  const bytes = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function fakeWebp(width: number, height: number) {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function framed(
  pages: { width: number; height: number; sizes?: string[] }[],
  tamper?: (header: {
    pages: { renditions: { width: number; byte_size: number; digest: string }[] }[]
  }) => void,
  /** Rewrites a rendition's bytes before its digest is taken, so later guards are reached. */
  corrupt?: (bytes: Buffer) => Buffer,
) {
  const payload: Buffer[] = []
  const header = {
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    pages: pages.map((spec, index) => {
      const page = fakePng(spec.width, spec.height)
      payload.push(page)
      const sizes = spec.sizes ?? expectedRenditionSizes(spec.width, spec.height)
      return {
        page: index + 1,
        width: spec.width,
        height: spec.height,
        byte_size: page.length,
        digest: sha(page),
        renditions: sizes.map((size) => {
          // An invalid size still needs bytes, so it falls back to the page's own dimensions.
          const target = renditionDimensions(spec.width, spec.height, size as 'thumb') ?? spec
          const original = fakeWebp(target.width, target.height)
          const bytes = corrupt ? corrupt(original) : original
          payload.push(bytes)
          return {
            size,
            width: target.width,
            height: target.height,
            byte_size: bytes.length,
            digest: sha(bytes),
          }
        }),
      }
    }),
  }
  tamper?.(header)
  return Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), ...payload])
}

test('a 30-page result with every rendition fits the decoder header bound', () => {
  const bytes = framed(Array.from({ length: 30 }, () => ({ width: 3000, height: 1000 })))
  assert.ok(bytes.indexOf(10) > 8192, 'header exceeds the old 8192-byte bound')
  const result = parseDecoderOutput(bytes)
  assert.equal(result.state, 'ready')
  assert.equal(result.pages.length, 30)
  assert.deepEqual(
    result.pages[29].renditions.map((item) => [item.size, item.width, item.height]),
    [
      ['thumb', 320, 107],
      ['card', 960, 320],
      ['view', 2048, 683],
    ],
  )
})

test('decoder output with missing, extra or mis-sized renditions is refused', () => {
  assert.throws(
    () => parseDecoderOutput(framed([{ width: 3000, height: 1000, sizes: ['thumb', 'card'] }])),
    /invalid_decoder_rendition/,
  )
  assert.throws(
    () => parseDecoderOutput(framed([{ width: 800, height: 600, sizes: ['thumb', 'card'] }])),
    /invalid_decoder_rendition|invalid_decoder_output/,
  )
  assert.throws(
    () =>
      parseDecoderOutput(
        framed([{ width: 3000, height: 1000 }], (header) => {
          header.pages[0].renditions[0].width = 321
        }),
      ),
    /invalid_decoder_rendition/,
  )
})

test('conditional requests use weak comparison over the whole If-None-Match list', async () => {
  const { matchesEntityTag } = await import('../src/media/routes.ts')
  const etag = '"' + 'a'.repeat(64) + '"'
  assert.equal(matchesEntityTag(undefined, etag), false)
  assert.equal(matchesEntityTag(etag, etag), true)
  assert.equal(matchesEntityTag(`W/${etag}`, etag), true)
  assert.equal(matchesEntityTag(`"other", ${etag}`, etag), true)
  assert.equal(matchesEntityTag('*', etag), true)
  assert.equal(matchesEntityTag('"other"', etag), false)
})

test('each rendition integrity guard refuses its own corruption', () => {
  const page = [{ width: 1000, height: 500, sizes: ['thumb', 'card'] }]
  assert.equal(parseDecoderOutput(framed(page)).state, 'ready')
  // Not a WebP container, with a digest matching the corrupt bytes.
  assert.throws(
    () =>
      parseDecoderOutput(
        framed(page, undefined, (bytes) => Buffer.concat([Buffer.from('JUNK'), bytes.subarray(4)])),
      ),
    /invalid_decoder_rendition/,
  )
  // A WebP whose encoded dimensions disagree with its header entry.
  assert.throws(
    () =>
      parseDecoderOutput(
        framed(page, undefined, (bytes) => {
          const copy = Buffer.from(bytes)
          copy.writeUIntLE(100, 24, 3)
          return copy
        }),
      ),
    /invalid_decoder_rendition/,
  )
  assert.throws(
    () =>
      parseDecoderOutput(
        framed(page, undefined, (bytes) => {
          const copy = Buffer.from(bytes)
          copy.writeUIntLE(10, 27, 3)
          return copy
        }),
      ),
    /invalid_decoder_rendition/,
  )
  // Correct bytes under a false digest.
  assert.throws(
    () =>
      parseDecoderOutput(
        framed(page, (header) => {
          header.pages[0].renditions[0].digest = 'b'.repeat(64)
        }),
      ),
    /decoder_output_digest_mismatch/,
  )
  // A declared length that disagrees with the payload; the framing digest and trailing checks
  // also catch this, so the length guard is defence in depth.
  assert.throws(
    () =>
      parseDecoderOutput(
        framed(page, (header) => {
          header.pages[0].renditions[0].byte_size += 1
        }),
      ),
    /invalid_decoder_rendition|decoder_output_trailing_bytes|decoder_output_digest_mismatch/,
  )
})
