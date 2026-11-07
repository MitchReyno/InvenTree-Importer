import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { decodeIsolated } from '../../src/media/decoder-runner.ts'
import type { DecodeInput } from '../../src/media/decoder-protocol.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
if (image && !/^sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error('Decoder image must be an explicit immutable owned image')
}

function decoderImage() {
  if (!image) {
    throw new Error('Explicit owned decoder image required; this suite never loads .env')
  }
  return image
}

function mediaTest(name: string, run: () => Promise<void>) {
  return test(
    name,
    {
      skip: image ? false : 'Set INTAKE_MEDIA_DECODER_IMAGE to the explicitly built owned image',
    },
    run,
  )
}

function input(bytes: Buffer): DecodeInput {
  return {
    version: 'media-decode/1',
    digest: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  }
}

function vectorPdf() {
  const content = '1 0 0 rg 0 0 40 60 re f 0 0 1 rg 40 0 40 60 re f\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 60] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
  let bytes = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(bytes))
    bytes += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(bytes)
  bytes += 'xref\n0 5\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    bytes += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  bytes += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(bytes)
}

mediaTest(
  'actual image bytes crop then rotate with independent literal pixel ordering',
  async () => {
    const sourcePixels = Buffer.from([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0,
    ])
    const bytes = await sharp(sourcePixels, { raw: { width: 3, height: 2, channels: 3 } })
      .png()
      .toBuffer()
    const request = input(bytes)
    request.recipe = {
      version: 'documentary-crop/1',
      source_version_id: '00000000-0000-4000-8000-000000000021',
      source_digest: request.digest,
      page: 1,
      source_width: 3,
      source_height: 2,
      x: 1,
      y: 0,
      width: 2,
      height: 2,
      quarter_turns: 1,
    }
    const decoded = await decodeIsolated(decoderImage(), request)
    assert.equal(decoded.state, 'ready')
    assert.equal(decoded.pages.length, 1)
    const output = decoded.pages[0]
    assert.equal(output.width, 2)
    assert.equal(output.height, 2)
    const pixels = await sharp(output.bytes).removeAlpha().raw().toBuffer()
    assert.deepEqual([...pixels], [255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 0, 255])
    const repeated = await decodeIsolated(decoderImage(), request)
    assert.equal(repeated.pages[0].bytes.toString('hex'), output.bytes.toString('hex'))
  },
)

