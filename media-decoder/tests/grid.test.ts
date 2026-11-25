import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { MEDIA_TOOLCHAIN } from '@invimport/contracts/media'
import { decode } from '../src/decode.ts'
import { renderGrid } from '../src/grid.ts'
import type { GridInput, GridResult } from '../src/decoder-protocol.ts'
import { fixtureBytes, parityFixtures, rgbRaster, sha, type GridFixture } from './support/parity.ts'

/** grid.py's default preview width. */
const SCRIPT_DEFAULT_WIDTH = 1000

async function benchPage() {
  const fixtures = await parityFixtures()
  const original = await fixtureBytes(fixtures.photo)
  const decoded = await decode({
    version: 'media-decode/1',
    digest: sha(original),
    bytes: original,
  })
  assert.equal(decoded.state, 'ready')
  return decoded.pages[0]
}

type Corners = [number, number, number, number]

function region([x0, y0, x1, y1]: Corners) {
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The request grid.py's command line describes. */
function gridInput(
  page: { bytes: Buffer; width: number; height: number },
  fixture: GridFixture,
): GridInput {
  const input: GridInput = {
    version: 'media-grid/1',
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: null,
    preview_width: SCRIPT_DEFAULT_WIDTH,
    step: null,
    object: null,
    boxes: [],
  }
  const args = [...fixture.arguments]
  while (args.length > 0) {
    const option = args.shift()
    const numbers = () => args.splice(0, 4).map(Number) as Corners
    if (option === '--region') {
      input.region = region(numbers())
    } else if (option === '--width') {
      input.preview_width = Number(args.shift())
    } else if (option === '--step') {
      input.step = Number(args.shift())
    } else if (option === '--object') {
      input.object = region(numbers())
    } else if (option === '--box') {
      const box = region(numbers())
      const named = args.length > 0 && !args[0].startsWith('--')
      const name = named ? args.shift()! : `box${input.boxes.length + 1}`
      input.boxes.push({ name, box })
    } else {
      throw new Error(`unexpected grid.py option ${option}`)
    }
  }
  return input
}

/** The result in grid.py's printed format, so the two can be compared line by line. */
function printed(
  result: Extract<GridResult, { state: 'ready' }>,
  page: { width: number; height: number },
) {
  const { x, y, width, height } = result.region
  const lines = [
    `source ${page.width}x${page.height}, region ${x},${y}-${x + width},${y + height}, ` +
      `preview scale ${result.scale.toFixed(3)}, grid every ${result.step}px`,
  ]
  for (const item of result.boxes) {
    const { box } = item
    let line =
      `${item.name}: ${box.x},${box.y}-${box.x + box.width},${box.y + box.height}  ` +
      `${box.width}x${box.height}  aspect ${item.aspect.toFixed(2)}`
    if (item.margins) {
      const { left, right, top, bottom } = item.margins
      line += `  margins L${left} R${right} T${top} B${bottom}`
    }
    if (item.clips) {
      line += '  CLIPS THE OBJECT'
    } else if (item.off_centre.length > 0) {
      line += `  OFF-CENTRE in ${item.off_centre.join('/')}`
    }
    lines.push(line)
  }
  return lines
}

test('grid scale, step and box measurements match the script', async () => {
  const page = await benchPage()
  const fixtures = await parityFixtures()
  for (const fixture of fixtures.grids) {
    const result = await renderGrid(gridInput(page, fixture))
    assert.equal(result.state, 'ready', fixture.name)
    assert.equal(result.toolchain, MEDIA_TOOLCHAIN)
    assert.deepEqual(printed(result, page), fixture.printed, fixture.name)
  }
})

test('grid labels are in page pixels, whatever the preview scale', async () => {
  const page = await benchPage()
  const fixtures = await parityFixtures()
  const zoom = fixtures.grids.find((item) => item.name === 'zoom')!
  const result = await renderGrid(gridInput(page, zoom))
  assert.equal(result.state, 'ready')
  // Region 150,160-330,240 at scale 5 and step 10 labels every 10 page pixels.
  assert.deepEqual(
    result.x_labels,
    [160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320],
  )
  assert.deepEqual(result.y_labels, [170, 180, 190, 200, 210, 220, 230])
  // The 'lopsided' name would cover 'even's, so it moves to another corner of its box.
  assert.deepEqual(
    result.boxes.map((item) => item.drawn_label),
    ['even', 'lopsided', 'clipping'],
  )

  const image = await rgbRaster(result.image.bytes)
  assert.deepEqual([image.width, image.height], [900, 400])
  assert.deepEqual([result.image.width, result.image.height], [900, 400])
  // Page x 250 is a major line, drawn in strong red at preview x (250 - 150) * 5; row 270 is
  // clear of the horizontal lines, the object's outline and the boxes.
  const column = (250 - 150) * 5
  const offset = (270 * image.width + column) * 3
  assert.deepEqual([...image.data.subarray(offset, offset + 3)], [230, 0, 0])
})

test('a dense grid labels every other line', async () => {
  const page = await benchPage()
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: null,
    preview_width: 400,
    step: 20,
    object: null,
    boxes: [],
  })
  assert.equal(result.state, 'ready')
  // 20 page pixels is under 45 preview pixels at this scale, so labels fall every 40.
  assert.deepEqual(result.x_labels, [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440])
})

