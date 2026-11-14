import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { validate, type ManualPreviewDto, type MediaSnapshotDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { mediaEditor, seedStoredPhoto } from '../support/media-removal.ts'
import { mediaContent } from '#/media/content.ts'
import { CaptureError } from '#/capture/model.ts'
import { inboxEvidenceCounts, inboxThumbnail } from '#/media/read.ts'
import { transaction } from '#/db/database.ts'
import { setTimeout } from 'node:timers/promises'

type Fixture = Awaited<ReturnType<typeof manualFixture>>
type Refusal = { refused: string; status: number }

function refusal(result: MediaSnapshotDto | Refusal) {
  return 'refused' in result ? [result.status, result.refused] : [200, 'applied']
}

async function contentRefusal(read: Promise<unknown>) {
  try {
    await read
    return 'served'
  } catch (error) {
    if (error instanceof CaptureError) {
      return error.code
    }
    throw error
  }
}

async function operatorIssues(fixture: Fixture, batchId: string, lotId: string) {
  const review = await fixture.http(`/batches/${batchId}/operator-review`)
  assert.equal(review.status, 200, JSON.stringify(review.value))
  const lot = (review.value.lots as { lot_id: string; issues: { code: string }[] }[]).find(
    (item) => item.lot_id === lotId,
  )!
  return lot.issues.map((issue) => issue.code)
}

async function prepare(fixture: Fixture, batch: { id: string; revision: string }, lotId: string) {
  const scope = { expected_batch_revision: batch.revision, selected_lot_ids: [lotId] }
  const reviewed = await fixture.http(`/batches/${batch.id}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  const result = await fixture.http(`/batches/${batch.id}/preparations`, scope)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  assert.equal(result.value.status, 'prepared', JSON.stringify(result.value))
  return result.value.preparation as ManualPreviewDto
}

function approve(fixture: Fixture, preview: ManualPreviewDto) {
  return fixture.http(`/preparations/${preview.id}/approvals`, {
    preparation_id: preview.id,
    expected_plan_sha256: preview.plan_sha256,
    expected_review_fingerprint: preview.review_fingerprint,
    selected_lot_ids: preview.selected_lot_ids,
    expected_target_revision: preview.target_revision,
  })
}

test('removing and restoring evidence: revision, replay, refusals, projection, bytes and approval', async () => {
  const fixture = await manualFixture({ media: true })
  try {
    assert.ok(fixture.store)
    const store = fixture.store
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const added = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: capture.batch.revision,
      change: { kind: 'add_lot', label: 'Packet C', note: '', part_subject_id: null },
    })
    assert.equal(added.status, 200, JSON.stringify(added.value))
    const lotC = (added.value.lots as { id: string; label: string }[]).find(
      (lot) => lot.label === 'Packet C',
    )!
    const seed = (label: string, number: number) =>
      seedStoredPhoto(fixture.db.pool, store, {
        batchId,
        actorId: fixture.identity.actor,
        label,
        seed: number,
      })
    const attached = await seed('Packet A label', 1)
    const label = await seed('Packet B label', 2)
    const tray = await seed('Tray', 3)
    const media = mediaEditor(fixture.api.pool, fixture.config, batchId)

    const grouped = await media.applied({ kind: 'group', label: 'Bench' })
    const group = grouped.groups[0]
    await media.applied({ kind: 'move', evidence_id: label.evidence, group_id: group.id })
    for (const [evidence, subject] of [
      [attached.evidence, capture.a.id],
      [label.evidence, capture.b.id],
      [label.evidence, lotC.id],
      [tray.evidence, lotC.id],
    ]) {
      await media.applied({
        kind: 'link',
        evidence_id: evidence,
        subject_id: subject,
        linked: true,
      })
    }
    await media.applied({
      kind: 'select_attachment',
      subject_id: capture.a.id,
      mode: 'selected',
      version_id: attached.version,
      destination: 'lot_attachment',
    })
    await media.applied({
      kind: 'select_attachment',
      subject_id: capture.b.id,
      mode: 'selected',
      version_id: label.version,
      destination: 'lot_attachment',
    })
    await media.applied({ kind: 'evidence_note', evidence_id: label.evidence, text: 'Reel side' })

    // The projection says what a removal would change.
    const before = await media.snapshot()
    const item = (id: string) => before.evidence.find((evidence) => evidence.id === id)!
    assert.deepEqual(item(label.evidence).lot_ids, [capture.b.id, lotC.id].sort())
    assert.deepEqual(item(label.evidence).selected_attachment_of, [
      { subject_id: capture.b.id, destination: 'lot_attachment' },
    ])
    // Packet B keeps its written note, and Packet C its tray photo.
    assert.equal(item(label.evidence).sole_evidence_lot_ids, undefined)
    assert.equal(item(label.evidence).pinned_by, undefined)
    assert.ok(!(await operatorIssues(fixture, batchId, lotC.id)).includes('no_supporting_evidence'))

    // A stale revision removes nothing.
    const stale = await media.edit(
      { kind: 'remove', evidence_ids: [label.evidence] },
      { revision: (BigInt(before.revision) - 1n).toString() },
    )
    assert.deepEqual(refusal(stale), [412, 'revision_conflict'])
    const none = await fixture.db.pool.query('SELECT 1 FROM media_evidence_removal')
    assert.equal(none.rowCount, 0)

    // Prepare Packet B before the delete; approving it afterwards is refused.
    const batch = (await fixture.http(`/batches/${batchId}`)).value as {
      id: string
      revision: string
    }
    const preparedB = await prepare(fixture, batch, capture.b.id)

    const key = randomUUID()
    const removed = await media.edit(
      { kind: 'remove', evidence_ids: [label.evidence] },
      { key, revision: before.revision },
    )
    assert.ok(!('refused' in removed))
    validate('MediaSnapshot', removed)
    assert.equal(BigInt(removed.revision), BigInt(before.revision) + 1n)
    assert.deepEqual(
      removed.evidence.map((evidence) => evidence.id).sort(),
      [attached.evidence, tray.evidence].sort(),
    )
    assert.deepEqual(
      removed.removed?.map((entry) => [
        entry.id,
        entry.label,
        entry.preview_id,
        entry.removed_revision,
        entry.position,
      ]),
      [
        [
          label.evidence,
          'Packet B label',
          label.preview,
          removed.revision,
          // Its place in upload order, which the snapshot before the removal lists.
          before.evidence.findIndex((evidence) => evidence.id === label.evidence),
        ],
      ],
    )
    // The selected attachment is cleared in the same command and stays cleared.
    const selectionB = removed.attachments.find(
      (selection) => selection.subject_id === capture.b.id,
    )!
    assert.deepEqual([selectionB.mode, selectionB.version_id], ['unset', null])
    // The tray now carries Packet C alone.
    assert.deepEqual(
      removed.evidence.find((evidence) => evidence.id === tray.evidence)!.sole_evidence_lot_ids,
      [lotC.id],
    )

    // A replay returns the first result without a second removal.
    const replay = await media.edit(
      { kind: 'remove', evidence_ids: [label.evidence] },
      { key, revision: before.revision },
    )
    assert.deepEqual(replay, removed)
    const rows = await fixture.db.pool.query<{ removed: boolean; revision: string }>(
      'SELECT removed,revision::text FROM media_evidence_removal WHERE evidence_id=$1',
      [label.evidence],
    )
    assert.deepEqual(rows.rows, [{ removed: true, revision: removed.revision }])
    const events = await fixture.db.pool.query<{ kind: string }>(
      `SELECT e.kind FROM ui_event e JOIN capture_batch b ON b.stream_id=e.stream_id
       WHERE b.id=$1 AND e.kind LIKE 'media_%' ORDER BY e.sequence DESC LIMIT 1`,
      [batchId],
    )
    assert.deepEqual(events.rows, [{ kind: 'media_removed' }])

    // Approval refuses the earlier preparation citing the removed file and pins nothing.
    const refusedApproval = await approve(fixture, preparedB)
    assert.equal(refusedApproval.status, 409, JSON.stringify(refusedApproval.value))
    assert.equal(refusedApproval.value.code, 'approval_evidence_removed')
    const pinsOfLabel = await fixture.db.pool.query(
      'SELECT 1 FROM media_approval_pin WHERE version_id=$1',
      [label.version],
    )
    assert.equal(pinsOfLabel.rowCount, 0)

    // Every other edit of the removed item is refused, and nothing changes.
    const recipe = {
      version: 'documentary-crop/1' as const,
      source_version_id: label.version,
      source_digest: createHash('sha256').update(label.original).digest('hex'),
      page: 1,
      source_width: 32,
      source_height: 24,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      quarter_turns: 0,
    }
    const refusedEdits = [
      { kind: 'move' as const, evidence_id: label.evidence, group_id: null },
      {
        kind: 'move_many' as const,
        evidence_ids: [tray.evidence, label.evidence],
        group_id: group.id,
      },
      {
        kind: 'link' as const,
        evidence_id: label.evidence,
        subject_id: capture.a.id,
        linked: true,
      },
      { kind: 'evidence_note' as const, evidence_id: label.evidence, text: 'Changed' },
      { kind: 'derive' as const, evidence_id: label.evidence, recipe },
      {
        kind: 'select_attachment' as const,
        subject_id: capture.b.id,
        mode: 'selected' as const,
        version_id: label.version,
        destination: 'lot_attachment' as const,
      },
      { kind: 'remove' as const, evidence_ids: [label.evidence] },
    ]
    for (const change of refusedEdits) {
      assert.deepEqual(
        refusal(await media.edit(change)),
        [409, 'media_evidence_removed'],
        change.kind,
      )
    }
    assert.equal((await media.snapshot()).revision, removed.revision)

    // Its original, full previews and region crops are refused; its thumbnail still loads.
    const content = mediaContent(fixture.api.pool, fixture.config, store)
    assert.equal(
      await contentRefusal(content.original(batchId, label.version)),
      'media_evidence_removed',
    )
    assert.equal(
      await contentRefusal(content.preview(batchId, label.preview, 'full')),
      'media_evidence_removed',
    )
    assert.equal(
      await contentRefusal(content.preview(batchId, label.preview, 'card')),
      'media_evidence_removed',
    )
    const thumb = await content.preview(batchId, label.preview, 'thumb')
    assert.ok(thumb.bytes.equals(label.previewBytes))
    assert.equal(await contentRefusal(content.original(batchId, tray.version)), 'served')

    // Removed items keep counting towards capacity.
    const counted = await fixture.db.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM media_evidence WHERE batch_id=$1',
      [batchId],
    )
    assert.equal(counted.rows[0].count, 3)

    // Ungrouping moves the removed member out too; restore returns it ungrouped.
    await media.applied({ kind: 'ungroup', group_id: group.id })
    const restored = await media.applied({ kind: 'restore', evidence_ids: [label.evidence] })
    const back = restored.evidence.find((evidence) => evidence.id === label.evidence)!
    assert.equal(back.group_id, null)
    assert.equal(back.note?.text, 'Reel side')
    assert.equal(restored.removed, undefined)
    const stillCleared = restored.attachments.find(
      (selection) => selection.subject_id === capture.b.id,
    )!
    assert.equal(stillCleared.mode, 'unset')
    assert.deepEqual(
      refusal(await media.edit({ kind: 'restore', evidence_ids: [label.evidence] })),
      [409, 'media_evidence_not_removed'],
    )

    // The tray is Packet C's only evidence: removing it raises the existing warning.
    await media.applied({ kind: 'remove', evidence_ids: [tray.evidence, label.evidence] })
    assert.ok((await operatorIssues(fixture, batchId, lotC.id)).includes('no_supporting_evidence'))

    // An approval pins its evidence, which can no longer be removed.
    const current = (await fixture.http(`/batches/${batchId}`)).value as {
      id: string
      revision: string
    }
    const preparedA = await prepare(fixture, current, capture.a.id)
    const accepted = await approve(fixture, preparedA)
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
    const pinned = await media.snapshot()
    const pinnedItem = pinned.evidence.find((evidence) => evidence.id === attached.evidence)!
    assert.equal(pinnedItem.pinned_by?.approval_id, accepted.value.approval_id)
    assert.ok(!Number.isNaN(Date.parse(pinnedItem.pinned_by!.approved_at)))
    assert.deepEqual(
      refusal(await media.edit({ kind: 'remove', evidence_ids: [attached.evidence] })),
      [409, 'media_removal_refused'],
    )
    assert.equal(
      (await media.snapshot()).evidence.some((evidence) => evidence.id === attached.evidence),
      true,
    )

    // An archived batch refuses removal and restore.
    const latest = (await fixture.http(`/batches/${batchId}`)).value as { revision: string }
    const archived = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: latest.revision,
      change: { kind: 'batch', archived: true },
    })
    assert.equal(archived.status, 200, JSON.stringify(archived.value))
    assert.deepEqual(
      refusal(await media.edit({ kind: 'restore', evidence_ids: [tray.evidence] })),
      [409, 'batch_archived'],
    )
  } finally {
    await fixture.dispose()
  }
})

test('removal rows are append-only', async () => {
  const fixture = await manualFixture({ media: true })
  try {
    assert.ok(fixture.store)
    const capture = await fixture.seedCapture()
    const photo = await seedStoredPhoto(fixture.db.pool, fixture.store, {
      batchId: capture.batch.id,
      actorId: fixture.identity.actor,
      label: 'Photo',
      seed: 9,
    })
    const media = mediaEditor(fixture.api.pool, fixture.config, capture.batch.id)
    await media.applied({ kind: 'remove', evidence_ids: [photo.evidence] })
    for (const statement of [
      'UPDATE media_evidence_removal SET removed=false',
      'DELETE FROM media_evidence_removal',
    ]) {
      await assert.rejects(fixture.db.pool.query(statement), /authority|immutable|reject/i)
    }
    // The runtime role has no such grant either.
    await assert.rejects(fixture.api.pool.query('DELETE FROM media_evidence_removal'))
  } finally {
    await fixture.dispose()
  }
})

async function packetC(fixture: Fixture, batch: { id: string; revision: string }) {
  const added = await fixture.http(`/batches/${batch.id}/edits`, {
    expected_revision: batch.revision,
    change: { kind: 'add_lot', label: 'Packet C', note: '', part_subject_id: null },
  })
  assert.equal(added.status, 200, JSON.stringify(added.value))
  return (added.value.lots as { id: string; label: string }[]).find(
    (lot) => lot.label === 'Packet C',
  )!
}

test('the impact of removing several items together names a lot they alone support', async () => {
  const fixture = await manualFixture({ media: true })
  try {
    assert.ok(fixture.store)
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const lotC = await packetC(fixture, capture.batch)
    const [front, back, other] = await Promise.all(
      ['Front', 'Back', 'Other'].map((label, index) =>
        seedStoredPhoto(fixture.db.pool, fixture.store!, {
          batchId,
          actorId: fixture.identity.actor,
          label,
          seed: 20 + index,
        }),
      ),
    )
    const media = mediaEditor(fixture.api.pool, fixture.config, batchId)
    for (const photo of [front, back]) {
      await media.applied({
        kind: 'link',
        evidence_id: photo.evidence,
        subject_id: lotC.id,
        linked: true,
      })
    }
    await media.applied({
      kind: 'link',
      evidence_id: other.evidence,
      subject_id: capture.a.id,
      linked: true,
    })
    await media.applied({
      kind: 'select_attachment',
      subject_id: capture.b.id,
      mode: 'selected',
      version_id: back.version,
      destination: 'lot_attachment',
    })
    const snapshot = await media.snapshot()
    // Alone, each leaves the other supporting Packet C.
    for (const photo of [front, back]) {
      const item = snapshot.evidence.find((evidence) => evidence.id === photo.evidence)!
      assert.equal(item.sole_evidence_lot_ids, undefined)
    }
    const read = await fixture.http(
      `/batches/${batchId}/media/removal-impact?evidence_ids=${[back.evidence, front.evidence].join(',')}`,
    )
    assert.equal(read.status, 200, JSON.stringify(read.value))
    validate('MediaRemovalImpact', read.value)
    assert.deepEqual(read.value, {
      evidence_ids: [back.evidence, front.evidence].sort(),
      lot_ids: [lotC.id],
      sole_evidence_lot_ids: [lotC.id],
      selected_attachment_of: [{ subject_id: capture.b.id, destination: 'lot_attachment' }],
    })
    const unknown = await fixture.http(
      `/batches/${batchId}/media/removal-impact?evidence_ids=${randomUUID()}`,
    )
    assert.equal(unknown.status, 404)
    const impact = (ids: string) =>
      fixture.http(`/batches/${batchId}/media/removal-impact?evidence_ids=${ids}`)
    for (const ids of [
      'x',
      '',
      `${front.evidence},${front.evidence}`,
      Array.from({ length: 201 }, () => randomUUID()).join(','),
    ]) {
      const refused = await impact(ids)
      assert.deepEqual([refused.status, refused.value.code], [400, 'invalid_id'], ids.slice(0, 80))
    }
    const missing = await fixture.http(`/batches/${batchId}/media/removal-impact`)
    assert.deepEqual([missing.status, missing.value.code], [400, 'invalid_id'])
    await media.applied({ kind: 'remove', evidence_ids: [other.evidence] })
    const removedItem = await impact(other.evidence)
    assert.deepEqual([removedItem.status, removedItem.value.code], [409, 'media_evidence_removed'])
    // A removed item is refused before an unknown one is looked for.
    const mixed = await impact(`${randomUUID()},${other.evidence}`)
    assert.deepEqual([mixed.status, mixed.value.code], [409, 'media_evidence_removed'])
  } finally {
    await fixture.dispose()
  }
})

test('the batch list stops counting and showing a removed item', async () => {
  const fixture = await manualFixture({ media: true })
  try {
    assert.ok(fixture.store)
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const first = await seedStoredPhoto(fixture.db.pool, fixture.store, {
      batchId,
      actorId: fixture.identity.actor,
      label: 'First',
      seed: 30,
    })
    const second = await seedStoredPhoto(fixture.db.pool, fixture.store, {
      batchId,
      actorId: fixture.identity.actor,
      label: 'Second',
      seed: 31,
    })
    const listed = () =>
      transaction(fixture.api.pool, async (client) => ({
        counts: await inboxEvidenceCounts(client, batchId),
        thumbnail: await inboxThumbnail(client, batchId),
      }))
    const before = await listed()
    assert.deepEqual(before.counts, { photos: 2, documents: 0, other: 0 })
    assert.equal(before.thumbnail?.preview_id, first.preview)
    await mediaEditor(fixture.api.pool, fixture.config, batchId).applied({
      kind: 'remove',
      evidence_ids: [first.evidence],
    })
    const after = await listed()
    assert.deepEqual(after.counts, { photos: 1, documents: 0, other: 0 })
    assert.deepEqual(after.thumbnail, { preview_id: second.preview, label: 'Second' })
  } finally {
    await fixture.dispose()
  }
})

test('a removal waiting behind an approval is refused once the approval pins the item', async () => {
  const fixture = await manualFixture({ media: true })
  const holder = await fixture.db.pool.connect()
  try {
    assert.ok(fixture.store)
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const photo = await seedStoredPhoto(fixture.db.pool, fixture.store, {
      batchId,
      actorId: fixture.identity.actor,
      label: 'Packet A label',
      seed: 40,
    })
    const media = mediaEditor(fixture.api.pool, fixture.config, batchId)
    await media.applied({
      kind: 'link',
      evidence_id: photo.evidence,
      subject_id: capture.a.id,
      linked: true,
    })
    await media.applied({
      kind: 'select_attachment',
      subject_id: capture.a.id,
      mode: 'selected',
      version_id: photo.version,
      destination: 'lot_attachment',
    })
    const batch = (await fixture.http(`/batches/${batchId}`)).value as {
      id: string
      revision: string
    }
    const prepared = await prepare(fixture, batch, capture.a.id)
    const revision = (await media.snapshot()).revision

    // Hold the capture lock both commands need, then queue the approval ahead of the removal.
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM capture_batch WHERE id=$1 FOR UPDATE', [batchId])
    const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid
    const blocked = async (count: number) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const waiting = await fixture.db.pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid)) > 0
             AND ($1::integer=ANY(pg_blocking_pids(pid)) OR wait_event_type='Lock')`,
          [holderPid],
        )
        if (waiting.rows[0].count >= count) {
          return
        }
        await setTimeout(10)
      }
      assert.fail(`expected ${count} blocked transactions`)
    }
    const approval = approve(fixture, prepared)
    await blocked(1)
    const removal = media.edit({ kind: 'remove', evidence_ids: [photo.evidence] }, { revision })
    await blocked(2)
    await holder.query('ROLLBACK')

    const approved = await approval
    assert.equal(approved.status, 200, JSON.stringify(approved.value))
    assert.deepEqual(refusal(await removal), [409, 'media_removal_refused'])
    const removals = await fixture.db.pool.query('SELECT 1 FROM media_evidence_removal')
    assert.equal(removals.rowCount, 0)
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined)
    holder.release()
    await fixture.dispose()
  }
})
