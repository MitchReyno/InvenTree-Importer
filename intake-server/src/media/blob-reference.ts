import { prepareMediaTransaction } from './transaction.ts'
import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { mediaBlobs } from './schema.ts'
import type { PoolClient } from 'pg'
import type { RetainedBlob } from './blob-store.ts'

export function inspectMediaType(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg'
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf'
  }
  return 'application/octet-stream'
}

export async function retainBlob(client: PoolClient, blob: RetainedBlob) {
  await prepareMediaTransaction(client)
  const db = queryDatabase(client)
  const digest = Buffer.from(blob.digest, 'hex')
  await executeDatabaseQuery(
    db.insert(mediaBlobs).values({ digest, byteSize: blob.size }).onConflictDoNothing(),
  )
  const rows = await executeDatabaseQuery(
    db
      .select({ byteSize: mediaBlobs.byteSize })
      .from(mediaBlobs)
      .where(eq(mediaBlobs.digest, digest)),
  )
  if (rows[0]?.byteSize !== blob.size) {
    throw new Error('blob_metadata_conflict')
  }
}

/** Positive references, not an increment/decrement refcount. Caller holds digest GC lock. */
export async function blobReferenced(client: PoolClient, digest: string): Promise<boolean> {
  await prepareMediaTransaction(client)
  const result = await client.query<{ referenced: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM media_version WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_preview WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_approval_pin WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_command_pin WHERE blob_digest=$1) AS referenced`,
    [Buffer.from(digest, 'hex')],
  )
  return result.rows[0].referenced
}