mediaTest(
  'actual JPEG EXIF orientation is normalized before source coordinate addressing',
  async () => {
    const raw = Buffer.alloc(40 * 20 * 3)
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        raw.set(x < 20 ? [255, 0, 0] : [0, 0, 255], (y * 40 + x) * 3)
      }
    }
    const jpeg = await sharp(raw, { raw: { width: 40, height: 20, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toBuffer()
    const result = await decodeIsolated(decoderImage(), input(jpeg))
    assert.equal(result.state, 'ready')
    assert.deepEqual([result.pages[0].width, result.pages[0].height], [20, 40])
    const pixels = await sharp(result.pages[0].bytes).removeAlpha().raw().toBuffer()
    assert.ok(pixels[(5 * 20 + 5) * 3] >= 245)
    assert.ok(pixels[(30 * 20 + 5) * 3 + 2] >= 245)
  },
)

mediaTest(
  'actual PDF page raster preserves independent left/right colours and dimensions',
  async () => {
    const result = await decodeIsolated(decoderImage(), input(vectorPdf()))
    assert.equal(result.state, 'ready')
    assert.deepEqual([result.pages[0].width, result.pages[0].height], [80, 60])
    const pixels = await sharp(result.pages[0].bytes).removeAlpha().raw().toBuffer()
    const left = (20 * 80 + 20) * 3
    const right = (20 * 80 + 60) * 3
    assert.deepEqual([...pixels.subarray(left, left + 3)], [255, 0, 0])
    assert.deepEqual([...pixels.subarray(right, right + 3)], [0, 0, 255])
  },
)

mediaTest('unsupported and malformed documents never produce ready previews', async () => {
  const unsupported = await decodeIsolated(
    decoderImage(),
    input(Buffer.from('<svg onload="alert(1)"/>')),
  )
  assert.equal(unsupported.state, 'unsupported')
  assert.deepEqual(unsupported.pages, [])
  const malformed = await decodeIsolated(
    decoderImage(),
    input(Buffer.from('%PDF-1.4\nnot a PDF\n')),
  )
  assert.equal(malformed.state, 'malformed')
  assert.deepEqual(malformed.pages, [])
})

mediaTest('encrypted original remains an honest retained password-required state', async () => {
  const bytes = await readFile(new URL('../fixtures/media/encrypted.pdf', import.meta.url))
  const result = await decodeIsolated(decoderImage(), input(bytes))
  assert.equal(result.state, 'encrypted')
  assert.deepEqual(result.pages, [])
})

mediaTest(
  'actual PDF bytes are rejected at page and pixel budgets before raster allocation',
  async () => {
    for (const fixture of ['too-many-pages.pdf', 'too-many-pixels.pdf']) {
      const bytes = await readFile(new URL(`../fixtures/media/${fixture}`, import.meta.url))
      const result = await decodeIsolated(decoderImage(), input(bytes))
      assert.equal(result.state, 'limit_exceeded', fixture)
      assert.deepEqual(result.pages, [])
    }
  },
)

mediaTest(
  'photo-sized JPEG and PNG output cross the former JSON ceiling as bounded raw bytes',
  async () => {
    const width = 1600
    const height = 1200
    const pixels = Buffer.alloc(width * height * 3)
    let random = 0x12345678
    for (let index = 0; index < pixels.length; index++) {
      random ^= random << 13
      random ^= random >>> 17
      random ^= random << 5
      pixels[index] = random & 255
    }
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer()
    assert.ok(jpeg.length > 262144)
    const result = await decodeIsolated(decoderImage(), input(jpeg))
    assert.equal(result.state, 'ready')
    assert.equal(result.pages[0].width, 1600)
    assert.equal(result.pages[0].height, 1200)
    assert.ok(result.pages[0].bytes.length > 262144)
  },
)

mediaTest('a 50 MP phone photo decodes; a larger one is a limit, not an interruption', async () => {
  const photo = (width: number, height: number) =>
    // Portrait EXIF orientation, as phones write it, forces a full-size rotation.
    sharp({ create: { width, height, channels: 3, background: '#8a6d4f' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()
  const phone = await decodeIsolated(decoderImage(), input(await photo(8160, 6144)))
  assert.equal(phone.state, 'ready')
  assert.equal(phone.pages[0].width, 6144)
  assert.equal(phone.pages[0].height, 8160)
  const oversized = await decodeIsolated(decoderImage(), input(await photo(7300, 7300)))
  assert.equal(oversized.state, 'limit_exceeded')
  assert.deepEqual(oversized.pages, [])
})

mediaTest(
  'rotated selection samples an oblique non-square region without rotating the source image',
  async () => {
    const width = 64
    const height = 48
    const pixels = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        pixels.set([3 * x, 4 * y, x + y], (y * width + x) * 3)
      }
    }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
    const request: DecodeInput = {
      ...input(bytes),
      recipe: {
        version: 'documentary-rotated-region/1',
        source_version_id: '10000000-0000-4000-8000-000000000001',
        source_digest: input(bytes).digest,
        page: 1,
        source_width: width,
        source_height: height,
        center_x_micro: '32000000',
        center_y_micro: '24000000',
        width_micro: '20000000',
        height_micro: '12000000',
        rotation_millidegrees: 37000,
        output_width: 20,
        output_height: 12,
        aspect_ratio: { width: 5, height: 3 },
      },
    }
    const result = await decodeIsolated(decoderImage(), request)
    assert.equal(result.state, 'ready')
    assert.equal(result.pages.length, 1)
    assert.deepEqual([result.pages[0].width, result.pages[0].height], [20, 12])
    const output = await sharp(result.pages[0].bytes).removeAlpha().raw().toBuffer()
    // Independent inverse geometry: source centers are half a pixel inside source edges.
    const radians = (37 * Math.PI) / 180
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 20; x++) {
        const sourceX = 31.5 + Math.cos(radians) * (x - 9.5) - Math.sin(radians) * (y - 5.5)
        const sourceY = 23.5 + Math.sin(radians) * (x - 9.5) + Math.cos(radians) * (y - 5.5)
        const expected = [3 * sourceX, 4 * sourceY, sourceX + sourceY]
        for (let channel = 0; channel < 3; channel++) {
          assert.ok(
            Math.abs(output[(y * 20 + x) * 3 + channel] - Math.round(expected[channel])) <= 1,
            `source mapping at ${x},${y},${channel}`,
          )
        }
      }
    }
    const repeat = await decodeIsolated(decoderImage(), request)
    assert.deepEqual(repeat.pages[0].bytes, result.pages[0].bytes)
  },
)

mediaTest(
  'rotated-region quarter angle extracts the upright selection with literal asymmetric pixel order',
  async () => {
    const pixels = Buffer.from([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0,
    ])
    const bytes = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } })
      .png()
      .toBuffer()
    const result = await decodeIsolated(decoderImage(), {
      ...input(bytes),
      recipe: {
        version: 'documentary-rotated-region/1',
        source_version_id: '10000000-0000-4000-8000-000000000001',
        source_digest: input(bytes).digest,
        page: 1,
        source_width: 3,
        source_height: 2,
        center_x_micro: '1500000',
        center_y_micro: '1000000',
        width_micro: '2000000',
        height_micro: '3000000',
        rotation_millidegrees: 90000,
        output_width: 2,
        output_height: 3,
        aspect_ratio: null,
      },
    })
    assert.equal(result.state, 'ready')
    const output = await sharp(result.pages[0].bytes).removeAlpha().raw().toBuffer()
    assert.deepEqual(
      output,
      Buffer.from([0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255]),
    )
  },
)
