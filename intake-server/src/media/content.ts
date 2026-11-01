import { prepareMediaTransaction } from './transaction.ts'
import type { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { captureInTransaction, fail, type CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { mediaPreviews, mediaVersions } from './schema.ts'
import type { BlobStore } from './blob-store.ts'

/** Object authorization precedes every private-byte read; hashes are never capabilities. */
export function mediaContent(pool: Pool, binding: CaptureBinding, store: BlobStore) {
  async function lookup(batchId: string, resourceId: string, kind: 'version' | 'preview') {
    const digest = await transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      await captureInTransaction(client, binding, batchId)
      const db = queryDatabase(client)
      const rows =
        kind === 'version'
          ? await executeDatabaseQuery(
              db
                .select({ digest: mediaVersions.blobDigest })
                .from(mediaVersions)
                .where(and(eq(mediaVersions.id, resourceId), eq(mediaVersions.batchId, batchId))),
            )
          : await executeDatabaseQuery(
              db
                .select({ digest: mediaPreviews.blobDigest })
                .from(mediaPreviews)
                .where(and(eq(mediaPreviews.id, resourceId), eq(mediaPreviews.batchId, batchId))),
            )
      if (!rows.length) {
        fail('not_found', 404)
      }
      return rows[0].digest.toString('hex')
    })
    // Immutable retained version/preview references keep this exact blob ineligible for GC.
    return store.read(digest)
  }

  return {
    original(batchId: string, versionId: string) {
      return lookup(batchId, versionId, 'version')
    },

    preview(batchId: string, previewId: string) {
      return lookup(batchId, previewId, 'preview')
    },
  }
}