test('a preview too tall for its width is over the limit', async () => {
  const bytes = await sharp({
    create: { width: 10, height: 5000, channels: 3, background: '#808080' },
  })
    .png()
    .toBuffer()
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: sha(bytes),
    width: 10,
    height: 5000,
    bytes,
    region: null,
    preview_width: 2000,
    step: null,
    object: null,
    boxes: [],
  })
  assert.deepEqual(result, { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN })
})

test('the line budget counts the lines drawn: 400 render, 401 are refused', async () => {
  const grid = async (width: number) => {
    const bytes = await sharp({
      create: { width, height: 100, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer()
    return renderGrid({
      version: 'media-grid/1',
      digest: sha(bytes),
      width,
      height: 100,
      bytes,
      region: null,
      preview_width: 800,
      step: 2,
      object: null,
      boxes: [],
    })
  }
  // Step 2 across 801 px draws lines at 2, 4 ... 800; across 803 px it adds one at 802.
  assert.equal((await grid(801)).state, 'ready')
  assert.deepEqual(await grid(803), { state: 'limit_exceeded', toolchain: MEDIA_TOOLCHAIN })
})

test('a region is clipped to the page, as the script does, and one wholly outside is malformed', async () => {
  const page = await benchPage()
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 400, y: 0, width: 200, height: 100 },
    preview_width: 500,
    step: null,
    object: null,
    boxes: [],
  })
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.region, { x: 400, y: 0, width: 80, height: 100 })
  const outside = await renderGrid({
    version: 'media-grid/1',
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 500, y: 0, width: 20, height: 100 },
    preview_width: 500,
    step: null,
    object: null,
    boxes: [],
  })
  assert.deepEqual(outside, { state: 'malformed', toolchain: MEDIA_TOOLCHAIN })
})

test('a label at the preview edge is drawn inside it, on the line’s other side', async () => {
  const page = await benchPage()
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: sha(page.bytes),
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 0, y: 0, width: 200, height: 200 },
    preview_width: 200,
    step: 199,
    object: null,
    boxes: [],
  })
  assert.ok(result.state === 'ready')
  assert.deepEqual([result.x_labels, result.y_labels], [[199], [199]])
  const image = await rgbRaster(result.image.bytes)
  const isLabelInk = (x: number, y: number, channel: 0 | 2) => {
    const offset = (y * image.width + x) * 3
    const [red, green, blue] = image.data.subarray(offset, offset + 3)
    return channel === 0
      ? red > 150 && green < 60 && blue < 60
      : blue > 150 && red < 60 && green < 60
  }
  let xInk = 0
  let yInk = 0
  for (let y = 0; y < 20; y++) {
    for (let x = 150; x < 197; x++) {
      xInk += isLabelInk(x, y, 0) ? 1 : 0
    }
  }
  for (let y = 175; y < 197; y++) {
    for (let x = 0; x < 40; x++) {
      yInk += isLabelInk(x, y, 2) ? 1 : 0
    }
  }
  assert.ok(xInk > 10, 'the x label is drawn left of its line')
  assert.ok(yInk > 10, 'the y label is drawn above its line')
})

async function greyPage(width: number, height: number) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#808080' } })
    .png()
    .toBuffer()
  return { bytes, width, height, digest: sha(bytes) }
}

async function gridOf(
  page: Awaited<ReturnType<typeof greyPage>>,
  region: { x: number; y: number; width: number; height: number },
  previewWidth: number,
  step: number,
) {
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: page.digest,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region,
    preview_width: previewWidth,
    step,
    object: null,
    boxes: [],
  })
  assert.ok(result.state === 'ready')
  return { result, image: await rgbRaster(result.image.bytes) }
}

/** The x position of every column holding a white label chip in rows `top` to `bottom`. */
function chipColumns(image: Awaited<ReturnType<typeof rgbRaster>>, top: number, bottom: number) {
  const columns: number[] = []
  for (let x = 0; x < image.width; x++) {
    for (let y = top; y < bottom; y++) {
      const offset = (y * image.width + x) * 3
      if (
        image.data[offset] === 255 &&
        image.data[offset + 1] === 255 &&
        image.data[offset + 2] === 255
      ) {
        columns.push(x)
        break
      }
    }
  }
  return columns
}

