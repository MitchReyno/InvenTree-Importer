import { database, transaction } from '../db/database.ts'
import { BlobStore, MIN_GC_AGE_MS } from './blob-store.ts'
import { blobReferenced } from './blob-reference.ts'
import { mediaRuntimeConfig } from './runtime-config.ts'
import { readMediaStoreIdentity } from './store-identity.ts'
import { prepareMediaTransaction } from './transaction.ts'

/** Explicit single-candidate maintenance. Never scans, unpins or deletes retained history. */
async function main() {
  const config = mediaRuntimeConfig(process.env)
  const digest = process.env.INTAKE_MEDIA_GC_DIGEST
  const suppliedCutoff = process.env.INTAKE_MEDIA_GC_BEFORE
  if (!digest || digest.length !== 64 || !/^[a-f0-9]+$/.test(digest) || !suppliedCutoff) {
    throw new Error('explicit_media_gc_candidate_required')
  }
  const cutoff = new Date(suppliedCutoff)
  if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now() - MIN_GC_AGE_MS) {
    throw new Error('safe_media_gc_cutoff_required')
  }
  const db = database(config.databaseUrl)
  try {
    const collected = await transaction(db.pool, async (client) => {
      await prepareMediaTransaction(client)
      const storeId = await readMediaStoreIdentity(client)
      const store = await BlobStore.initialize(config.blobRoot, storeId)
      return store.collect(client, digest, cutoff, blobReferenced)
    })
    process.stdout.write(JSON.stringify({ digest, cutoff: cutoff.toISOString(), collected }) + '\n')
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write(
    'Media collection refused or interrupted; retained references remain authoritative.\n',
  )
  process.exitCode = 1
})
