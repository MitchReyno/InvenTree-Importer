import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { manualProcess } from '../support/manual-process.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { processMediaCommand } from '../../src/media/worker.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error('explicit_decoder_image_required')
}
const fixture = await manualProcess(4340, { media: true })
let stopped = false
let decoding: Promise<unknown> | null = null
try {
  await fixture.startWeb()
  const capture = await fixture.seedCapture()
  const width = 640
  const height = 480
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grid = x % 80 < 2 || y % 60 < 2
      const colour = grid
        ? [250, 250, 250]
        : [Math.round(x / 3), Math.round(y / 2), x < width / 2 ? 35 : 210]
      pixels.set(colour, (y * width + x) * 3)
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
  if (!fixture.store) {
    throw new Error('media_fixture_store_missing')
  }
  const store = fixture.store
  const receipt = await mediaRepository(fixture.api.pool, fixture.config, store).upload(
    capture.batch.id,
    randomUUID(),
    '1',
    'Asymmetric crop fixture.png',
    bytes,
  )
  await processMediaCommand(fixture.db.pool, store, fixture.config, image)
  // Explicit fixture worker only. It never starts the inventory apply runner.
  const timer = setInterval(() => {
    if (decoding || stopped) {
      return
    }
    decoding = processMediaCommand(fixture.db.pool, store, fixture.config, image)
      .catch(() => process.stderr.write('Owned preview decoder interrupted.\n'))
      .finally(() => {
        decoding = null
      })
  }, 1000)
  const artifacts = fileURLToPath(new URL('../../../.amp/in/artifacts/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  await writeFile(
    `${artifacts}/T05-preview.json`,
    JSON.stringify(
      {
        owner: 'T05',
        parent_pid: process.pid,
        web_pid: fixture.webChild?.pid,
        origin: fixture.config.origin,
        database_name: fixture.db.name,
        batch_id: capture.batch.id,
        decoder_image: image,
        receipt,
      },
      null,
      2,
    ) + '\n',
  )
  process.stdout.write(`Owned T05 media preview ${fixture.config.origin}/#${capture.batch.id}\n`)
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
  stopped = true
  clearInterval(timer)
  await decoding
} finally {
  await fixture.dispose()
}