test('a preview too short for x labels reports none, rather than labels it clipped', async () => {
  const page = await greyPage(2000, 50)
  const { result, image } = await gridOf(page, { x: 0, y: 0, width: 2000, height: 50 }, 200, 100)
  assert.deepEqual([image.width, image.height], [200, 5])
  assert.deepEqual(result.x_labels, [])
  assert.deepEqual(chipColumns(image, 0, image.height), [])
})

test('dense lines are labelled only as often as their labels fit apart', async () => {
  const page = await greyPage(400, 400)
  const { result, image } = await gridOf(page, { x: 0, y: 0, width: 200, height: 200 }, 200, 1)
  assert.ok(result.x_labels.length > 0, 'some x labels are drawn')
  assert.ok(result.x_labels.length < 20, `x labels thinned: ${result.x_labels.length}`)
  // Each drawn x label is its own run of chip columns, separated by grey.
  const columns = chipColumns(image, 0, 18)
  let runs = 0
  for (const [index, column] of columns.entries()) {
    if (index === 0 || column !== columns[index - 1] + 1) {
      runs++
    }
  }
  assert.equal(runs, result.x_labels.length, 'one separate chip per reported label')
  const gaps = result.y_labels.slice(1).map((label, index) => label - result.y_labels[index])
  assert.ok(
    gaps.every((gap) => gap >= 18),
    `y labels at least a label's height apart: ${gaps}`,
  )
})

test('a line at the region edge is drawn inside the preview, with its label', async () => {
  const page = await greyPage(2000, 2000)
  const { result, image } = await gridOf(page, { x: 0, y: 0, width: 2000, height: 2000 }, 200, 1999)
  assert.deepEqual(result.x_labels, [1999])
  // Page x 1999 falls in the preview's last column, which holds the line.
  const lineColumn = 199
  const offset = (100 * image.width + lineColumn) * 3
  const [red, green, blue] = image.data.subarray(offset, offset + 3)
  assert.ok(red > 200 && green < 160 && blue < 160, `line pixel ${red},${green},${blue}`)
})

/**
 * The runs of columns holding a white chip in rows `top` to `bottom`, each with the colour of the
 * ink it holds: red for an x label, blue for a y label, otherwise a box name.
 */
function chipRuns(image: Awaited<ReturnType<typeof rgbRaster>>, top: number, bottom: number) {
  const runs: { from: number; to: number; ink: 'red' | 'blue' | 'other' }[] = []
  for (const column of chipColumns(image, top, bottom)) {
    const last = runs.at(-1)
    if (last && column === last.to + 1) {
      last.to = column
    } else {
      runs.push({ from: column, to: column, ink: 'other' })
    }
  }
  for (const run of runs) {
    for (let y = top; y < bottom; y++) {
      for (let x = run.from; x <= run.to; x++) {
        const offset = (y * image.width + x) * 3
        const [red, green, blue] = image.data.subarray(offset, offset + 3)
        if (red > 120 && green < 90 && blue < 90) {
          run.ink = 'red'
        } else if (blue > 120 && red < 90 && green < 90) {
          run.ink = 'blue'
        }
      }
    }
  }
  return runs
}

test('a box name never hides an axis label the result reports', async () => {
  const page = await greyPage(400, 400)
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: page.digest,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 0, y: 0, width: 200, height: 200 },
    preview_width: 200,
    step: 100,
    object: null,
    boxes: [{ name: 'crop box', box: { x: 97, y: 0, width: 60, height: 60 } }],
  })
  assert.ok(result.state === 'ready')
  const image = await rgbRaster(result.image.bytes)
  // Text rows only, where a chip covers any grid line behind it.
  const runs = chipRuns(image, 5, 16)
  assert.equal(runs.filter((run) => run.ink === 'red').length, result.x_labels.length)
  assert.ok(!result.x_labels.includes(100), 'the label under the box name is left out')
  assert.ok(
    runs.some((run) => run.ink === 'other'),
    'the box name is drawn',
  )
})

test('a y label clear of the x labels is kept, as grid.py keeps it', async () => {
  const page = await greyPage(400, 400)
  const { result, image } = await gridOf(page, { x: 20, y: 95, width: 200, height: 200 }, 200, 100)
  assert.deepEqual(result.x_labels, [100, 200])
  assert.deepEqual(result.y_labels, [100, 200])
  const runs = chipRuns(image, 9, 20)
  assert.ok(
    runs.some((run) => run.ink === 'blue'),
    'the y label at the top is drawn',
  )
})

test('x labels fit a preview only just taller than their chips', async () => {
  const page = await greyPage(2000, 170)
  const { result, image } = await gridOf(page, { x: 0, y: 0, width: 2000, height: 170 }, 200, 500)
  assert.deepEqual([image.width, image.height], [200, 17])
  assert.deepEqual(result.x_labels, [500, 1000, 1500])
  assert.equal(chipRuns(image, 0, 17).filter((run) => run.ink === 'red').length, 3)
})

