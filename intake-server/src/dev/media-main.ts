import { database } from '#/db/database.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { drainMedia } from '#/media/drain.ts'
import { localSlots } from '#/media/local-launcher.ts'
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
    await drainMedia(db.pool, store, binding, image, await localSlots(), stop.signal)
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write('Development decoder stopped; inspect retained commands.\n')
  process.exitCode = 1
})
