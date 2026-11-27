import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  MEDIA_TOOLCHAIN,
  viewLayout,
  type MediaViewMarkDto,
  type MediaViewRecipeDto,
} from '@invimport/contracts/media'
import { parseViewOutput } from '#/media/decoder-output.ts'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const DECODER_MAIN = fileURLToPath(
  new URL('../../media-decoder/src/decoder-main.ts', import.meta.url),
)

const recipe: MediaViewRecipeDto = {
  version: 'bench-intake-view/1',
  source_version_id: '00000000-0000-4000-8000-000000000001',
  source_digest: 'a'.repeat(64),
  page: 1,
  page_width: 1200,
  page_height: 800,
  view: {
    region: { x: 300, y: 200, width: 300, height: 200 },
    quarter_turns: 0,
    straighten_millidegrees: 0,
  },
}
const layout = viewLayout(recipe)
const marks: MediaViewMarkDto[] = [
  { kind: 'box', geometry: { x: 1000, y: 1000, width: 5000, height: 5000 } },
]

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
}

interface Images {
  view: Buffer
  thumb: Buffer
  preview: Buffer | null
}

async function images(withPreview: boolean): Promise<Images> {
  return {
    view: await solid(layout.width, layout.height).webp({ quality: 80 }).toBuffer(),
    thumb: await solid(layout.thumbWidth, layout.thumbHeight).webp({ quality: 80 }).toBuffer(),
    preview: withPreview ? await solid(layout.width, layout.height).png().toBuffer() : null,
  }
}

function entry(bytes: Buffer, size: { width: number; height: number }) {
  return { width: size.width, height: size.height, byte_size: bytes.length, digest: sha(bytes) }
}

/** Frames images as the decoder does: the header line, then view, thumbnail and preview bytes. */
function framed(
  parts: Images,
  tamper?: (header: Record<string, { width: number; digest: string } | null>) => void,
  trailing = Buffer.alloc(0),
) {
  const header: Record<string, unknown> = {
    state: 'ready',
    toolchain: MEDIA_TOOLCHAIN,
    view: entry(parts.view, layout),
    thumb: entry(parts.thumb, { width: layout.thumbWidth, height: layout.thumbHeight }),
    preview: parts.preview ? entry(parts.preview, layout) : null,
  }
  tamper?.(header as Record<string, { width: number; digest: string } | null>)
  return Buffer.concat([
    Buffer.from(JSON.stringify(header) + '\n'),
    parts.view,
    parts.thumb,
    parts.preview ?? Buffer.alloc(0),
    trailing,
  ])
}

test('a view result parses to the layout sizes, with a preview only when marks were sent', async () => {
  const plain = parseViewOutput(framed(await images(false)), { recipe, marks: null })
  assert.equal(plain.state, 'ready')
  assert.deepEqual([plain.view.width, plain.view.height], [layout.width, layout.height])
  assert.deepEqual([plain.thumb.width, plain.thumb.height], [layout.thumbWidth, layout.thumbHeight])
  assert.equal(plain.preview, null)

  const marked = parseViewOutput(framed(await images(true)), { recipe, marks })
  assert.equal(marked.state, 'ready')
  assert.deepEqual([marked.preview?.width, marked.preview?.height], [layout.width, layout.height])
})

test('a preview without marks, or marks without a preview, is refused', async () => {
  const withPreview = framed(await images(true))
  const withoutPreview = framed(await images(false))
  assert.throws(() => parseViewOutput(withPreview, { recipe, marks: null }), /invalid_decoder_view/)
  assert.throws(() => parseViewOutput(withoutPreview, { recipe, marks }), /invalid_decoder_view/)
})

test('images of the wrong size, format or digest are refused', async () => {
  const parts = await images(true)
  // A view the recipe doesn't predict, with an honest header entry for its bytes.
  const wide = await solid(layout.width + 1, layout.height)
    .webp()
    .toBuffer()
  assert.throws(
    () =>
      parseViewOutput(
        framed({ ...parts, view: wide }, (header) => {
          header.view = entry(wide, { width: layout.width + 1, height: layout.height })
        }),
        { recipe, marks },
      ),
    /invalid_decoder_view/,
  )
  // A header that claims the layout size over bytes of another size.
  const small = await solid(layout.thumbWidth - 1, layout.thumbHeight)
    .webp()
    .toBuffer()
  assert.throws(
    () => parseViewOutput(framed({ ...parts, thumb: small }), { recipe, marks }),
    /invalid_decoder_view/,
  )
  // A WebP where the PNG preview belongs.
  const webpPreview = await solid(layout.width, layout.height).webp().toBuffer()
  assert.throws(
    () => parseViewOutput(framed({ ...parts, preview: webpPreview }), { recipe, marks }),
    /invalid_decoder_view/,
  )
  // Correct bytes under a false digest.
  assert.throws(
    () =>
      parseViewOutput(
        framed(parts, (header) => {
          header.thumb!.digest = 'b'.repeat(64)
        }),
        { recipe, marks },
      ),
    /decoder_output_digest_mismatch/,
  )
  assert.throws(
    () => parseViewOutput(framed(parts, undefined, Buffer.from('x')), { recipe, marks }),
    /decoder_output_trailing_bytes/,
  )
})

test('a malformed result carries no bytes', () => {
  const header = Buffer.from(JSON.stringify({ state: 'malformed', toolchain: MEDIA_TOOLCHAIN }))
  const result = parseViewOutput(Buffer.concat([header, Buffer.from('\n')]), {
    recipe,
    marks: null,
  })
  assert.deepEqual(result, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
  assert.throws(
    () => parseViewOutput(Buffer.concat([header, Buffer.from('\nx')]), { recipe, marks: null }),
    /decoder_output_trailing_bytes/,
  )
})

/** Runs the decoder program the container runs, on this host, and returns its stdout. */
async function runDecoder(packet: Buffer): Promise<Buffer> {
  const child = spawn(process.execPath, [DECODER_MAIN], { stdio: ['pipe', 'pipe', 'inherit'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stdin.end(packet)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  assert.equal(code, 0)
  return Buffer.concat(chunks)
}

test('the decoder program frames a view that the parser accepts', async () => {
  const page = await solid(recipe.page_width, recipe.page_height).png().toBuffer()
  const header = {
    version: 'media-view/1',
    digest: sha(page),
    width: recipe.page_width,
    height: recipe.page_height,
    recipe,
    marks,
  }
  const packet = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), page])
  const result = parseViewOutput(await runDecoder(packet), { recipe, marks })
  assert.equal(result.state, 'ready')
  assert.ok(result.preview)

  const mismatched = { ...header, width: recipe.page_width - 1 }
  const refused = Buffer.concat([Buffer.from(JSON.stringify(mismatched) + '\n'), page])
  assert.deepEqual(parseViewOutput(await runDecoder(refused), { recipe, marks }), {
    state: 'malformed',
    toolchain: MEDIA_TOOLCHAIN,
  })
})
