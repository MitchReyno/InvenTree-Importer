import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createCanvas } from '@napi-rs/canvas'
import {
  MEDIA_TOOLCHAIN,
  viewLayout,
  type MediaViewMarkDto,
  type MediaViewRecipeDto,
} from '@invimport/contracts/media'
import { decode } from '../src/decode.ts'
import { MARK_FONT_FAMILY, renderView, markFont } from '../src/view.ts'
import type { ViewInput } from '../src/decoder-protocol.ts'

type Colour = readonly [number, number, number]

const RED: Colour = [230, 30, 30]
const GREEN: Colour = [30, 200, 60]
const BLUE: Colour = [30, 60, 220]
const YELLOW: Colour = [240, 220, 30]
const WHITE: Colour = [255, 255, 255]
const AMBER: Colour = [0xff, 0xb0, 0x20]
const LABEL_TEXT: Colour = [0x1b, 0x21, 0x1d]
/** WebP quality 80 on flat colour stays well within this per channel. */
const LOSSY_TOLERANCE = 24

const PAGE_WIDTH = 1200
const PAGE_HEIGHT = 800

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A page in four flat quadrants: red, green on top; blue, yellow below. */
async function quadrantPage(): Promise<Buffer> {
  const pixels = Buffer.alloc(PAGE_WIDTH * PAGE_HEIGHT * 3)
  for (let y = 0; y < PAGE_HEIGHT; y++) {
    for (let x = 0; x < PAGE_WIDTH; x++) {
      const top = y < PAGE_HEIGHT / 2
      const left = x < PAGE_WIDTH / 2
      let colour = YELLOW
      if (top && left) {
        colour = RED
      } else if (top) {
        colour = GREEN
      } else if (left) {
        colour = BLUE
      }
      pixels.set(colour, (y * PAGE_WIDTH + x) * 3)
    }
  }
  return sharp(pixels, { raw: { width: PAGE_WIDTH, height: PAGE_HEIGHT, channels: 3 } })
    .png()
    .toBuffer()
}

