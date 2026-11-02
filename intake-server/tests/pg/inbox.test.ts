import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto, InboxListDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { seedAuthority } from '../support/database.ts'
import { captureRepository } from '../../src/capture/repository.ts'

const list = (value: unknown) => value as InboxListDto

test('inbox searches before pagination, treats wildcard text literally and scopes every result', async () => {
  const fixture = await manualFixture()
  try {
    const old = await fixture.http('/batches', { title: 'Old 100%_part', note: '' })
    assert.equal(old.status, 201)
    for (let index = 0; index < 101; index++) {
      assert.equal(
        (await fixture.http('/batches', { title: `Recent ${index}`, note: '' })).status,
        201,
      )
    }
    const recent = await fixture.http('/inbox?archived=exclude')
    assert.equal(recent.status, 200, JSON.stringify(recent.value))
    assert.equal(list(recent.value).batches.length, 10)
    assert.equal(list(recent.value).truncated, true)
    const next = list((await fixture.http('/inbox?archived=exclude&offset=10')).value)
    assert.equal(next.batches.length, 10)
    assert.equal(
      next.batches.some((batch) =>
        list(recent.value).batches.some((previous) => previous.id === batch.id),
      ),
      false,
    )
    const found = await fixture.http('/inbox?q=100%25_')
    assert.equal(found.status, 200, JSON.stringify(found.value))
    assert.deepEqual(
      list(found.value).batches.map((batch) => batch.id),
      [(old.value as CaptureSnapshotDto).id],
    )
    assert.equal(list(found.value).truncated, false)
    assert.equal(list((await fixture.http('/inbox?q=not-retained')).value).batches.length, 0)
    assert.equal((await fixture.http('/inbox?offset=-1')).status, 400)
    assert.equal((await fixture.http('/inbox?unexpected=x')).status, 400)
    const foreign = await seedAuthority(fixture.db.pool)
    await captureRepository(fixture.db.pool, {
      actorId: foreign.actor,
      targetId: foreign.target,
      targetContextId: foreign.context,
    }).create(randomUUID(), { title: 'Foreign private', note: '' })
    assert.equal(list((await fixture.http('/inbox?q=Foreign')).value).batches.length, 0)
    const sameActorForeignTarget = await captureRepository(fixture.db.pool, {
      actorId: fixture.identity.actor,
      targetId: foreign.target,
      targetContextId: foreign.context,
    }).create(randomUUID(), { title: 'Other target', note: '' })
    assert.ok(sameActorForeignTarget)
    assert.equal(list((await fixture.http('/inbox?q=Other')).value).batches.length, 0)
  } finally {
    await fixture.dispose()
  }
})

test('inbox observes exact review changes, archive visibility and original approval outcomes without target traffic', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    async function current() {
      const result = await fixture.http('/inbox')
      assert.equal(result.status, 200, JSON.stringify(result.value))
      return list(result.value).batches.find((batch) => batch.id === seeded.batch.id)!
    }
    let inbox = await current()
    assert.equal(inbox.workflow.lots, 2)
    assert.equal(inbox.workflow.ready, 0)
    assert.equal(inbox.workflow.needs_review, 2)
    assert.equal(inbox.workflow.thumbnail, null)
    assert.equal(inbox.workflow.latest_round, null)
    assert.equal(
      (
        await fixture.http(`/batches/${seeded.batch.id}/reviews`, {
          expected_batch_revision: seeded.batch.revision,
          selected_lot_ids: [seeded.a.id],
        })
      ).status,
      200,
    )
    inbox = await current()
    assert.equal(inbox.workflow.ready, 1)
    assert.equal(inbox.workflow.needs_review, 1)
    const prepared = await fixture.http(`/batches/${seeded.batch.id}/preparations`, {
      expected_batch_revision: seeded.batch.revision,
      selected_lot_ids: [seeded.a.id],
    })
    const preview = prepared.value.preparation
    assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
    const approved = await fixture.http(`/preparations/${preview.id}/approvals`, {
      preparation_id: preview.id,
      expected_plan_sha256: preview.plan_sha256,
      expected_review_fingerprint: preview.review_fingerprint,
      selected_lot_ids: preview.selected_lot_ids,
      expected_target_revision: preview.target_revision,
    })
    assert.equal(approved.status, 200, JSON.stringify(approved.value))
    inbox = await current()
    assert.equal(inbox.workflow.approved, 1)
    assert.equal(inbox.workflow.ready, 0)
    assert.equal(inbox.workflow.latest_round?.run_id, approved.value.run_id)
    assert.equal(inbox.workflow.latest_round?.confirmed_stock, 0)
    assert.equal(inbox.workflow.latest_round?.state, 'queued')
    const saved = (await fixture.http(`/batches/${seeded.batch.id}`)).value as CaptureSnapshotDto
    assert.equal(
      (
        await fixture.http(`/batches/${saved.id}/edits`, {
          expected_revision: saved.revision,
          change: { kind: 'batch', archived: true },
        })
      ).status,
      200,
    )
    assert.equal(list((await fixture.http('/inbox?archived=exclude')).value).batches.length, 0)
    assert.equal(
      list((await fixture.http('/inbox?archived=include')).value).batches[0].archived,
      true,
    )
  } finally {
    await fixture.dispose()
  }
})

test('inbox publishes only a ready retained original preview and never sends an inventory request', async () => {
  const fixture = await manualFixture({ media: true })
  try {
    const { mediaRepository } = await import('../../src/media/repository.ts')
    const { processMediaCommand } = await import('../../src/media/worker.ts')
    const sharp = (await import('sharp')).default
    const seeded = await fixture.seedCapture()
    assert.ok(fixture.store)
    const requestsBefore = await fixture.fake.records()
    const repository = mediaRepository(fixture.db.pool, fixture.config, fixture.store)
    const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#e8b6c9' } })
      .png()
      .toBuffer()
    const receipt = await repository.upload(
      seeded.batch.id,
      randomUUID(),
      '1',
      'Retained packet',
      png,
    )
    const before = list((await fixture.http('/inbox')).value).batches[0]
    assert.equal(before.workflow.thumbnail, null)
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    assert.ok(image, 'Explicit immutable decoder image is required')
    assert.equal(
      await processMediaCommand(fixture.db.pool, fixture.store, fixture.config, image),
      true,
    )
    const media = await repository.snapshot(seeded.batch.id)
    const ready = list((await fixture.http('/inbox')).value).batches[0]
    assert.deepEqual(ready.workflow.thumbnail, {
      preview_id: media.evidence[0].versions[0].pages[0].preview_id,
      label: 'Retained packet',
    })
    assert.ok(receipt)
    assert.deepEqual(await fixture.fake.records(), requestsBefore)
  } finally {
    await fixture.dispose()
  }
})
