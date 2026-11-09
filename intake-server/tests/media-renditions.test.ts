import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  expectedRenditionSizes,
  MEDIA_TOOLCHAIN,
  renditionDimensions,
} from '@invimport/contracts/media'
import { parseDecoderOutput, webpDimensions } from '../src/media/decoder-output.ts'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

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

test('real lossy and lossless WebP from the encoder parse to their exact size', async () => {
  const image = sharp({
    create: { width: 321, height: 123, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
  const lossy = await image.clone().webp({ quality: 80 }).toBuffer()
  const lossless = await image.clone().webp({ lossless: true }).toBuffer()
  assert.equal(lossy.subarray(12, 16).toString('latin1'), 'VP8 ')
  assert.equal(lossless.subarray(12, 16).toString('latin1'), 'VP8L')
  assert.deepEqual(webpDimensions(lossy), { width: 321, height: 123 })
  assert.deepEqual(webpDimensions(lossless), { width: 321, height: 123 })
})

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
  // A high bit set on any magic byte is not a WebP, even though `ascii` decoding would hide it.
  for (const offset of [0, 8, 12]) {
    assert.throws(
      () =>
        parseDecoderOutput(
          framed(page, undefined, (bytes) => {
            const copy = Buffer.from(bytes)
            copy[offset] |= 0x80
            return copy
          }),
        ),
      /invalid_decoder_rendition/,
    )
  }
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

test('the worker pauses after every decode and after interruptions; only backfill progress runs on', async () => {
  const { pauseAfter } = await import('../src/media/backfill.ts')
  assert.equal(pauseAfter('decoded'), true)
  assert.equal(pauseAfter('interrupted'), true)
  assert.equal(pauseAfter('idle'), true)
  assert.equal(pauseAfter('completed'), false)
  assert.equal(pauseAfter('skipped_mismatch'), false)
})
