import { readMediaStoreIdentity } from './store-identity.ts'
import { mediaRuntimeConfig } from './runtime-config.ts'
import { database } from '../db/database.ts'
import { id } from '../execution/plan.ts'
import { BlobStore } from './blob-store.ts'
import { processMediaCommand } from './worker.ts'

/** Explicit one-command local worker. No inventory/provider credentials or .env discovery. */
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
  const db = database(databaseUrl)
  try {
    const store = await BlobStore.initialize(blobRoot, await readMediaStoreIdentity(db.pool))
    const processed = await processMediaCommand(
      db.pool,
      store,
      { actorId, targetId, targetContextId },
      image,
    )
    process.stdout.write(
      processed
        ? 'One retained media command processed.\n'
        : 'No eligible unclaimed media command.\n',
    )
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write(
    'Media worker stopped; inspect retained command state before any new request.\n',
  )
  process.exitCode = 1
})
