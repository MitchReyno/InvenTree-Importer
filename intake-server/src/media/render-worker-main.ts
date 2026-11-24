import { readMediaStoreIdentity } from './store-identity.ts'
import { mediaRuntimeConfig } from './runtime-config.ts'
import { database } from '#/db/database.ts'
import { id } from '#/execution/plan.ts'
import { BlobStore } from './blob-store.ts'
import { isolatedViewRenderer, runFigureRenderConsumer } from './figure-render-consumer.ts'

/** Supervised figure render consumer. No inventory/provider credentials or .env discovery. */
async function main() {
  const { databaseUrl, blobRoot } = mediaRuntimeConfig(process.env)
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  const actorId = process.env.INTAKE_ACTOR_ID
  const targetId = process.env.INTAKE_TARGET_ID
  const targetContextId = process.env.INTAKE_TARGET_CONTEXT_ID
  id(actorId)
  id(targetId)
  id(targetContextId)
  if (!image || image.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('explicit_media_worker_configuration_required')
  }
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => stop.abort())
  }
  const db = database(databaseUrl)
  try {
    const store = await BlobStore.initialize(blobRoot, await readMediaStoreIdentity(db.pool))
    process.stdout.write('FIGURE_RENDER_READY\n')
    await runFigureRenderConsumer({
      pool: db.pool,
      store,
      binding: { actorId: actorId!, targetId: targetId!, targetContextId: targetContextId! },
      render: isolatedViewRenderer(image),
      signal: stop.signal,
      onOutcome: (outcome) => {
        if (outcome !== 'idle') {
          process.stdout.write(JSON.stringify({ event: 'figure_render', outcome }) + '\n')
        }
      },
    })
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write('Figure render consumer stopped; queued renders stay for the next one.\n')
  process.exitCode = 1
})
