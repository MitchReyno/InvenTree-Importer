import type { Pool } from 'pg'
import { fail, type CaptureBinding } from '../capture/repository.ts'
import type { BlobStore } from './blob-store.ts'

/** Object authorization precedes every private-byte read; hashes are never capabilities. */
export function mediaContent(pool: Pool, binding: CaptureBinding, store: BlobStore) {
  async function lookup(batchId: string, resourceId: string, kind: 'version' | 'preview') {
    const authorizedValues = [
      resourceId,
      batchId,
      binding.actorId,
      binding.targetId,
      binding.targetContextId,
    ]
    const versionSql = `
      SELECT v.blob_digest
      FROM media_version v JOIN capture_batch b ON b.id=v.batch_id
      WHERE v.id=$1 AND v.batch_id=$2 AND b.actor_id=$3
        AND b.target_id=$4 AND b.target_context_id=$5`
    const previewSql = `
      SELECT p.blob_digest
      FROM media_preview p JOIN capture_batch b ON b.id=p.batch_id
      WHERE p.id=$1 AND p.batch_id=$2 AND b.actor_id=$3
        AND b.target_id=$4 AND b.target_context_id=$5`
    const sql = kind === 'version' ? versionSql : previewSql
    const result = await pool.query<{ blob_digest: Buffer }>(sql, authorizedValues)
    const authorized = result.rows[0]
    if (!authorized) {
      fail('not_found', 404)
    }
    return store.read(authorized.blob_digest.toString('hex'))
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
