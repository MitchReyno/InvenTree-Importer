import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { validate, type CaptureSnapshotDto, type MediaReceiptDto } from '@invimport/contracts'
import { BlobStore } from '../../src/media/blob-store.ts'
import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { editMedia } from '../../src/media/edit.ts'
import { CaptureError, captureRepository } from '../../src/capture/repository.ts'
import { operatorRepository } from '../../src/operator-review/repository.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

function captureValue(value: unknown): CaptureSnapshotDto {
  validate('CaptureSnapshot', value)
  return value as CaptureSnapshotDto
}

function receiptValue(value: unknown): MediaReceiptDto {
  validate('MediaReceipt', value)
  return value as MediaReceiptDto
}

test('retired lots refuse new media links and attachment selections', async () => {
  const db = await isolatedDatabase()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-retired-media-')))
  try {
    const identity = await seedAuthority(db.pool)
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
    const capture = captureRepository(db.pool, binding)
    let batch = captureValue(await capture.create(randomUUID(), { title: 'Split bag', note: '' }))
    batch = captureValue(
      await capture.edit(batch.id, randomUUID(), {
        expected_revision: batch.revision,
        change: { kind: 'add_lot', label: 'Whole bag', note: 'Counted 20', part_subject_id: null },
      }),
    )
    const lotId = batch.lots[0].id
    const media = mediaRepository(db.pool, binding, store)
    const png = await sharp(Buffer.from([12, 34, 56]), {
      raw: { width: 1, height: 1, channels: 3 },
    })
      .png()
      .toBuffer()
    const receipt = receiptValue(await media.upload(batch.id, randomUUID(), '1', 'Bag photo', png))

    const operatorConfig = { ...binding, origin: 'http://127.0.0.1:9', credentialRef: 'owned-test' }
    await operatorRepository(db.pool, operatorConfig).restructure(batch.id, randomUUID(), {
      expected_revision: batch.revision,
      preview: false,
      change: {
        kind: 'split_lot',
        lot_id: lotId,
        children: [
          { label: 'Half one', quantity: '10' },
          { label: 'Half two', quantity: '10' },
        ],
      },
    })
    const retired = captureValue(await capture.read(batch.id))
    assert.equal(retired.lots.find((lot) => lot.id === lotId)?.retired, true)
    const active = retired.lots.filter((lot) => lot.id !== lotId)
    assert.ok(active.every((lot) => lot.retired === undefined))

    const mediaRevision = (await media.snapshot(batch.id)).revision
    const refusedLink = editMedia(db.pool, binding, batch.id, randomUUID(), {
      expected_revision: mediaRevision,
      change: { kind: 'link', evidence_id: receipt.evidence_id, subject_id: lotId, linked: true },
    })
    await assert.rejects(
      refusedLink,
      (error) => error instanceof CaptureError && error.code === 'lot_retired',
    )
    const refusedAttachment = editMedia(db.pool, binding, batch.id, randomUUID(), {
      expected_revision: mediaRevision,
      change: {
        kind: 'select_attachment',
        subject_id: lotId,
        mode: 'declined',
        version_id: null,
        destination: 'lot_attachment',
      },
    })
    await assert.rejects(
      refusedAttachment,
      (error) => error instanceof CaptureError && error.code === 'lot_retired',
    )

    const successor = active[0].id
    await editMedia(db.pool, binding, batch.id, randomUUID(), {
      expected_revision: mediaRevision,
      change: {
        kind: 'link',
        evidence_id: receipt.evidence_id,
        subject_id: successor,
        linked: true,
      },
    })
    const linked = await media.snapshot(batch.id)
    assert.deepEqual(
      linked.evidence.find((item) => item.id === receipt.evidence_id)?.linked_subject_ids,
      [successor],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await db.dispose()
  }
})
