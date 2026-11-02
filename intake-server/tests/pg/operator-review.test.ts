import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  BulkEditResultDto,
  CaptureSnapshotDto,
  ManualPreviewDto,
  OperatorReviewDto,
  RestructureResultDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function capture(fixture: Fixture, batchId: string) {
  const result = await fixture.http(`/batches/${batchId}`)
  assert.equal(result.status, 200)
  return result.value as CaptureSnapshotDto
}

async function operator(fixture: Fixture, batchId: string) {
  const result = await fixture.http(`/batches/${batchId}/operator-review`)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value as OperatorReviewDto
}

function lotState(review: OperatorReviewDto, lotId: string) {
  return review.lots.find((lot) => lot.lot_id === lotId)?.review_state
}

async function review(fixture: Fixture, batchId: string, lotIds: string[]) {
  const current = await capture(fixture, batchId)
  return fixture.http(`/batches/${batchId}/reviews`, {
    expected_batch_revision: current.revision,
    selected_lot_ids: lotIds,
  })
}

async function bulk(
  fixture: Fixture,
  batchId: string,
  lotIds: string[],
  change: Record<string, unknown>,
  preview: boolean,
) {
  const current = await capture(fixture, batchId)
  return fixture.http(`/batches/${batchId}/bulk-edits`, {
    expected_revision: current.revision,
    preview,
    lot_ids: lotIds,
    change,
  })
}

async function restructure(
  fixture: Fixture,
  batchId: string,
  change: Record<string, unknown>,
  preview = false,
) {
  const current = await capture(fixture, batchId)
  return fixture.http(`/batches/${batchId}/restructures`, {
    expected_revision: current.revision,
    preview,
    change,
  })
}

async function edit(fixture: Fixture, batchId: string, change: Record<string, unknown>) {
  const current = await capture(fixture, batchId)
  return fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: current.revision,
    change,
  })
}

async function selectionCount(fixture: Fixture, batchId: string) {
  const result = await fixture.db.pool.query(
    'SELECT count(*)::int AS count FROM capture_selection WHERE batch_id=$1',
    [batchId],
  )
  return result.rows[0].count as number
}

test('shared Part edits invalidate A and B; lot-only and default edits stay scoped', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const { a, b } = seeded

    assert.equal((await review(fixture, batchId, [a.id, b.id])).status, 200)
    let current = await operator(fixture, batchId)
    assert.equal(lotState(current, a.id), 'reviewed')
    assert.equal(lotState(current, b.id), 'reviewed')
    assert.deepEqual(current.lots.find((lot) => lot.lot_id === a.id)?.shared_lot_ids, [b.id])

    const previewed = await bulk(
      fixture,
      batchId,
      [b.id],
      { quantity: { mode: 'set', value: '24' } },
      true,
    )
    assert.equal(previewed.status, 200, JSON.stringify(previewed.value))
    const preview = previewed.value as BulkEditResultDto
    assert.equal(preview.status, 'previewed')
    assert.deepEqual(preview.impact.invalidated_review_subject_ids, [b.id])
    assert.deepEqual(preview.impact.affected_lot_ids, [b.id])
    assert.equal((await capture(fixture, batchId)).revision, seeded.batch.revision)
    assert.equal(lotState(await operator(fixture, batchId), b.id), 'reviewed')

    const applied = await bulk(
      fixture,
      batchId,
      [b.id],
      { quantity: { mode: 'set', value: '24' } },
      false,
    )
    assert.equal(applied.status, 200)
    current = await operator(fixture, batchId)
    assert.equal(lotState(current, a.id), 'reviewed')
    assert.equal(lotState(current, b.id), 'changed_after_review')

    assert.equal((await review(fixture, batchId, [a.id, b.id])).status, 200)
    const location = await fixture.http(`/batches/${batchId}/observations`, {
      model: 'location',
      pk: '44',
    })
    const defaultChange = await edit(fixture, batchId, {
      kind: 'defaults',
      location: {
        mode: 'set',
        value: {
          observation_id: location.value.id,
          target_context_id: location.value.target_context_id,
          model: 'location',
          pk: '44',
        },
      },
    })
    assert.equal(defaultChange.status, 200)
    current = await operator(fixture, batchId)
    assert.equal(lotState(current, a.id), 'changed_after_review', 'A inherits the default')
    assert.equal(lotState(current, b.id), 'reviewed', 'B keeps its explicit override')

    assert.equal((await review(fixture, batchId, [a.id, b.id])).status, 200)
    const part = await fixture.http(`/batches/${batchId}/observations`, { model: 'part', pk: '30' })
    const shared = await edit(fixture, batchId, {
      kind: 'part',
      id: seeded.partId,
      choice: {
        mode: 'set',
        value: {
          observation_id: part.value.id,
          target_context_id: part.value.target_context_id,
          model: 'part',
          pk: '30',
        },
      },
    })
    assert.equal(shared.status, 200)
    current = await operator(fixture, batchId)
    assert.equal(lotState(current, a.id), 'changed_after_review')
    assert.equal(lotState(current, b.id), 'changed_after_review')
  } finally {
    await fixture.dispose()
  }
})

