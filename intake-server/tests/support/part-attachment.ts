import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate, type CaptureSnapshotDto, type MediaReceiptDto } from '@invimport/contracts'
import type { manualFixture } from './manual.ts'
import { mediaRepository } from '#/media/repository.ts'
import { editMedia } from '#/media/edit.ts'
import { processMediaCommand } from '#/media/worker.ts'

export const PART_ATTACHMENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4ICLHdUIDAAhZAh0cg3OhAAAAAElFTkSuQmCC',
  'base64',
)

/** Owned qualification data only; no provider, environment discovery or live inventory. */
export async function seedPartAttachment(
  fixture: Awaited<ReturnType<typeof manualFixture>>,
  decoderImage: string,
) {
  const capture = await fixture.seedCapture()
  const category = await fixture.http(`/batches/${capture.batch.id}/observations`, {
    model: 'category',
    pk: '81',
  })
  assert.equal(category.status, 201, JSON.stringify(category.value))
  validate('CaptureObservation', category.value)
  const changed = await fixture.http(`/batches/${capture.batch.id}/edits`, {
    expected_revision: capture.batch.revision,
    change: {
      kind: 'part',
      id: capture.partId,
      choice: {
        mode: 'create',
        spec: {
          name: 'Shared Part with retained document',
          category: {
            observation_id: category.value.id,
            target_context_id: category.value.target_context_id,
            model: 'category',
            pk: category.value.pk,
          },
          parameters: [],
          manufacturer: null,
          supplier: null,
          tags: [],
        },
      },
    },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.value))
  validate('CaptureSnapshot', changed.value)
  const batch = changed.value as CaptureSnapshotDto
  assert.ok(fixture.store)
  const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store)
  let media = await repository.snapshot(batch.id)
  const uploaded = await repository.upload(
    batch.id,
    randomUUID(),
    media.revision,
    'Synthetic datasheet.png',
    PART_ATTACHMENT_PNG,
  )
  validate('MediaReceipt', uploaded)
  const receipt = uploaded as MediaReceiptDto
  assert.equal(
    await processMediaCommand(fixture.db.pool, fixture.store, fixture.config, decoderImage),
    true,
  )
  media = await repository.snapshot(batch.id)
  await editMedia(fixture.api.pool, fixture.config, batch.id, randomUUID(), {
    expected_revision: media.revision,
    change: {
      kind: 'link',
      evidence_id: receipt.evidence_id,
      subject_id: capture.partId,
      linked: true,
    },
  })
  media = await repository.snapshot(batch.id)
  await editMedia(fixture.api.pool, fixture.config, batch.id, randomUUID(), {
    expected_revision: media.revision,
    change: {
      kind: 'select_attachment',
      subject_id: capture.partId,
      mode: 'selected',
      version_id: receipt.version.id,
      destination: 'part_attachment',
    },
  })
  return { batch, a: capture.a, b: capture.b, partId: capture.partId, receipt }
}
