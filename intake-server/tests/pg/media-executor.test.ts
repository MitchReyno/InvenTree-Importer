import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  validate,
  type MediaReceiptDto,
  type MediaSnapshotDto,
  type ManualPreviewDto,
  type ManualRunDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { editMedia } from '../../src/media/edit.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4ICLHdUIDAAhZAh0cg3OhAAAAAElFTkSuQmCC',
  'base64',
)

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function latestDispatch(fixture: Fixture, runId: string) {
  const dispatch = await fixture.db.pool.query<{ workflow_id: string; payload_bytes: Buffer }>(
    `SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id
     WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1`,
    [runId],
  )
  const command = dispatch.rows[0]
  return executeManualDispatch(
    fixture.runner.pool,
    fixture.runnerConfig,
    command.workflow_id,
    JSON.parse(command.payload_bytes.toString('utf8')),
  )
}

async function preparedAttachment(fixture: Fixture, image: string) {
  assert.ok(fixture.store)
  const capture = await fixture.seedCapture()
  const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store)
  const uploaded = await repository.upload(capture.batch.id, randomUUID(), '1', 'literal.png', png)
  validate('MediaReceipt', uploaded)
  const receipt = uploaded as MediaReceiptDto
  await processMediaCommand(fixture.db.pool, fixture.store, fixture.config, image)
  let snapshot = await repository.snapshot(capture.batch.id)
  assert.equal(snapshot.evidence[0].versions[0].state, 'ready')
  for (const change of [
    {
      kind: 'link' as const,
      evidence_id: receipt.evidence_id,
      subject_id: capture.a.id,
      linked: true,
    },
    {
      kind: 'select_attachment' as const,
      subject_id: capture.a.id,
      mode: 'selected' as const,
      version_id: receipt.version.id,
      destination: 'lot_attachment' as const,
    },
  ]) {
    const changed = await editMedia(
      fixture.api.pool,
      fixture.config,
      capture.batch.id,
      randomUUID(),
      {
        expected_revision: snapshot.revision,
        change,
      },
    )
    validate('MediaSnapshot', changed)
    snapshot = changed as MediaSnapshotDto
  }
  const scope = {
    expected_batch_revision: capture.batch.revision,
    selected_lot_ids: [capture.a.id],
  }
  const reviewed = await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  const result = await fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  assert.equal(result.value.status, 'prepared', JSON.stringify(result.value))
  const preview = result.value.preparation as ManualPreviewDto
  assert.equal(preview.capability, 'owned-fake-media/1')
  assert.equal(preview.attachments?.length, 1)
  assert.equal(preview.attachments[0].blob_sha256, createHash('sha256').update(png).digest('hex'))
  const accepted = await fixture.http(`/preparations/${preview.id}/approvals`, {
    preparation_id: preview.id,
    expected_plan_sha256: preview.plan_sha256,
    expected_review_fingerprint: preview.review_fingerprint,
    selected_lot_ids: preview.selected_lot_ids,
    expected_target_revision: preview.target_revision,
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
  const runId: string = accepted.value.run_id
  return { capture, preview, runId }
}

async function requestStart(fixture: Fixture, runId: string) {
  const run = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
  const start = await fixture.http(`/runs/${runId}/start`, { expected_run_revision: run.revision })
  assert.equal(start.status, 200, JSON.stringify(start.value))
  return latestDispatch(fixture, runId)
}

async function requestRecovery(fixture: Fixture, runId: string) {
  const run = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
  assert.equal(run.attachments?.length, 1)
  const accepted = await fixture.http(`/runs/${runId}/recover`, {
    expected_run_revision: run.revision,
    attachment_keys: [run.attachments[0].artifact_key],
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
  return latestDispatch(fixture, runId)
}

test('attachment no-effect repair preserves original approval and performs no second stock POST', async (context) => {
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  if (!image) {
    context.skip('explicit isolated decoder image required')
    return
  }
  const fixture = await manualFixture({ media: true })
  try {
    const { runId } = await preparedAttachment(fixture, image)
    await fixture.fake.fault('attachment_no_effect')
    const incomplete = await requestStart(fixture, runId)
    assert.deepEqual(incomplete.confirmedStockIds, ['7101'])
    assert.equal(incomplete.state, 'settled_incomplete')
    assert.equal(incomplete.attachments[0].certainty, 'none')
    await fixture.fake.fault('none')
    const repaired = await requestRecovery(fixture, runId)
    assert.equal(repaired.state, 'settled_complete')
    assert.equal(repaired.attachments[0].certainty, 'confirmed')
    assert.equal(repaired.attachments[0].remotePk, '8101')
    const posts = (await fixture.fake.records()).filter((request) => request.method === 'POST')
    assert.equal(posts.filter((request) => request.path === '/api/stock/').length, 1)
    assert.equal(posts.filter((request) => request.path === '/api/stock/attachment/').length, 2)
    assert.deepEqual(
      posts
        .filter((request) => request.path === '/api/stock/attachment/')
        .map((request) => request.body),
      [png, png],
    )
    const stored = await fixture.db.pool.query<{ bytes: Buffer; stock: string }>(
      'SELECT bytes,stock FROM fake_attachment',
    )
    assert.deepEqual(stored.rows, [{ bytes: png, stock: '7101' }])
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*)::int AS count FROM executor_approval')).rows[0]
        .count,
      1,
    )

    await fixture.db.pool.query('DELETE FROM fake_attachment WHERE pk=8101')
    const removed = await requestRecovery(fixture, runId)
    assert.equal(removed.attachments[0].certainty, 'confirmed')
    assert.equal(removed.attachments[0].verification, 'missing_or_changed')
    assert.equal(
      (await fixture.fake.records()).filter((request) => request.method === 'POST').length,
      posts.length,
    )
  } finally {
    await fixture.dispose()
  }
})

test('lost attachment ACK stays unknown until explicit hash-and-destination verification, never replacement', async (context) => {
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  if (!image) {
    context.skip('explicit isolated decoder image required')
    return
  }
  const fixture = await manualFixture({ media: true })
  try {
    const { runId } = await preparedAttachment(fixture, image)
    await fixture.fake.fault('attachment_drop_response')
    const unknown = await requestStart(fixture, runId)
    assert.equal(unknown.state, 'recovery_required')
    assert.equal(unknown.attachments[0].certainty, 'unknown')
    await fixture.fake.fault('attachment_wrong_destination')
    const wrong = await requestRecovery(fixture, runId)
    assert.equal(wrong.attachments[0].certainty, 'unknown')
    await fixture.fake.fault('attachment_changed_content')
    const corrupt = await requestRecovery(fixture, runId)
    assert.equal(corrupt.attachments[0].certainty, 'unknown')
    await fixture.fake.fault('none')
    const verified = await requestRecovery(fixture, runId)
    assert.equal(verified.state, 'settled_complete')
    assert.equal(verified.attachments[0].certainty, 'confirmed')
    const posts = (await fixture.fake.records()).filter((request) => request.method === 'POST')
    assert.deepEqual(
      posts.map((request) => request.path),
      ['/api/stock/', '/api/stock/attachment/'],
    )
  } finally {
    await fixture.dispose()
  }
})