test('bulk edits are atomic, keep unnamed selections and exact strings, and reject stale revisions', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const { a, b } = seeded
    const before = await selectionCount(fixture, batchId)
    const revision = (await capture(fixture, batchId)).revision

    const partial = await bulk(
      fixture,
      batchId,
      [a.id, randomUUID()],
      { quantity: { mode: 'unknown' } },
      false,
    )
    assert.equal(partial.status, 404)
    assert.equal(partial.value.code, 'subject_not_found')
    assert.equal(await selectionCount(fixture, batchId), before)
    assert.equal((await capture(fixture, batchId)).revision, revision)

    const exact = await bulk(
      fixture,
      batchId,
      [a.id, b.id],
      { quantity: { mode: 'set', value: '9999999999999.999999' } },
      false,
    )
    assert.equal(exact.status, 200, JSON.stringify(exact.value))
    let saved = await capture(fixture, batchId)
    const savedA = saved.lots.find((lot) => lot.id === a.id)!
    const savedB = saved.lots.find((lot) => lot.id === b.id)!
    assert.deepEqual(savedA.quantity, { mode: 'set', value: '9999999999999.999999' })
    assert.deepEqual(savedA.location, { mode: 'inherit' })
    assert.equal(savedB.location.mode, 'set')

    const cleared = await bulk(fixture, batchId, [b.id], { location: { mode: 'clear' } }, false)
    assert.equal(cleared.status, 200)
    saved = await capture(fixture, batchId)
    assert.deepEqual(saved.lots.find((lot) => lot.id === b.id)!.quantity, {
      mode: 'set',
      value: '9999999999999.999999',
    })

    const stale = await fixture.http(`/batches/${batchId}/bulk-edits`, {
      expected_revision: revision,
      preview: false,
      lot_ids: [a.id],
      change: { quantity: { mode: 'unset' } },
    })
    assert.equal(stale.status, 412)
    assert.equal(stale.value.recovery, 'refresh')
  } finally {
    await fixture.dispose()
  }
})

