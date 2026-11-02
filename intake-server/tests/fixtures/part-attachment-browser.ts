import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { manualProcess } from '../support/manual-process.ts'
import { seedPartAttachment } from '../support/part-attachment.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error('explicit_decoder_image_required')
}

const fixture = await manualProcess(4330, { media: true, effects: true })
try {
  await fixture.startWeb()
  const captured = await seedPartAttachment(fixture, image)
  await fixture.startRunner()
  const artifacts = fileURLToPath(new URL('../../../.amp/in/artifacts/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  await writeFile(`${artifacts}/part-attachment-preview.json`, JSON.stringify({
    owner: 'Drizzle phase two follow-ups', parent_pid: process.pid,
    origin: fixture.config.origin, batch_id: captured.batch.id,
    lot_a: captured.a.id, lot_b: captured.b.id, part_subject_id: captured.partId,
    version_id: captured.receipt.version.id,
  }, null, 2) + '\n')
  process.stdout.write(`Owned Part-attachment preview ${fixture.config.origin}/#${captured.batch.id}/review/${captured.a.id}\n`)
  await new Promise<void>(resolve => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
} finally {
  await fixture.dispose()
}
