import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  BatchAttentionDto,
  BatchRecordsDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function read<T>(fixture: Fixture, path: string) {
  const result = await fixture.http(path)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value as T
}

test('the attention read agrees with the review and manual reads it is built from', async () => {
  const fixture = await manualFixture({ processing: true })
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const { a, b } = seeded

    const before = await read<CaptureSnapshotDto>(fixture, `/batches/${batchId}`)
    const reviewed = await fixture.http(`/batches/${batchId}/reviews`, {
      expected_batch_revision: before.revision,
      selected_lot_ids: [a.id, b.id],
    })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))

    // Changing a reviewed lot puts it back in front of the operator.
    const current = await read<CaptureSnapshotDto>(fixture, `/batches/${batchId}`)
    const edited = await fixture.http(`/batches/${batchId}/bulk-edits`, {
      expected_revision: current.revision,
      preview: false,
      lot_ids: [b.id],
      change: { quantity: { mode: 'set', value: '24' } },
    })
    assert.equal(edited.status, 200, JSON.stringify(edited.value))

    const attention = await read<BatchAttentionDto>(fixture, `/batches/${batchId}/attention`)
    const review = await read<OperatorReviewDto>(fixture, `/batches/${batchId}/operator-review`)
    const manual = await read<ManualWorkspaceDto>(fixture, `/batches/${batchId}/manual`)
    const records = await read<BatchRecordsDto>(fixture, `/batches/${batchId}/records`)

    assert.equal(attention.batch_id, batchId)
    assert.equal(attention.revision, review.revision)
    assert.equal(
      attention.review.to_check,
      review.lots.filter((lot) => lot.review_state !== 'reviewed').length,
    )
    assert.equal(attention.review.changed_after_review, 1)
    // Decisions are the records waiting for a choice, the same count Review › Records shows.
    assert.equal(
      attention.review.to_decide,
      records.counts.reduce((sum, count) => sum + count.decide, 0),
    )
    assert.deepEqual(
      attention.items.filter((item) => item.group === 'decision').map((item) => item.key),
      records.records.filter((record) => record.decision).map((record) => `decision:${record.key}`),
    )
    assert.equal(
      attention.changes.ready,
      manual.lots.filter((lot) => lot.reviewed && lot.issues.length === 0).length,
    )
    const changed = attention.items.find((item) => item.key === `changed:${b.id}`)
    assert.equal(changed?.route, `${batchId}/review/lots/${b.id}`)
    assert.equal(
      attention.items.some((item) => item.key === `changed:${a.id}`),
      false,
    )
  } finally {
    await fixture.dispose()
  }
})