function onePagePdf(width: number, height: number) {
  // The left half is filled blue; the rest of the page stays white.
  const content = `0 0 1 rg 0 0 ${width / 2} ${height} re f\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
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

function recipe(
  page: { width: number; height: number },
  view: Partial<MediaViewRecipeDto['view']>,
): MediaViewRecipeDto {
  return {
    version: 'bench-intake-view/1',
    source_version_id: '00000000-0000-4000-8000-000000000001',
    source_digest: 'a'.repeat(64),
    page: 1,
    page_width: page.width,
    page_height: page.height,
    view: {
      region: { x: 0, y: 0, width: page.width, height: page.height },
      quarter_turns: 0,
      straighten_millidegrees: 0,
      ...view,
    },
  }
}

function viewInput(
  bytes: Buffer,
  viewRecipe: MediaViewRecipeDto,
  marks: MediaViewMarkDto[] | null = null,
  size = { width: viewRecipe.page_width, height: viewRecipe.page_height },
): ViewInput {
  return {
    version: 'media-view/1',
    digest: sha(bytes),
    width: size.width,
    height: size.height,
    bytes,
    recipe: viewRecipe,
    marks,
  }
}

interface Raster {
  width: number
  height: number
  data: Buffer
}

async function rgb(bytes: Buffer, format: 'webp' | 'png'): Promise<Raster> {
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.format, format)
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

function pixel(image: Raster, x: number, y: number): Colour {
  const offset = (y * image.width + x) * 3
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
}

/** The pixel at fractions of the image's width and height. */
function at(image: Raster, fractionX: number, fractionY: number): Colour {
  const x = Math.min(image.width - 1, Math.floor(fractionX * image.width))
  const y = Math.min(image.height - 1, Math.floor(fractionY * image.height))
  return pixel(image, x, y)
}

function distance(left: Colour, right: Colour) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])))
}

function assertColour(actual: Colour, expected: Colour, where: string) {
  assert.ok(
    distance(actual, expected) <= LOSSY_TOLERANCE,
    `${where}: expected ${expected.join(',')}, got ${actual.join(',')}`,
  )
}

async function ready(input: ViewInput) {
  const result = await renderView(input)
  assert.equal(result.state, 'ready')
  assert.equal(result.toolchain, MEDIA_TOOLCHAIN)
  return result
}

test('a photo view cuts its region and is sized like the shared layout', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 300, y: 200, width: 600, height: 400 } },
  )
  const result = await ready(viewInput(page, viewRecipe))
  const layout = viewLayout(viewRecipe)
  const view = await rgb(result.view.bytes, 'webp')
  const thumb = await rgb(result.thumb.bytes, 'webp')

  assert.deepEqual([view.width, view.height], [layout.width, layout.height])
  assert.deepEqual([result.view.width, result.view.height], [layout.width, layout.height])
  assert.deepEqual([thumb.width, thumb.height], [layout.thumbWidth, layout.thumbHeight])
  assert.deepEqual(
    [result.thumb.width, result.thumb.height],
    [layout.thumbWidth, layout.thumbHeight],
  )
  // The region is the page's middle, so each quadrant shows in its own corner of the view.
  assertColour(at(view, 0.25, 0.25), RED, 'top left')
  assertColour(at(view, 0.75, 0.25), GREEN, 'top right')
  assertColour(at(view, 0.25, 0.75), BLUE, 'bottom left')
  assertColour(at(view, 0.75, 0.75), YELLOW, 'bottom right')
  assertColour(at(thumb, 0.25, 0.25), RED, 'thumbnail top left')
  assert.equal(result.preview, null)
})

test('a region within one quadrant shows only that quadrant', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 650, y: 450, width: 500, height: 300 } },
  )
  const view = await rgb((await ready(viewInput(page, viewRecipe))).view.bytes, 'webp')
  for (const [x, y] of [
    [0.02, 0.02],
    [0.98, 0.02],
    [0.02, 0.98],
    [0.98, 0.98],
  ]) {
    assertColour(at(view, x, y), YELLOW, `corner ${x},${y}`)
  }
})

test('a quarter turn swaps the sides and turns the content clockwise', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 300, y: 200, width: 600, height: 400 }, quarter_turns: 1 },
  )
  const result = await ready(viewInput(page, viewRecipe))
  const layout = viewLayout(viewRecipe)
  const view = await rgb(result.view.bytes, 'webp')

  assert.ok(layout.height > layout.width)
  assert.deepEqual([view.width, view.height], [layout.width, layout.height])
  assertColour(at(view, 0.25, 0.25), BLUE, 'top left')
  assertColour(at(view, 0.75, 0.25), RED, 'top right')
  assertColour(at(view, 0.75, 0.75), GREEN, 'bottom right')
  assertColour(at(view, 0.25, 0.75), YELLOW, 'bottom left')
})

test('two quarter turns keep the sides and put the bottom right at the top left', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 300, y: 200, width: 600, height: 400 }, quarter_turns: 2 },
  )
  const view = await rgb((await ready(viewInput(page, viewRecipe))).view.bytes, 'webp')
  const layout = viewLayout(viewRecipe)
  assert.deepEqual([view.width, view.height], [layout.width, layout.height])
  assertColour(at(view, 0.25, 0.25), YELLOW, 'top left')
  assertColour(at(view, 0.75, 0.75), RED, 'bottom right')
})

for (const angle of [15000, -15000]) {
  test(`straightening the whole page by ${angle / 1000}° keeps page colour in every corner`, async () => {
    const page = await quadrantPage()
    const viewRecipe = recipe(
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
      { straighten_millidegrees: angle },
    )
    const layout = viewLayout(viewRecipe)
    assert.ok(layout.guard < 1, 'the corner guard shrinks a straightened whole page')
    const result = await ready(viewInput(page, viewRecipe))
    const view = await rgb(result.view.bytes, 'webp')
    assert.deepEqual([view.width, view.height], [layout.width, layout.height])

    const right = view.width - 1
    const bottom = view.height - 1
    assertColour(pixel(view, 0, 0), RED, 'top left corner')
    assertColour(pixel(view, right, 0), GREEN, 'top right corner')
    assertColour(pixel(view, 0, bottom), BLUE, 'bottom left corner')
    assertColour(pixel(view, right, bottom), YELLOW, 'bottom right corner')
    for (const x of [0, right]) {
      for (let y = 0; y < view.height; y += 7) {
        assert.ok(distance(pixel(view, x, y), WHITE) > 60, `edge pixel ${x},${y} is background`)
      }
    }

    // Content turns clockwise for a positive angle, so the middle line rises on the left.
    const aboveMiddleOnLeft = at(view, 0.05, 0.45)
    const belowMiddleOnLeft = at(view, 0.05, 0.55)
    if (angle > 0) {
      assertColour(aboveMiddleOnLeft, BLUE, 'left, just above the middle')
    } else {
      assertColour(belowMiddleOnLeft, RED, 'left, just below the middle')
    }
  })
}

test('a PDF page view cuts the decoded page like a photo', async () => {
  const decoded = await decode({
    version: 'media-decode/1',
    digest: sha(onePagePdf(900, 600)),
    bytes: onePagePdf(900, 600),
  })
  assert.equal(decoded.state, 'ready')
  const [page] = decoded.pages
  assert.deepEqual([page.width, page.height], [900, 600])
  // The region straddles the blue half's right edge at x = 450.
  const viewRecipe = recipe(page, { region: { x: 300, y: 100, width: 300, height: 400 } })
  const result = await ready(viewInput(page.bytes, viewRecipe))
  const layout = viewLayout(viewRecipe)
  const view = await rgb(result.view.bytes, 'webp')
  const thumb = await rgb(result.thumb.bytes, 'webp')

  assert.deepEqual([view.width, view.height], [layout.width, layout.height])
  assert.deepEqual([thumb.width, thumb.height], [layout.thumbWidth, layout.thumbHeight])
  assertColour(at(view, 0.25, 0.5), [0, 0, 255], 'left of the edge')
  assertColour(at(view, 0.75, 0.5), WHITE, 'right of the edge')
})

test('the marked preview differs from the view only where the marks are', async () => {
  const page = await quadrantPage()
  // A flat blue region, so every mark pixel stands out from the view.
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 20, y: 420, width: 560, height: 360 } },
  )
  const marks: MediaViewMarkDto[] = [
    { kind: 'box', geometry: { x: 1000, y: 1000, width: 2000, height: 2000 } },
    { kind: 'circle', geometry: { x: 6000, y: 1000, width: 2000, height: 3000 } },
    { kind: 'highlight', geometry: { x: 1000, y: 6000, width: 2000, height: 1000 } },
    { kind: 'arrow', geometry: { from: { x: 5000, y: 9000 }, to: { x: 7000, y: 7000 } } },
  ]
  const result = await ready(viewInput(page, viewRecipe, marks))
  const layout = viewLayout(viewRecipe)
  assert.ok(result.preview)
  assert.deepEqual([result.preview.width, result.preview.height], [layout.width, layout.height])
  const view = await rgb(result.view.bytes, 'webp')
  const preview = await rgb(result.preview.bytes, 'png')
  assert.deepEqual([preview.width, preview.height], [view.width, view.height])

  // The operator's view has no marks burned in.
  assertColour(at(view, 0.1, 0.2), BLUE, 'view under the box stroke')
  // Away from every mark, the preview is the view.
  for (const [x, y] of [
    [0.45, 0.3],
    [0.9, 0.5],
    [0.2, 0.85],
    [0.95, 0.95],
    [0.2, 0.2],
  ]) {
    assert.ok(
      distance(at(preview, x, y), at(view, x, y)) <= LOSSY_TOLERANCE,
      `preview differs away from marks at ${x},${y}`,
    )
  }
  // On each stroke the preview shows amber.
  assertColour(at(preview, 0.1, 0.2), AMBER, 'box left edge')
  assertColour(at(preview, 0.2, 0.1), AMBER, 'box top edge')
  assertColour(at(preview, 0.7, 0.4), AMBER, 'circle bottom')
  assertColour(at(preview, 0.6, 0.8), AMBER, 'arrow shaft')
  // A highlight is a translucent fill: changed, but not opaque amber.
  const highlighted = at(preview, 0.2, 0.65)
  assert.ok(distance(highlighted, at(view, 0.2, 0.65)) > LOSSY_TOLERANCE, 'highlight shows')
  assert.ok(distance(highlighted, AMBER) > LOSSY_TOLERANCE, 'highlight is translucent')
})

test('a label is an amber pill with dark text drawn in the bundled font', async () => {
  assert.equal(markFont(), MARK_FONT_FAMILY)
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 20, y: 420, width: 560, height: 360 } },
  )
  const marks: MediaViewMarkDto[] = [
    { kind: 'label', at: { x: 5000, y: 5000 }, label: 'Date code 2319' },
    { kind: 'box', geometry: { x: 1000, y: 1000, width: 3000, height: 2000 }, label: 'Pin 1' },
  ]
  const result = await ready(viewInput(page, viewRecipe, marks))
  assert.ok(result.preview)
  const preview = await rgb(result.preview.bytes, 'png')
  let amber = 0
  let text = 0
  for (let y = 0; y < preview.height; y++) {
    for (let x = 0; x < preview.width; x++) {
      const colour = pixel(preview, x, y)
      if (distance(colour, AMBER) <= 8) {
        amber++
      }
      if (distance(colour, LABEL_TEXT) <= 40) {
        text++
      }
    }
  }
  assert.ok(amber > 2000, `amber pill pixels: ${amber}`)
  assert.ok(text > 100, `label text pixels: ${text}`)
})

test('a label wider than a narrow view is drawn smaller so none of it is cut off', async () => {
  const page = await quadrantPage()
  // A tall, narrow region: the view is narrower than this label at its usual size.
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 500, y: 100, width: 200, height: 600 } },
  )
  const label = 'W'.repeat(24)
  const result = await ready(
    viewInput(page, viewRecipe, [{ kind: 'label', at: { x: 5000, y: 5000 }, label }]),
  )
  const preview = await rgb(result.preview!.bytes, 'png')

  // The pill's ends are padding: no text pixel reaches the view's left or right edge columns.
  for (const x of [0, 1, preview.width - 2, preview.width - 1]) {
    for (let y = 0; y < preview.height; y++) {
      assert.ok(
        distance(pixel(preview, x, y), LABEL_TEXT) > 40,
        `text at the edge, column ${x}, row ${y}`,
      )
    }
  }
  let text = 0
  for (let y = 0; y < preview.height; y++) {
    for (let x = 0; x < preview.width; x++) {
      if (distance(pixel(preview, x, y), LABEL_TEXT) <= 40) {
        text++
      }
    }
  }
  assert.ok(text > 40, `label text pixels: ${text}`)
})

test('a label in a wide, short view fits its height, and a hairline view still renders', async () => {
  const page = await quadrantPage()
  const label = 'W'.repeat(40)
  const wide = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 0, y: 380, width: 1200, height: 24 } },
  )
  const result = await ready(
    viewInput(page, wide, [{ kind: 'label', at: { x: 5000, y: 5000 }, label }]),
  )
  const preview = await rgb(result.preview!.bytes, 'png')
  // The pill and its text sit inside the view: nothing of the label is cut at the edges.
  for (const y of [0, preview.height - 1]) {
    for (let x = 0; x < preview.width; x++) {
      assert.ok(distance(pixel(preview, x, y), LABEL_TEXT) > 40, `text at row ${y}, column ${x}`)
    }
  }
  for (const x of [0, preview.width - 1]) {
    for (let y = 0; y < preview.height; y++) {
      assert.ok(distance(pixel(preview, x, y), LABEL_TEXT) > 40, `text at column ${x}, row ${y}`)
    }
  }

  // The label is drawn: its dark text shows inside the short view.
  let text = 0
  for (let y = 0; y < preview.height; y++) {
    for (let x = 0; x < preview.width; x++) {
      if (distance(pixel(preview, x, y), LABEL_TEXT) <= 60) {
        text++
      }
    }
  }
  assert.ok(text > 20, `label text pixels: ${text}`)

  // A view a few pixels wide still draws its label's glyphs, however small. Digits share one
  // advance width in the label font, so an '8' and a '1' get the same pill and differ only where
  // their glyphs are drawn.
  const measure = createCanvas(1, 1).getContext('2d')
  measure.font = `40px "${markFont()}"`
  assert.equal(measure.measureText('8').width, measure.measureText('1').width)
  const hairline = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 600, y: 0, width: 4, height: 800 } },
  )
  const hairlinePreview = async (marks: MediaViewMarkDto[]) => {
    const rendered = await ready(viewInput(page, hairline, marks))
    return rgb(rendered.preview!.bytes, 'png')
  }
  const labelled = (text: string) =>
    hairlinePreview([{ kind: 'label', at: { x: 5000, y: 5000 }, label: text }])
  const bare = await hairlinePreview([])
  const eight = await labelled('8')
  const one = await labelled('1')
  const footprint = (image: Raster) => {
    const changed: number[] = []
    for (let offset = 0; offset < image.data.length; offset += 3) {
      if (!image.data.subarray(offset, offset + 3).equals(bare.data.subarray(offset, offset + 3))) {
        changed.push(offset / 3)
      }
    }
    return changed
  }
  assert.ok(footprint(eight).length > 0, 'a pill is drawn')
  assert.deepEqual(footprint(eight), footprint(one), 'the same pill')
  assert.notDeepEqual(eight.data, one.data, 'the glyphs are drawn')
})

test('empty marks still give a preview; null marks give none', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 0, y: 0, width: 300, height: 200 } },
  )
  assert.equal((await ready(viewInput(page, viewRecipe))).preview, null)
  assert.ok((await ready(viewInput(page, viewRecipe, []))).preview)
})

test('page bytes that do not fit the recipe are malformed', async () => {
  const page = await quadrantPage()
  const page1 = { width: PAGE_WIDTH, height: PAGE_HEIGHT }
  const viewRecipe = recipe(page1, { region: { x: 0, y: 0, width: 300, height: 200 } })
  const malformed = { state: 'malformed', toolchain: MEDIA_TOOLCHAIN }

  // Declared size disagrees with the PNG's own header.
  assert.deepEqual(
    await renderView(viewInput(page, viewRecipe, null, { width: 1199, height: PAGE_HEIGHT })),
    malformed,
  )
  // The recipe's page size disagrees with the bytes.
  const wider = recipe({ width: 1300, height: PAGE_HEIGHT }, viewRecipe.view)
  assert.deepEqual(await renderView(viewInput(page, wider, null, page1)), malformed)
  // A region that leaves the page.
  const outside = recipe(page1, { region: { x: 1000, y: 0, width: 300, height: 200 } })
  assert.deepEqual(await renderView(viewInput(page, outside)), malformed)
  // Not a PNG at all.
  const jpeg = await sharp(page).jpeg().toBuffer()
  assert.deepEqual(await renderView(viewInput(jpeg, viewRecipe)), malformed)
})

test('bytes that do not match their digest are refused before rendering', async () => {
  const page = await quadrantPage()
  const viewRecipe = recipe(
    { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    { region: { x: 0, y: 0, width: 300, height: 200 } },
  )
  const input = { ...viewInput(page, viewRecipe), digest: 'b'.repeat(64) }
  await assert.rejects(renderView(input), /invalid_decode_input/)
})

test('a whole-page view of a page at the page pixel limit renders, its margin included', async () => {
  // 8000 × 6500 is the 52 MP page limit; the sampling margin takes the raw window past it.
  const page = { width: 8000, height: 6500 }
  const bytes = await sharp({
    create: { ...page, channels: 3, background: { r: 30, g: 60, b: 220 } },
  })
    .png({ compressionLevel: 1 })
    .toBuffer()

  const result = await ready(viewInput(bytes, recipe(page, {})))

  const layout = viewLayout(recipe(page, {}))
  const view = await rgb(result.view.bytes, 'webp')
  assert.deepEqual([view.width, view.height], [layout.width, layout.height])
  assertColour(at(view, 0.5, 0.5), BLUE, 'the middle')
})