test('label spacing is measured on the labels drawn, not the undrawn region end', async () => {
  const page = await greyPage(10_000, 200)
  // The region ends at 10000, a five-digit number no label shows; every label is four digits.
  const { result } = await gridOf(page, { x: 9800, y: 0, width: 200, height: 200 }, 225, 40)
  assert.deepEqual(result.x_labels, [9840, 9880, 9920, 9960])
})

test('two boxes sharing a top-left corner both get a visible name', async () => {
  const page = await greyPage(400, 400)
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: page.digest,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 0, y: 0, width: 400, height: 400 },
    preview_width: 400,
    step: 200,
    object: null,
    boxes: [
      { name: 'outer', box: { x: 50, y: 50, width: 200, height: 200 } },
      { name: 'inner', box: { x: 50, y: 50, width: 120, height: 90 } },
    ],
  })
  assert.ok(result.state === 'ready')
  assert.deepEqual(
    result.boxes.map((item) => item.drawn_label),
    ['outer', 'inner'],
  )
  const image = await rgbRaster(result.image.bytes)
  // The two box colours' ink: green for the first name, orange for the second.
  let green = 0
  let orange = 0
  for (let offset = 0; offset < image.data.length; offset += 3) {
    const [red, greenChannel, blue] = image.data.subarray(offset, offset + 3)
    const chipNeighbour = offset >= 3 && image.data[offset - 3] === 255
    if (!chipNeighbour) {
      continue
    }
    if (greenChannel > 150 && red < 90 && blue < 90) {
      green++
    } else if (red > 200 && greenChannel > 100 && greenChannel < 180 && blue < 80) {
      orange++
    }
  }
  assert.ok(green > 5, 'the first name is visible')
  assert.ok(orange > 5, 'the second name is visible')
})

test('a box whose name fits nowhere is keyed by its number', async () => {
  const page = await greyPage(400, 400)
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: page.digest,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    // A 240 × 24 preview: the second long name collides with the first in every place it fits.
    region: { x: 0, y: 0, width: 120, height: 12 },
    preview_width: 240,
    step: 100,
    object: null,
    boxes: [
      { name: 'the first proposed crop box', box: { x: 0, y: 0, width: 120, height: 12 } },
      { name: 'the second proposed crop box', box: { x: 0, y: 0, width: 120, height: 12 } },
    ],
  })
  assert.ok(result.state === 'ready')
  assert.deepEqual([result.image.width, result.image.height], [240, 24])
  assert.deepEqual(
    result.boxes.map((item) => item.drawn_label),
    ['the first proposed crop box', '2'],
  )
})

/** The bounding rows of white chip pixels in the image, or null when there are none. */
function chipRows(image: Awaited<ReturnType<typeof rgbRaster>>) {
  let top = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 3
      if (
        image.data[offset] === 255 &&
        image.data[offset + 1] === 255 &&
        image.data[offset + 2] === 255
      ) {
        top = top < 0 ? y : top
        bottom = y
        break
      }
    }
  }
  return top < 0 ? null : { top, bottom }
}

async function oneBoxGrid(name: string) {
  const page = await greyPage(400, 400)
  // No grid lines fall inside the region, so the box name is the only chip.
  const result = await renderGrid({
    version: 'media-grid/1',
    digest: page.digest,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    region: { x: 0, y: 0, width: 200, height: 100 },
    preview_width: 200,
    step: 1000,
    object: null,
    boxes: [{ name, box: { x: 20, y: 0, width: 150, height: 100 } }],
  })
  assert.ok(result.state === 'ready')
  assert.deepEqual([result.x_labels, result.y_labels], [[], []])
  return { result, image: await rgbRaster(result.image.bytes) }
}

test('a box name of spaces draws no ink, so the box is keyed by its number', async () => {
  const { result, image } = await oneBoxGrid('   ')
  assert.equal(result.boxes[0].drawn_label, '1')
  assert.notEqual(chipRows(image), null)
})

test('a name whose accents rise above the line moves to where all its ink fits', async () => {
  const plain = await oneBoxGrid('A')
  // At the box's top-left inner corner, 4 px down, a plain name's chip starts at row 3.
  assert.equal(plain.result.boxes[0].drawn_label, 'A')
  assert.equal(chipRows(plain.image)!.top, 3)
  // Stacked accents rise about 8 px above the text line, past the preview's top edge there.
  const accented = 'Á̂̃'
  const { result, image } = await oneBoxGrid(accented)
  assert.equal(result.boxes[0].drawn_label, accented)
  const rows = chipRows(image)!
  assert.ok(rows.top > 3, `the chip moved down from the top edge: rows ${rows.top}-${rows.bottom}`)
})
