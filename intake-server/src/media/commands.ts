import { prepareMediaTransaction } from './transaction.ts'
import { count, eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { mediaBatches, mediaEvidence } from './schema.ts'
import type { PoolClient } from 'pg'
import { captureInTransaction } from '../capture/repository.ts'
import { fail, type CaptureBinding } from '../capture/model.ts'

/** Shared media publishers/readers serialize without granting decoders mutable draft rights. */
export async function lockMediaRevision(client: PoolClient, batchId: string) {
  await executeDatabaseQuery(
    queryDatabase(client).execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('bench-media-batch/1:' || ${batchId},0))`,
    ),
  )
}

/** Domain lock order: authorized capture batch, media revision, sorted blob digests, stream. */
export async function lockMediaBatch(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  expectedRevision: string,
) {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId, true)
  if (capture.snapshot.archived) {
    fail('batch_archived', 409)
  }
  await lockMediaRevision(client, batchId)
  await executeDatabaseQuery(
    queryDatabase(client).insert(mediaBatches).values({ batchId }).onConflictDoNothing(),
  )
  const current = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ revision: mediaBatches.revision })
      .from(mediaBatches)
      .where(eq(mediaBatches.batchId, batchId))
      .for('update'),
  )
  if (current[0].revision.toString() !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  return capture
}

export async function advanceMediaRevision(client: PoolClient, batchId: string) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(mediaBatches)
      .set({ revision: sql`${mediaBatches.revision}+1` })
      .where(eq(mediaBatches.batchId, batchId)),
  )
}

export async function requireUploadCapacity(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ count: count() })
      .from(mediaEvidence)
      .where(eq(mediaEvidence.batchId, batchId)),
  )
  if (rows[0].count >= 200) {
    fail('media_capacity', 409)
  }
}
