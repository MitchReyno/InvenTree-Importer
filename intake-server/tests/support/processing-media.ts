import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { validate, type MediaEditDto, type MediaReceiptDto } from '@invimport/contracts'
import { BlobStore } from '../../src/media/blob-store.ts'
import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { editMedia } from '../../src/media/edit.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import type { processingFixture } from './processing.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** Owned image artifacts qualify metadata/pin integration only, never model image understanding. */
export async function processingMediaFixture(fixture: Fixture, batchId: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-processing-media-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(fixture.db.pool))
  const repository = mediaRepository(fixture.db.pool, fixture.config, store)
  const bytes = await sharp(Buffer.from([12, 34, 56]), {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer()

  async function edit(change: MediaEditDto['change']) {
    const snapshot = await repository.snapshot(batchId)
    return editMedia(fixture.db.pool, fixture.config, batchId, randomUUID(), {
      expected_revision: snapshot.revision,
      change,
    })
  }

  return {
    snapshot: () => repository.snapshot(batchId),
    edit,
    async upload(subjectId: string, label: string) {
      const snapshot = await repository.snapshot(batchId)
      const value = await repository.upload(batchId, randomUUID(), snapshot.revision, label, bytes)
      validate('MediaReceipt', value)
      const receipt = value as MediaReceiptDto
      await edit({
        kind: 'link',
        evidence_id: receipt.evidence_id,
        subject_id: subjectId,
        linked: true,
      })
      return receipt
    },
    async decodeNext() {
      const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
      assert.match(
        image ?? '',
        /^sha256:[a-f0-9]{64}$/,
        'Explicit immutable decoder image is required',
      )
      assert.equal(await processMediaCommand(fixture.db.pool, store, fixture.config, image!), true)
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}
