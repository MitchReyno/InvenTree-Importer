import { database } from '../db/database.ts'
import { id } from '../execution/plan.ts'
import { BlobStore } from './blob-store.ts'
import { processMediaCommand } from './worker.ts'

/** Explicit one-command local worker. No inventory/provider credentials or .env discovery. */
async function main() {
  const databaseUrl = process.env.INTAKE_DATABASE_URL
  const blobRoot = process.env.INTAKE_BLOB_ROOT
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  const actorId = process.env.INTAKE_ACTOR_ID
  const targetId = process.env.INTAKE_TARGET_ID
  const targetContextId = process.env.INTAKE_TARGET_CONTEXT_ID
  id(actorId)
  id(targetId)
  id(targetContextId)
  if (!databaseUrl || !blobRoot || !image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('explicit_media_worker_configuration_required')
  }
  const destination = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(destination.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(destination.hostname)
  ) {
    throw new Error('local_intake_database_required')
  }
  const store = await BlobStore.initialize(blobRoot)
  const db = database(databaseUrl)
  try {
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
