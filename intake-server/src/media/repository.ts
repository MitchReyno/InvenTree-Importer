import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { validate, type MediaReceiptDto } from '@invimport/contracts'
import { appendEvent, sha256 } from '#/db/authority.ts'
import { executeDatabaseQuery, transaction, queryDatabase } from '#/db/database.ts'
import { type CaptureBinding } from '#/capture/model.ts'
import { idempotentMedia } from './encoding.ts'
import { mediaEvidence, mediaVersions, mediaDecodeCommands } from './schema.ts'
import { BlobStore } from './blob-store.ts'
import { mediaSnapshot } from './read.ts'
import { inspectMediaType, retainBlob } from './blob-reference.ts'
import { advanceMediaRevision, lockMediaBatch, requireUploadCapacity } from './commands.ts'

export const DECODER_BUILD = 'bench-media-decoder/1'

export function mediaRepository(pool: Pool, binding: CaptureBinding, store: BlobStore) {
  return {
    snapshot(batchId: string) {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        return mediaSnapshot(client, binding, batchId)
      })
    },
    async upload(
      batchId: string,
      key: string,
      expectedRevision: string,
      label: string,
      bytes: Buffer,
    ) {
      return transaction(pool, (client) =>
        idempotentMedia(
          client,
          {
            actorId: binding.actorId,
            action: 'media_upload',
            resourceKey: `${binding.targetId}:${binding.targetContextId}:${batchId}`,
            key,
          },
          {
            expected_revision: expectedRevision,
            label,
            digest: sha256(bytes).toString('hex'),
          },
          async () => {
            const capture = await lockMediaBatch(client, binding, batchId, expectedRevision)
            await requireUploadCapacity(client, batchId)
            const blob = await store.publish(client, bytes)
            await retainBlob(client, blob)
            const evidenceId = randomUUID()
            const versionId = randomUUID()
            const mediaType = inspectMediaType(bytes)
            const db = queryDatabase(client)
            await executeDatabaseQuery(
              db.insert(mediaEvidence).values({
                id: evidenceId,
                batchId,
                label,
                actorId: binding.actorId,
              }),
            )
            await executeDatabaseQuery(
              db.insert(mediaVersions).values({
                id: versionId,
                batchId,
                evidenceId,
                kind: 'original',
                blobDigest: Buffer.from(blob.digest, 'hex'),
                mediaType,
                actorId: binding.actorId,
              }),
            )
            await executeDatabaseQuery(
              db.insert(mediaDecodeCommands).values({
                id: randomUUID(),
                batchId,
                versionId,
                build: DECODER_BUILD,
              }),
            )
            await advanceMediaRevision(client, batchId)
            const receipt: MediaReceiptDto = {
              status: 'retained',
              batch_id: batchId,
              evidence_id: evidenceId,
              version: {
                id: versionId,
                evidence_id: evidenceId,
                kind: 'original',
                digest: blob.digest,
                byte_size: blob.size,
                media_type: mediaType,
                state: 'queued',
                decoder_build: null,
                recipe: null,
                pages: [],
              },
            }
            await appendEvent(client, capture.streamId, 'media_retained', {
              batch_id: batchId,
              evidence_id: evidenceId,
              version_id: versionId,
            })
            validate('MediaReceipt', receipt)
            return receipt
          },
        ),
      )
    },
  }
}