test('previews report stale preparations; split, merge and move keep lineage and refuse retired lots', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const { a, b } = seeded
    assert.equal((await review(fixture, batchId, [a.id])).status, 200)
    const scope = {
      expected_batch_revision: (await capture(fixture, batchId)).revision,
      selected_lot_ids: [a.id],
    }
    const prepared = await fixture.http(`/batches/${batchId}/preparations`, scope)
    assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
    const preparation = prepared.value.preparation as ManualPreviewDto

    const unrelated = await bulk(
      fixture,
      batchId,
      [b.id],
      { quantity: { mode: 'set', value: '5' } },
      true,
    )
    assert.deepEqual((unrelated.value as BulkEditResultDto).impact.stale_preparation_ids, [])
    const related = await restructure(
      fixture,
      batchId,
      {
        kind: 'move_lots',
        lot_ids: [a.id],
        destination: { kind: 'new', label: 'Separate resistor' },
      },
      true,
    )
    const relatedImpact = (related.value as RestructureResultDto).impact
    assert.deepEqual(relatedImpact.stale_preparation_ids, [preparation.id])
    assert.deepEqual(relatedImpact.created_part, { part_id: null, label: 'Separate resistor' })

    const split = await restructure(fixture, batchId, {
      kind: 'split_lot',
      lot_id: b.id,
      children: [
        { label: 'Packet B1', quantity: '10' },
        { label: 'Packet B2', quantity: '13' },
      ],
    })
    assert.equal(split.status, 200, JSON.stringify(split.value))
    const splitResult = split.value as RestructureResultDto
    assert.deepEqual(splitResult.impact.retired_lot_ids, [b.id])
    const childIds = splitResult.impact.created_lots.map((lot) => lot.lot_id!)
    assert.equal(childIds.length, 2)

    const afterSplit = await operator(fixture, batchId)
    assert.deepEqual(afterSplit.retired_lots[0].successor_lot_ids, [...childIds].sort())
    assert.ok(!afterSplit.lots.some((lot) => lot.lot_id === b.id))
    for (const childId of childIds) {
      assert.deepEqual(afterSplit.lots.find((lot) => lot.lot_id === childId)?.predecessor_lot_ids, [
        b.id,
      ])
    }
    const savedChild = (await capture(fixture, batchId)).lots.find((lot) => lot.id === childIds[0])!
    assert.equal(savedChild.location.mode, 'set', 'explicit location override is copied')
    assert.equal(savedChild.part_subject_id, seeded.partId)

    const editRetired = await edit(fixture, batchId, { kind: 'lot', id: b.id, label: 'Renamed' })
    assert.equal(editRetired.status, 409)
    assert.equal(editRetired.value.code, 'lot_retired')
    const noteRetired = await edit(fixture, batchId, { kind: 'note', subject_id: b.id, text: 'x' })
    assert.equal(noteRetired.value.code, 'lot_retired')
    const reviewRetired = await review(fixture, batchId, [b.id])
    assert.equal(reviewRetired.value.code, 'lot_retired')
    const prepareRetired = await fixture.http(`/batches/${batchId}/preparations`, {
      expected_batch_revision: (await capture(fixture, batchId)).revision,
      selected_lot_ids: [b.id],
    })
    assert.equal(prepareRetired.value.status, 'blocked')
    assert.equal(prepareRetired.value.issues[0].code, 'lot_retired')
    const splitAgain = await restructure(fixture, batchId, {
      kind: 'split_lot',
      lot_id: b.id,
      children: [
        { label: 'x', quantity: '1' },
        { label: 'y', quantity: '2' },
      ],
    })
    assert.equal(splitAgain.value.code, 'lot_retired')

    const unconfirmed = await restructure(fixture, batchId, {
      kind: 'merge_lots',
      lot_ids: childIds,
      label: 'Packet B again',
      quantity: '23',
      part_subject_id: seeded.partId,
    })
    assert.equal(unconfirmed.status, 400)
    const duplicate = await restructure(fixture, batchId, {
      kind: 'merge_lots',
      lot_ids: [childIds[0], childIds[0]],
      label: 'Packet B again',
      quantity: '23',
      part_subject_id: seeded.partId,
      confirm_same_physical_contribution: true,
    })
    assert.equal(duplicate.status, 400)

    const other = await fixture.http('/batches', { title: 'Other batch', note: 'Other' })
    const otherLot = await fixture.http(`/batches/${other.value.id}/edits`, {
      expected_revision: other.value.revision,
      change: { kind: 'add_lot', label: 'Foreign', note: 'Foreign', part_subject_id: null },
    })
    const crossBatch = await restructure(fixture, batchId, {
      kind: 'merge_lots',
      lot_ids: [childIds[0], otherLot.value.lots[0].id],
      label: 'Mixed',
      quantity: '1',
      part_subject_id: null,
      confirm_same_physical_contribution: true,
    })
    assert.equal(crossBatch.status, 404)

    const merged = await restructure(fixture, batchId, {
      kind: 'merge_lots',
      lot_ids: childIds,
      label: 'Packet B again',
      quantity: '23',
      part_subject_id: seeded.partId,
      confirm_same_physical_contribution: true,
    })
    assert.equal(merged.status, 200, JSON.stringify(merged.value))
    const mergedId = (merged.value as RestructureResultDto).impact.created_lots[0].lot_id!
    const afterMerge = await operator(fixture, batchId)
    assert.deepEqual(
      afterMerge.lots.find((lot) => lot.lot_id === mergedId)?.predecessor_lot_ids,
      [...childIds].sort(),
    )
    assert.equal(afterMerge.retired_lots.length, 3)
    const lineage = await fixture.db.pool.query(
      'SELECT count(*)::int AS count FROM capture_lot_lineage WHERE batch_id=$1',
      [batchId],
    )
    assert.equal(lineage.rows[0].count, 4)
  } finally {
    await fixture.dispose()
  }
})

test('restructuring refuses a lot whose original contribution is approved', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    assert.equal((await review(fixture, batchId, [seeded.a.id])).status, 200)
    const prepared = await fixture.http(`/batches/${batchId}/preparations`, {
      expected_batch_revision: (await capture(fixture, batchId)).revision,
      selected_lot_ids: [seeded.a.id],
    })
    const preview = prepared.value.preparation as ManualPreviewDto
    const approved = await fixture.http(`/preparations/${preview.id}/approvals`, {
      preparation_id: preview.id,
      expected_plan_sha256: preview.plan_sha256,
      expected_review_fingerprint: preview.review_fingerprint,
      selected_lot_ids: preview.selected_lot_ids,
      expected_target_revision: preview.target_revision,
    })
    assert.equal(approved.status, 200, JSON.stringify(approved.value))

    const refused = await restructure(fixture, batchId, {
      kind: 'split_lot',
      lot_id: seeded.a.id,
      children: [
        { label: 'A1', quantity: '7' },
        { label: 'A2', quantity: '10' },
      ],
    })
    assert.equal(refused.status, 409)
    assert.equal(refused.value.code, 'lot_already_approved')
    const moved = await restructure(fixture, batchId, {
      kind: 'move_lots',
      lot_ids: [seeded.a.id],
      destination: { kind: 'none' },
    })
    assert.equal(moved.value.code, 'lot_already_approved')
    assert.equal(
      (await operator(fixture, batchId)).lots.find((lot) => lot.lot_id === seeded.a.id)?.approved,
      true,
    )
  } finally {
    await fixture.dispose()
  }
})

