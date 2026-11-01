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
  await client.query(
    'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [Buffer.from(blob.digest, 'hex'), blob.size],
  )
  const result = await client.query<{ byte_size: string }>(
    'SELECT byte_size FROM media_blob WHERE digest=$1',
    [Buffer.from(blob.digest, 'hex')],
  )
  if (result.rows[0]?.byte_size !== blob.size) {
    throw new Error('blob_metadata_conflict')
  }
}

/** Positive references, not an increment/decrement refcount. Caller holds digest GC lock. */
export async function blobReferenced(client: PoolClient, digest: string): Promise<boolean> {
  const result = await client.query<{ referenced: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM media_version WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_preview WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_approval_pin WHERE blob_digest=$1)
         OR EXISTS(SELECT 1 FROM media_command_pin WHERE blob_digest=$1) AS referenced`,
    [Buffer.from(digest, 'hex')],
  )
  return result.rows[0].referenced
}
