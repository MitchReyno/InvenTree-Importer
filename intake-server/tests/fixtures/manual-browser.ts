import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { manualProcess } from '../support/manual-process.ts'

// Explicit owned qualification fixture, never loaded by web/runtime imports.
// T02 keeps4310; this separate mutation-capable fake namespace reserves4330.
const reservation = createServer()
reservation.listen(4330, '127.0.0.1')
await once(reservation, 'listening')
await new Promise<void>((resolve) => reservation.close(() => resolve()))
// Opt-in supported-effects capability for explicit Part creation journeys.
const effects = process.env.INTAKE_PREVIEW_EFFECTS === '1'
const fixture = await manualProcess(4330, { effects })
try {
  await fixture.startWeb()
  const capture = await fixture.seedCapture()
  await fixture.startRunner()
  const artifacts = fileURLToPath(new URL('../../../.amp/in/artifacts/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  async function metadata() {
    await writeFile(
      `${artifacts}/T04-preview.json`,
      JSON.stringify(
        {
          owner: 'T04',
          capability: effects ? 'owned-fake-effects/1' : 'owned-fake-stock/1',
          parent_pid: process.pid,
          web_pid: fixture.webChild?.pid,
          runner_pid: fixture.runnerChild?.pid,
          origin: fixture.config.origin,
          fake_origin: fixture.fake.origin,
          database_name: fixture.db.name,
          batch_id: capture.batch.id,
          source_id: capture.batch.source_id,
          lot_a: capture.a.id,
          lot_b: capture.b.id,
          part_subject_id: capture.partId,
          private_state_directory: fixture.root,
        },
        null,
        2,
      ) + '\n',
    )
  }
  await metadata()
  process.stdout.write(`Owned T04 preview ${fixture.config.origin}/#${capture.batch.id}/review\n`)
  let restarting = false
  process.on('SIGUSR2', () => {
    if (restarting) {
      return
    }
    restarting = true
    void fixture
      .stopWeb()
      .then(() => fixture.startWeb())
      .then(metadata)
      .finally(() => {
        restarting = false
      })
  })
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
} finally {
  await fixture.dispose()
}
