import type { PoolClient } from 'pg'
import { captureInTransaction, fail, type CaptureBinding } from '../capture/repository.ts'

/** Shared media publishers/readers serialize without granting decoders mutable draft rights. */
export async function lockMediaRevision(client: PoolClient, batchId: string) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('bench-media-batch/1:' || $1,0))",
    [batchId],
  )
}

/** Domain lock order: authorized capture batch, media revision, sorted blob digests, stream. */
export async function lockMediaBatch(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  expectedRevision: string,
) {
  const capture = await captureInTransaction(client, binding, batchId, true)
  if (capture.snapshot.archived) {
    fail('batch_archived', 409)
  }
  await client.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
    batchId,
  ])
  const current = await client.query<{ revision: string }>(
    'SELECT revision FROM media_batch WHERE batch_id=$1 FOR UPDATE',
    [batchId],
  )
  if (current.rows[0].revision !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  return capture
}

export async function advanceMediaRevision(client: PoolClient, batchId: string) {
  await client.query('UPDATE media_batch SET revision=revision+1 WHERE batch_id=$1', [batchId])
}

export async function requireUploadCapacity(client: PoolClient, batchId: string) {
  const count = await client.query<{ count: string }>(
    'SELECT count(*) FROM media_evidence WHERE batch_id=$1',
    [batchId],
  )
  if (BigInt(count.rows[0].count) >= 200n) {
    fail('media_capacity', 409)
  }
}