test('warnings gate review until a reasoned dismissal that survives restart and goes stale on edit', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const added = await edit(fixture, batchId, {
      kind: 'add_lot',
      label: 'Loose bag',
      note: '',
      part_subject_id: seeded.partId,
    })
    const lotC = (added.value as CaptureSnapshotDto).lots.find((lot) => lot.label === 'Loose bag')!
    assert.equal(
      (
        await edit(fixture, batchId, {
          kind: 'lot',
          id: lotC.id,
          quantity: { mode: 'set', value: '5' },
        })
      ).status,
      200,
    )

    const gated = await review(fixture, batchId, [lotC.id])
    assert.equal(gated.status, 409)
    assert.equal(gated.value.code, 'warning_unresolved')

    const warning = (await operator(fixture, batchId)).lots
      .find((lot) => lot.lot_id === lotC.id)!
      .issues.find((value) => value.code === 'no_supporting_evidence')!
    assert.equal(warning.severity, 'warning')
    const revision = (await capture(fixture, batchId)).revision
    const dismiss = (body: Record<string, unknown>) =>
      fixture.http(`/batches/${batchId}/issue-dispositions`, {
        expected_batch_revision: revision,
        subject_id: lotC.id,
        code: 'no_supporting_evidence',
        dependency_digest: warning.dependency_digest,
        reason: 'Counted at the bench; the bag has no label.',
        ...body,
      })
    assert.equal((await dismiss({ dependency_digest: '0'.repeat(64) })).value.code, 'stale_issue')
    assert.equal((await dismiss({ code: 'quantity_required' })).value.code, 'issue_not_dismissible')
    const missing = await dismiss({ subject_id: seeded.a.id })
    assert.equal(missing.status, 404)
    assert.equal(missing.value.code, 'issue_not_found')

    const accepted = await dismiss({})
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
    assert.equal((await review(fixture, batchId, [lotC.id])).status, 200)

    await fixture.stop()
    await fixture.start()
    let restarted = await operator(fixture, batchId)
    let issue = restarted.lots
      .find((lot) => lot.lot_id === lotC.id)!
      .issues.find((value) => value.code === 'no_supporting_evidence')!
    assert.equal(issue.disposition?.reason, 'Counted at the bench; the bag has no label.')
    assert.equal(lotState(restarted, lotC.id), 'reviewed')

    assert.equal(
      (
        await edit(fixture, batchId, {
          kind: 'lot',
          id: lotC.id,
          quantity: { mode: 'set', value: '6' },
        })
      ).status,
      200,
    )
    restarted = await operator(fixture, batchId)
    issue = restarted.lots
      .find((lot) => lot.lot_id === lotC.id)!
      .issues.find((value) => value.code === 'no_supporting_evidence')!
    assert.equal(issue.disposition, null)
    assert.equal(lotState(restarted, lotC.id), 'changed_after_review')
  } finally {
    await fixture.dispose()
  }
})

test('instructions keep versions and refuse unknown evidence groups', async () => {
  const fixture = await manualFixture()
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const instruct = async (text: string, groupId: string | null = null) =>
      fixture.http(`/batches/${batchId}/instructions`, {
        expected_revision: (await capture(fixture, batchId)).revision,
        group_id: groupId,
        text,
      })
    assert.equal((await instruct('Same order, separate packets.')).status, 200)
    const second = await instruct('Same order; packets B are counted.')
    assert.equal(second.status, 200)
    const instructions = (second.value as OperatorReviewDto).instructions
    assert.equal(instructions.length, 1)
    assert.equal(instructions[0].text, 'Same order; packets B are counted.')
    const versions = await fixture.db.pool.query(
      'SELECT count(*)::int AS count FROM capture_instruction WHERE batch_id=$1',
      [batchId],
    )
    assert.equal(versions.rows[0].count, 2)

    const unknown = await instruct('Unknown group', randomUUID())
    assert.equal(unknown.status, 404)
    assert.equal(unknown.value.code, 'group_not_found')
  } finally {
    await fixture.dispose()
  }
})
