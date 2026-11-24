import { setTimeout as delay } from 'node:timers/promises'
import { database } from '#/db/database.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { mediaWorkerStep, pauseAfter } from '#/media/backfill.ts'
import { renderFigureStep, sweepFigureRenders } from '#/media/figure-renders.ts'
import { isolatedViewRenderer, RENDER_SWEEP_INTERVAL_MS } from '#/media/figure-render-consumer.ts'
import { readDevState } from './state.ts'

async function main() {
  const state = await readDevState(process.env.INTAKE_APP_STATE!)
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('immutable_decoder_required')
  }
  const db = database(state.mediaUrl)
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => stop.abort())
  }
  try {
    const store = await BlobStore.initialize(state.blobRoot, await readMediaStoreIdentity(db.pool))
    process.stdout.write('DEV_MEDIA_READY\n')
    const binding = {
      actorId: state.identity.actor,
      targetId: state.identity.target,
      targetContextId: state.identity.context,
    }
    // Question figures render here too, through the local launcher, beside decodes and backfill.
    const render = isolatedViewRenderer(image)
    let nextSweep = 0
    while (!stop.signal.aborted) {
      const step = await mediaWorkerStep(db.pool, store, binding, image)
      if (step === 'completed' || step === 'skipped_mismatch') {
        const event = step === 'completed' ? 'renditions_backfilled' : 'renditions_skipped_mismatch'
        process.stdout.write(JSON.stringify({ event }) + '\n')
      }
      if (Date.now() >= nextSweep) {
        await sweepFigureRenders(db.pool, store, binding)
        nextSweep = Date.now() + RENDER_SWEEP_INTERVAL_MS
      }
      const figure = await renderFigureStep(db.pool, store, binding, render)
      if (figure !== 'idle') {
        process.stdout.write(JSON.stringify({ event: 'figure_render', outcome: figure }) + '\n')
      }
      if (!pauseAfter(step) || figure !== 'idle') {
        continue
      }
      await delay(500, undefined, { signal: stop.signal }).catch(() => undefined)
    }
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write('Development decoder stopped; inspect retained commands.\n')
  process.exitCode = 1
})
