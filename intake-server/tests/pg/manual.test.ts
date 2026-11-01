import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import type { ManualPreviewDto, ManualRunDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'

async function reviewedPreparation(
  fixture: Awaited<ReturnType<typeof manualFixture>>,
  batchId: string,
  revision: string,
  lotId: string,
) {
  const scope = { expected_batch_revision: revision, selected_lot_ids: [lotId] }
  const reviewed = await fixture.http(`/batches/${batchId}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  const prepared = await fixture.http(`/batches/${batchId}/preparations`, scope)
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
  return prepared.value.preparation as ManualPreviewDto
}
function approval(preview: ManualPreviewDto) {
  return {
    preparation_id: preview.id,
    expected_plan_sha256: preview.plan_sha256,
    expected_review_fingerprint: preview.review_fingerprint,
    selected_lot_ids: preview.selected_lot_ids,
    expected_target_revision: preview.target_revision,
  }
}
async function applyRequested(fixture: Awaited<ReturnType<typeof manualFixture>>, runId: string) {
  const before = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
  const requested = await fixture.http(`/runs/${runId}/start`, {
    expected_run_revision: before.revision,
  })
  assert.equal(requested.status, 200, JSON.stringify(requested.value))
  const command = (
    await fixture.db.pool.query(
      'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
      [runId],
    )
  ).rows[0]
  return executeManualDispatch(
    fixture.runner.pool,
    fixture.runnerConfig,
    command.workflow_id,
    JSON.parse(command.payload_bytes.toString('utf8')),
  )
}

test('manual HTTP/PG approval selects only A, retains original authority through restart and later B, never replenishes deleted stock', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const first = await reviewedPreparation(fixture, batchId, capture.batch.revision, capture.a.id)
    assert.deepEqual(first.selected_lot_ids, [capture.a.id])
    assert.deepEqual(first.remaining_lot_ids, [capture.b.id])
    assert.deepEqual(
      first.effects.map((value) => [
        value.lot_id,
        value.part_id,
        value.location_id,
        value.quantity,
      ]),
      [[capture.a.id, '29', '43', '17']],
    )
    const source = (
      await fixture.db.pool.query(
        'SELECT original_key FROM executor_source WHERE target_id=$1 AND source_id=$2',
        [fixture.identity.target, capture.batch.source_id],
      )
    ).rows[0]
    assert.equal(source.original_key, capture.batch.source_id)
    const key = randomUUID()
    const accepted = await fixture.http(`/preparations/${first.id}/approvals`, approval(first), key)
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
    assert.deepEqual(
      (await fixture.http(`/preparations/${first.id}/approvals`, approval(first), key)).value,
      accepted.value,
    )
    assert.deepEqual(
      (await fixture.http(`/preparations/${first.id}/approvals`, approval(first))).value,
      accepted.value,
    )
    assert.equal(
      (
        await fixture.http(
          `/preparations/${first.id}/approvals`,
          { ...approval(first), expected_plan_sha256: 'f'.repeat(64) },
          key,
        )
      ).status,
      409,
    )
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
    const preparedReads = (
      await fixture.db.pool.query(
        'SELECT i.model,i.pk,r.outcome FROM manual_read_intent i JOIN manual_read_result r ON r.intent_id=i.id ORDER BY i.model',
      )
    ).rows
    assert.deepEqual(preparedReads, [
      { model: 'location', pk: '43', outcome: 'found' },
      { model: 'part', pk: '29', outcome: 'found' },
    ])
    const result = await applyRequested(fixture, accepted.value.run_id)
    assert.equal(result.state, 'settled_complete')
    assert.deepEqual(result.confirmedStockIds, ['7101'])
    let posts = (await fixture.fake.records()).filter((value) => value.method === 'POST')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].path, '/api/stock/')
    assert.equal(
      posts[0].body.toString(),
      `{"barcode":"bi1:${capture.batch.source_id}:${capture.a.contribution_key}","location":"43","part":"29","quantity":"17"}`,
    )
    const completed = (await fixture.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
    assert.equal(completed.state, 'settled_complete')
    assert.deepEqual(completed.confirmed_stock_ids, ['7101'])
    assert.equal(completed.operations[0].lot_id, capture.a.id)
    const head = (
      await fixture.db.pool.query('SELECT head FROM ui_stream WHERE id=$1', [
        completed.cursor.stream_id,
      ])
    ).rows[0].head
    assert.equal(completed.cursor.sequence, head)
    await fixture.stop()
    await fixture.restartFake()
    await fixture.start()
    assert.deepEqual((await fixture.http(`/runs/${accepted.value.run_id}`)).value, completed)
    await capture.edit({ kind: 'lot', id: capture.a.id, label: 'A later draft label' })
    assert.deepEqual(
      (await fixture.http(`/preparations/${first.id}/approvals`, approval(first))).value,
      accepted.value,
    )
    const second = await reviewedPreparation(fixture, batchId, capture.batch.revision, capture.b.id)
    const acceptedB = await fixture.http(`/preparations/${second.id}/approvals`, approval(second))
    assert.equal(acceptedB.status, 200, JSON.stringify(acceptedB.value))
    await applyRequested(fixture, acceptedB.value.run_id)
    posts = (await fixture.fake.records()).filter((value) => value.method === 'POST')
    assert.equal(posts.length, 2)
    assert.equal(
      posts[1].body.toString(),
      `{"barcode":"bi1:${capture.batch.source_id}:${capture.b.contribution_key}","location":"48","part":"29","quantity":"23"}`,
    )
    await fixture.db.pool.query('DELETE FROM fake_stock WHERE pk=7101')
    const selectedAgain = await fixture.http(`/batches/${batchId}/preparations`, {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    })
    assert.equal(selectedAgain.value.status, 'blocked')
    assert.equal(
      selectedAgain.value.issues.some(
        (value: { code: string }) => value.code === 'original_contribution_already_approved',
      ),
      true,
    )
    assert.deepEqual(
      (await fixture.http(`/preparations/${first.id}/approvals`, approval(first))).value,
      accepted.value,
    )
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      2,
    )
    assert.deepEqual(
      (await fixture.fake.stocks()).map((value) => value.pk),
      ['7102'],
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*)::int AS n FROM manual_approval')).rows[0].n,
      2,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*)::int AS n FROM executor_run')).rows[0].n,
      2,
    )
  } finally {
    await fixture.dispose()
  }
})

test('selected fingerprints exclude B-only changes but reject shared edits, malformed/foreign scope and incomplete target reads', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const first = await reviewedPreparation(
      fixture,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    await capture.edit({ kind: 'lot', id: capture.b.id, quantity: { mode: 'set', value: '24' } })
    let workspace = await fixture.http(`/batches/${capture.batch.id}/manual`)
    assert.equal(workspace.status, 200, JSON.stringify(workspace.value))
    assert.equal(
      workspace.value.lots.find((value: { lot_id: string }) => value.lot_id === capture.a.id)
        .reviewed,
      true,
    )
    assert.equal(
      workspace.value.preparations.some((value: { id: string }) => value.id === first.id),
      true,
    )
    await capture.edit({
      kind: 'part',
      id: capture.partId,
      label: 'Changed shared Part description',
    })
    assert.equal(
      (await fixture.http(`/preparations/${first.id}/approvals`, approval(first))).value.code,
      'stale_preparation',
    )
    workspace = await fixture.http(`/batches/${capture.batch.id}/manual`)
    assert.equal(
      workspace.value.lots.every((value: { reviewed: boolean }) => !value.reviewed),
      true,
    )
    assert.equal(
      (
        await fixture.http(`/batches/${capture.batch.id}/reviews`, {
          expected_batch_revision: capture.batch.revision,
          selected_lot_ids: Array.from({ length: 11 }, () => randomUUID()),
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await fixture.http(`/batches/${capture.batch.id}/reviews`, {
          expected_batch_revision: capture.batch.revision,
          selected_lot_ids: [randomUUID()],
        })
      ).status,
      409,
    )
    const second = await reviewedPreparation(
      fixture,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    assert.equal(
      (
        await fixture.http(`/preparations/${second.id}/approvals`, {
          ...approval(second),
          selected_lot_ids: [capture.b.id],
        })
      ).status,
      409,
    )
    const pending = await fixture.http(`/preparations/${second.id}/approvals`, approval(second))
    assert.equal(pending.status, 200)
    const blocked = await fixture.http(`/batches/${capture.batch.id}/preparations`, {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.b.id],
    })
    assert.equal(blocked.value.status, 'blocked')
    assert.equal(
      blocked.value.issues.some(
        (value: { code: string }) => value.code === 'source_history_unsettled',
      ),
      true,
    )
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
  } finally {
    await fixture.dispose()
  }
})

test('manual source-owner bridge resists temporary shadows and restricted enrollment; exact batch/stream/actor parents and retained bytes reject corruption', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    for (const connection of [fixture.api, fixture.runner, fixture.apply]) {
      await assert.rejects(
        connection.pool.query('INSERT INTO public.executor_source VALUES($1,$2,$3)', [
          fixture.identity.target,
          randomUUID(),
          randomUUID(),
        ]),
        { code: '42501' },
      )
      const privilege = await fixture.db.pool.query(
        "SELECT has_function_privilege($1,'public.manual_enroll_native_source()','EXECUTE') AS allowed",
        [connection.name],
      )
      assert.equal(privilege.rows[0].allowed, false)
      await assert.rejects(
        connection.pool.query(
          'ALTER FUNCTION public.manual_enroll_native_source() SET search_path=pg_temp,public',
        ),
        { code: '42501' },
      )
    }
    const client = await fixture.api.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'CREATE TEMP TABLE capture_source(id uuid,namespace_key text,created_by uuid); CREATE TEMP TABLE executor_source(target_id uuid,source_id uuid,original_key uuid)',
      )
      const sourceId = randomUUID()
      const streamId = randomUUID()
      const batchId = randomUUID()
      await client.query(
        'INSERT INTO public.capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
        [sourceId, `native_batch:${sourceId}`, fixture.identity.actor],
      )
      await client.query('INSERT INTO public.ui_stream(id,stream_key) VALUES($1,$2)', [
        streamId,
        `manual-shadow:${batchId}`,
      ])
      await client.query(
        'INSERT INTO public.capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          batchId,
          sourceId,
          fixture.identity.actor,
          fixture.identity.target,
          fixture.identity.context,
          streamId,
          'Legitimate native source',
        ],
      )
      assert.equal(
        (await client.query('SELECT count(*)::int AS n FROM pg_temp.executor_source')).rows[0].n,
        0,
      )
      assert.equal(
        (
          await client.query('SELECT original_key FROM public.executor_source WHERE source_id=$1', [
            sourceId,
          ])
        ).rows[0].original_key,
        sourceId,
      )
      await client.query('ROLLBACK')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
    const prepared = await reviewedPreparation(
      fixture,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    const accepted = await fixture.http(
      `/preparations/${prepared.id}/approvals`,
      approval(prepared),
    )
    assert.equal(accepted.status, 200)
    const other = await fixture.http('/batches', { title: 'Other batch stream', note: '' })
    assert.equal(other.status, 201)
    const admin = await fixture.db.pool.connect()
    try {
      await admin.query('BEGIN')
      await admin.query('ALTER TABLE public.manual_run DISABLE TRIGGER manual_run_identity')
      await assert.rejects(
        admin.query('UPDATE public.manual_run SET stream_id=$2 WHERE id=$1', [
          accepted.value.run_id,
          other.value.cursor.stream_id,
        ]),
        { code: '23503' },
      )
      await admin.query('ROLLBACK')
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined)
      admin.release()
    }
    assert.equal(
      (
        await fixture.db.pool.query('SELECT stream_id FROM manual_run WHERE id=$1', [
          accepted.value.run_id,
        ])
      ).rows[0].stream_id,
      capture.batch.cursor.stream_id,
    )
    await assert.rejects(
      fixture.api.pool.query('UPDATE manual_preparation SET plan_bytes=$2 WHERE id=$1', [
        prepared.id,
        Buffer.from('{}'),
      ]),
      { code: '42501' },
    )
    await assert.rejects(
      fixture.db.pool.query('UPDATE manual_preparation SET plan_bytes=$2 WHERE id=$1', [
        prepared.id,
        Buffer.from('{}'),
      ]),
      { code: '23000' },
    )
    await assert.rejects(
      fixture.apply.pool.query(
        'INSERT INTO manual_approval(id,batch_id,preparation_id,actor_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), capture.batch.id, prepared.id, fixture.identity.actor],
      ),
      { code: '42501' },
    )
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
  } finally {
    await fixture.dispose()
  }
})

test('unavailable preparation reads retain intents/results without a plan; changed facts during reads block publication', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const scope = {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    }
    assert.equal((await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)).status, 200)
    await fixture.fake.fault('read_unavailable')
    const blocked = await fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
    assert.equal(blocked.value.status, 'blocked')
    assert.equal(
      blocked.value.issues.every(
        (value: { code: string }) => value.code === 'inventory_read_unavailable',
      ),
      true,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*)::int AS n FROM manual_preparation')).rows[0].n,
      0,
    )
    assert.equal(
      (
        await fixture.db.pool.query(
          "SELECT count(*)::int AS n FROM manual_read_result WHERE outcome='unavailable'",
        )
      ).rows[0].n,
      2,
    )
    await fixture.fake.fault('hold_reads')
    const count = (await fixture.fake.records()).length
    const pending = fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await fixture.fake.records()).length >= count + 2) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal((await fixture.fake.records()).length, count + 2)
    await capture.edit({
      kind: 'part',
      id: capture.partId,
      label: 'Changed while target was reading',
    })
    await fixture.fake.fault('none')
    const changed = await pending
    assert.equal(changed.value.status, 'blocked')
    assert.equal(
      changed.value.issues.some((value: { code: string }) => value.code === 'stale_preparation'),
      true,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*)::int AS n FROM manual_preparation')).rows[0].n,
      0,
    )
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
  } finally {
    await fixture.fake.fault('none')
    await fixture.dispose()
  }
})

test('unknown A blocks B and every create-recovery request; cancellation recovers untouched work only under the original run', async () => {
  const unknown = await manualFixture()
  try {
    const capture = await unknown.seedCapture()
    const preview = await reviewedPreparation(
      unknown,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    const accepted = await unknown.http(`/preparations/${preview.id}/approvals`, approval(preview))
    await unknown.fake.fault('drop_response')
    assert.equal((await applyRequested(unknown, accepted.value.run_id)).state, 'recovery_required')
    const state = (await unknown.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
    assert.equal(state.state, 'recovery_required')
    assert.equal(state.operations[0].recovery_allowed, false)
    const recovery = await unknown.http(`/runs/${state.run_id}/recover`, {
      expected_run_revision: state.revision,
      operation_keys: [capture.a.id],
    })
    assert.equal(recovery.status, 409)
    const blocked = await unknown.http(`/batches/${capture.batch.id}/preparations`, {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.b.id],
    })
    assert.equal(blocked.value.status, 'blocked')
    assert.equal(
      blocked.value.issues.some(
        (value: { code: string }) => value.code === 'source_history_unsettled',
      ),
      true,
    )
    assert.equal(
      (await unknown.fake.records()).filter((value) => value.method === 'POST').length,
      1,
    )
  } finally {
    await unknown.dispose()
  }
  const pending = await manualFixture()
  try {
    const capture = await pending.seedCapture()
    const preview = await reviewedPreparation(
      pending,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    const accepted = await pending.http(`/preparations/${preview.id}/approvals`, approval(preview))
    let state = (await pending.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
    const cancelled = await pending.http(`/runs/${state.run_id}/cancel`, {
      expected_run_revision: state.revision,
    })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.value))
    state = (await pending.http(`/runs/${state.run_id}`)).value as ManualRunDto
    assert.equal(state.state, 'settled_incomplete')
    assert.equal(state.operations[0].recovery_allowed, true)
    const resumed = await pending.http(`/runs/${state.run_id}/recover`, {
      expected_run_revision: state.revision,
      operation_keys: [capture.a.id],
    })
    assert.equal(resumed.status, 200, JSON.stringify(resumed.value))
    assert.equal(resumed.value.run_id, accepted.value.run_id)
    const command = (
      await pending.db.pool.query(
        'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
        [state.run_id],
      )
    ).rows[0]
    const result = await executeManualDispatch(
      pending.runner.pool,
      pending.runnerConfig,
      command.workflow_id,
      JSON.parse(command.payload_bytes.toString()),
    )
    assert.equal(result.state, 'settled_complete')
    assert.equal(
      (await pending.fake.records()).filter((value) => value.method === 'POST').length,
      1,
    )
    assert.equal(
      (await pending.db.pool.query('SELECT count(*)::int AS n FROM manual_approval')).rows[0].n,
      1,
    )
    assert.equal(
      (await pending.db.pool.query('SELECT count(*)::int AS n FROM executor_run')).rows[0].n,
      1,
    )
  } finally {
    await pending.dispose()
  }
})

test('missing retained preparation indexes or successful read receipts cannot authorize approval', async () => {
  for (const damaged of [
    'manual_preparation_lot',
    'manual_preparation_review',
    'manual_read_result',
  ]) {
    const fixture = await manualFixture()
    try {
      const capture = await fixture.seedCapture()
      const prepared = await reviewedPreparation(
        fixture,
        capture.batch.id,
        capture.batch.revision,
        capture.a.id,
      )
      // Privileged fault injection is confined to this random disposable database.
      // Runtime roles cannot delete these rows or disable their immutable triggers.
      await fixture.db.pool.query(`ALTER TABLE ${damaged} DISABLE TRIGGER USER`)
      if (damaged === 'manual_preparation_review') {
        await fixture.db.pool.query('DELETE FROM manual_preparation_review WHERE subject_id=$1', [
          capture.partId,
        ])
      } else {
        await fixture.db.pool.query(`DELETE FROM ${damaged}`)
      }
      await fixture.db.pool.query(`ALTER TABLE ${damaged} ENABLE TRIGGER USER`)
      const rejected = await fixture.http(
        `/preparations/${prepared.id}/approvals`,
        approval(prepared),
      )
      assert.equal(rejected.status, 409, damaged)
      assert.equal(rejected.value.code, 'retained_preparation_corrupt', damaged)
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*)::int AS n FROM executor_approval')).rows[0].n,
        0,
      )
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
      )
    } finally {
      await fixture.dispose()
    }
  }
})

test('scheduler recovery of an already claimed manual dispatch never relaunches its physical writer', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const prepared = await reviewedPreparation(
      fixture,
      capture.batch.id,
      capture.batch.revision,
      capture.a.id,
    )
    const accepted = await fixture.http(
      `/preparations/${prepared.id}/approvals`,
      approval(prepared),
    )
    const run = (await fixture.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
    assert.equal(
      (await fixture.http(`/runs/${run.run_id}/start`, { expected_run_revision: run.revision }))
        .status,
      200,
    )
    await fixture.runner.pool.query("UPDATE manual_dispatch SET state='running' WHERE run_id=$1", [
      run.run_id,
    ])
    const retained = (
      await fixture.db.pool.query(
        'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1',
        [run.run_id],
      )
    ).rows[0]
    await executeManualDispatch(
      fixture.runner.pool,
      fixture.runnerConfig,
      retained.workflow_id,
      JSON.parse(retained.payload_bytes.toString()),
    )
    const inspected = (await fixture.http(`/runs/${run.run_id}`)).value as ManualRunDto
    assert.equal(inspected.state, 'recovery_required')
    assert.equal(inspected.dispatch_state, 'interrupted')
    assert.equal(inspected.operations[0].recovery_allowed, false)
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
    assert.deepEqual(await fixture.fake.stocks(), [])
  } finally {
    await fixture.dispose()
  }
})

test('0004 upgrades retained native capture identity unchanged and rejects every conflicting existing binding', async () => {
  for (const damage of ['none', 'namespace', 'actor', 'original_key']) {
    const db = await isolatedDatabase({ migrate: false })
    try {
      for (const name of ['0001_foundation.sql', '0002_capture.sql', '0003_executor.sql']) {
        await db.pool.query(
          await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'),
        )
      }
      const identity = await seedAuthority(db.pool)
      const sourceId = randomUUID()
      const actorId = damage === 'actor' ? randomUUID() : identity.actor
      if (actorId !== identity.actor) {
        await db.pool.query('INSERT INTO operator VALUES($1,$2,$3)', [
          actorId,
          'development',
          `fixture-${actorId}`,
        ])
      }
      await db.pool.query(
        'INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
        [
          sourceId,
          damage === 'namespace' ? `foreign:${sourceId}` : `native_batch:${sourceId}`,
          actorId,
        ],
      )
      const streamId = randomUUID()
      await db.pool.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
        streamId,
        `upgrade:${streamId}`,
      ])
      await db.pool.query(
        'INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          randomUUID(),
          sourceId,
          identity.actor,
          identity.target,
          identity.context,
          streamId,
          'Retained before T04',
        ],
      )
      if (damage === 'original_key') {
        await db.pool.query('INSERT INTO executor_source VALUES($1,$2,$3)', [
          identity.target,
          sourceId,
          randomUUID(),
        ])
      }
      const migration = await readFile(
        new URL('../../migrations/0004_manual_review.sql', import.meta.url),
        'utf8',
      )
      const client = await db.pool.connect()
      try {
        await client.query('BEGIN')
        if (damage === 'none') {
          await client.query(migration)
          assert.deepEqual(
            (await client.query('SELECT target_id,source_id,original_key FROM executor_source'))
              .rows,
            [{ target_id: identity.target, source_id: sourceId, original_key: sourceId }],
          )
        } else {
          await assert.rejects(client.query(migration), /native_source_backfill_conflict/)
        }
        await client.query('ROLLBACK')
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    } finally {
      await db.dispose()
    }
  }
})
