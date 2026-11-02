import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  CaptureSnapshotDto,
  ManualPreviewDto,
  ManualRunDto,
  CaptureObservationDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>
async function dispatch(fixture: Fixture, runId: string) {
  const result = await fixture.db.pool.query(
    `SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1`,
    [runId],
  )
  const row = result.rows[0]
  return executeManualDispatch(
    fixture.runner.pool,
    fixture.runnerConfig,
    row.workflow_id,
    JSON.parse(row.payload_bytes.toString('utf8')),
  )
}
async function createChoice(fixture: Fixture) {
  const captured = await fixture.seedCapture()
  let batch = captured.batch
  async function observe<M extends 'category' | 'parameter_template' | 'category_parameter'>(
    model: M,
    pk: string,
  ) {
    const response = await fixture.http(`/batches/${batch.id}/observations`, { model, pk })
    assert.equal(response.status, 201, JSON.stringify(response.value))
    const observed = response.value as CaptureObservationDto
    return {
      observation_id: observed.id,
      target_context_id: observed.target_context_id,
      model,
      pk: observed.pk,
    }
  }
  const category = await observe('category', '81')
  const template = await observe('parameter_template', '201')
  const categoryMapping = await observe('category_parameter', '301')
  const changed = await fixture.http(`/batches/${batch.id}/edits`, {
    expected_revision: batch.revision,
    change: {
      kind: 'part',
      id: batch.parts[0].id,
      choice: {
        mode: 'create',
        spec: {
          name: 'Shared resistor Ω',
          category,
          parameters: [{ template, category_mapping: categoryMapping, value: '4.7 kΩ' }],
          manufacturer: null,
          supplier: null,
          tags: ['SMD', 'Bench intake new tag'],
        },
      },
    },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.value))
  batch = changed.value as CaptureSnapshotDto
  return { ...captured, batch }
}
async function approve(fixture: Fixture, batch: CaptureSnapshotDto, lotId: string) {
  const scope = { expected_batch_revision: batch.revision, selected_lot_ids: [lotId] }
  const reviewed = await fixture.http(`/batches/${batch.id}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  const prepared = await fixture.http(`/batches/${batch.id}/preparations`, scope)
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
  const preview = prepared.value.preparation as ManualPreviewDto
  const approved = await fixture.http(`/preparations/${preview.id}/approvals`, {
    preparation_id: preview.id,
    expected_plan_sha256: preview.plan_sha256,
    expected_review_fingerprint: preview.review_fingerprint,
    selected_lot_ids: preview.selected_lot_ids,
    expected_target_revision: preview.target_revision,
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.value))
  return approved.value.run_id as string
}
async function run(fixture: Fixture, id: string): Promise<ManualRunDto> {
  const result = await fixture.http(`/runs/${id}`)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value
}
async function recover(fixture: Fixture, id: string, keys: string[]) {
  const current = await run(fixture, id)
  const result = await fixture.http(`/runs/${id}/recover`, {
    expected_run_revision: current.revision,
    effect_keys: keys,
  })
  assert.equal(result.status, 200, JSON.stringify(result.value))
  await dispatch(fixture, id)
}

test('one new shared Part survives dependent failure, restart, selected repair and later lot without duplicate stock', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const capture = await createChoice(fixture)
    const a = await approve(fixture, capture.batch, capture.a.id)
    const queued = await fixture.http(`/runs/${a}/start`, {
      expected_run_revision: (await run(fixture, a)).revision,
    })
    assert.equal(queued.status, 200, JSON.stringify(queued.value))
    await fixture.fake.fault('fail_parameter_after_part')
    await dispatch(fixture, a)
    let current = await run(fixture, a)
    assert.equal(current.state, 'settled_incomplete')
    assert.deepEqual(
      current.part_outputs?.map((output) => ({ pks: output.remote_pks, usable: output.usable })),
      [{ pks: ['8101'], usable: true }],
    )
    assert.equal((await fixture.db.pool.query('SELECT count(*) FROM fake_part')).rows[0].count, '1')
    const partRequest = (await fixture.fake.records()).find(
      (record) => record.method === 'POST' && record.path === '/api/part/?tags=true',
    )!
    assert.equal(
      partRequest.body.toString('utf8'),
      '{"category":"81","copy_category_parameters":false,"name":"Shared resistor Ω","tags":["SMD","Bench intake new tag"]}',
    )
    await fixture.stop()
    await fixture.restartFake()
    await fixture.start()
    await fixture.fake.fault('none')
    const parameter = current.supported_effects!.find((effect) => effect.kind === 'parameter')!
    await recover(fixture, a, [parameter.operation_key])
    current = await run(fixture, a)
    const stock = current.supported_effects!.find((effect) => effect.kind === 'create_stock')!
    await recover(fixture, a, [stock.operation_key])
    assert.equal((await run(fixture, a)).state, 'settled_complete')
    const b = await approve(fixture, capture.batch, capture.b.id)
    assert.equal(
      (
        await fixture.http(`/runs/${b}/start`, {
          expected_run_revision: (await run(fixture, b)).revision,
        })
      ).status,
      200,
    )
    await dispatch(fixture, b)
    assert.equal((await run(fixture, b)).state, 'settled_complete')
    assert.equal((await fixture.db.pool.query('SELECT count(*) FROM fake_part')).rows[0].count, '1')
    const stocks = await fixture.fake.stocks()
    assert.deepEqual(
      stocks.map((stock) => ({ part: stock.part, quantity: stock.quantity })),
      [
        { part: '8101', quantity: '17' },
        { part: '8101', quantity: '23' },
      ],
    )
    assert.equal(
      (await fixture.fake.records()).filter(
        (record) => record.method === 'POST' && record.path === '/api/part/?tags=true',
      ).length,
      1,
    )
    assert.equal(
      (await fixture.fake.records()).filter(
        (record) => record.method === 'POST' && record.path === '/api/stock/',
      ).length,
      2,
    )
  } finally {
    await fixture.dispose()
  }
})

test('malformed attributable Part output needs explicit original-run assessment and never another create', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const capture = await createChoice(fixture)
    const id = await approve(fixture, capture.batch, capture.a.id)
    await fixture.http(`/runs/${id}/start`, {
      expected_run_revision: (await run(fixture, id)).revision,
    })
    await fixture.fake.fault('part_malformed')
    await dispatch(fixture, id)
    let current = await run(fixture, id)
    assert.equal(current.state, 'recovery_required')
    assert.deepEqual(current.part_outputs?.[0].remote_pks, ['8101'])
    assert.equal(current.part_outputs?.[0].usable, false)
    const create = current.supported_effects!.find((effect) => effect.kind === 'create_part')!
    assert.equal(create.recovery_action, 'verify_effect')
    const selected = await fixture.http(`/runs/${id}/recover`, {
      expected_run_revision: current.revision,
      assessment_keys: [create.operation_key],
    })
    assert.equal(selected.status, 200, JSON.stringify(selected.value))
    await fixture.fake.fault('none')
    await dispatch(fixture, id)
    current = await run(fixture, id)
    assert.equal(current.part_outputs?.[0].usable, true)
    assert.equal(
      current.supported_effects!.find((effect) => effect.kind === 'create_part')?.certainty,
      'confirmed',
    )
    assert.equal(
      (await fixture.fake.records()).filter(
        (record) => record.method === 'POST' && record.path === '/api/part/?tags=true',
      ).length,
      1,
    )
    assert.equal(
      (
        await fixture.db.pool.query(
          `SELECT certainty FROM executor_supported_effect e JOIN executor_supported_operation o USING(run_id,operation_key) WHERE o.kind='create_part'`,
        )
      ).rows[0].certainty,
      'unknown',
    )
    const changed = await fixture.http(`/runs/${id}/recover`, {
      expected_run_revision: current.revision,
      effect_keys: [create.operation_key],
    })
    assert.equal(changed.status, 409)
  } finally {
    await fixture.dispose()
  }
})

test('unattributed or multiple Part creates retain all evidence and block recovery and later rounds', async () => {
  for (const fault of ['part_drop_response', 'part_multiple']) {
    const fixture = await manualFixture({ effects: true })
    try {
      const capture = await createChoice(fixture)
      const id = await approve(fixture, capture.batch, capture.a.id)
      await fixture.http(`/runs/${id}/start`, {
        expected_run_revision: (await run(fixture, id)).revision,
      })
      await fixture.fake.fault(fault)
      await dispatch(fixture, id)
      const current = await run(fixture, id)
      assert.equal(current.state, 'recovery_required')
      assert.deepEqual(
        current.part_outputs?.[0].remote_pks,
        fault === 'part_multiple' ? ['8101', '7777'] : [],
      )
      assert.ok(current.supported_effects?.every((effect) => effect.recovery_action === null))
      const rejected = await fixture.http(`/runs/${id}/recover`, {
        expected_run_revision: current.revision,
        assessment_keys: [current.supported_effects![0].operation_key],
      })
      assert.equal(rejected.status, 409)
      const later = await fixture.http(`/batches/${capture.batch.id}/preparations`, {
        expected_batch_revision: capture.batch.revision,
        selected_lot_ids: [capture.b.id],
      })
      assert.equal(later.value.status, 'blocked')
      assert.ok(
        later.value.issues.some(
          (issue: { code: string }) => issue.code === 'source_history_unsettled',
        ),
      )
      assert.equal(
        (await fixture.fake.records()).filter(
          (record) => record.method === 'POST' && record.path === '/api/part/?tags=true',
        ).length,
        1,
      )
      assert.equal((await fixture.fake.stocks()).length, 0)
    } finally {
      await fixture.dispose()
    }
  }
})

test('incomplete mapped catalogue reads retain failed preparation receipts and publish no executable plan', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const capture = await createChoice(fixture)
    const scope = {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    }
    assert.equal((await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)).status, 200)
    await fixture.fake.fault('mapping_incomplete')
    const result = await fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
    assert.equal(result.value.status, 'blocked')
    assert.ok(
      result.value.issues.some(
        (issue: { code: string }) => issue.code === 'inventory_read_unavailable',
      ),
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM manual_preparation')).rows[0].count,
      '0',
    )
    assert.equal(
      (
        await fixture.db.pool.query(
          "SELECT count(*) FROM manual_read_result WHERE outcome='unavailable'",
        )
      ).rows[0].count,
      '1',
    )
    assert.equal(
      (await fixture.fake.records()).filter((record) => record.method === 'POST').length,
      0,
    )
  } finally {
    await fixture.dispose()
  }
})

test('original selected repair reacquires source guard after a later round and refuses overlap', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const capture = await createChoice(fixture)
    const a = await approve(fixture, capture.batch, capture.a.id)
    await fixture.http(`/runs/${a}/start`, {
      expected_run_revision: (await run(fixture, a)).revision,
    })
    await fixture.fake.fault('fail_parameter_after_part')
    await dispatch(fixture, a)
    await fixture.fake.fault('none')
    const b = await approve(fixture, capture.batch, capture.b.id)
    const original = await run(fixture, a)
    const parameter = original.supported_effects!.find((effect) => effect.kind === 'parameter')!
    const overlap = await fixture.http(`/runs/${a}/recover`, {
      expected_run_revision: original.revision,
      effect_keys: [parameter.operation_key],
    })
    assert.equal(overlap.status, 409)
    await fixture.http(`/runs/${b}/start`, {
      expected_run_revision: (await run(fixture, b)).revision,
    })
    await dispatch(fixture, b)
    await recover(fixture, a, [parameter.operation_key])
    const current = await run(fixture, a)
    assert.equal(
      current.supported_effects!.find((effect) => effect.kind === 'parameter')!.certainty,
      'confirmed',
    )
    assert.equal(
      (
        await fixture.db.pool.query('SELECT active_run FROM executor_guard WHERE target_id=$1', [
          fixture.identity.target,
        ])
      ).rows[0].active_run,
      null,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM executor_approval')).rows[0].count,
      '2',
    )
    assert.equal((await fixture.db.pool.query('SELECT count(*) FROM fake_part')).rows[0].count, '1')
  } finally {
    await fixture.dispose()
  }
})

test('consumed and deleted historical stock verification never authorizes replacement creates', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const capture = await createChoice(fixture)
    const id = await approve(fixture, capture.batch, capture.a.id)
    await fixture.http(`/runs/${id}/start`, {
      expected_run_revision: (await run(fixture, id)).revision,
    })
    await dispatch(fixture, id)
    for (const deleted of [false, true]) {
      if (deleted) {
        await fixture.db.pool.query('DELETE FROM fake_stock')
      } else {
        await fixture.db.pool.query("UPDATE fake_stock SET quantity='0'")
      }
      let current = await run(fixture, id)
      const operation = current.supported_effects!.find((effect) => effect.kind === 'create_stock')!
      assert.equal(operation.recovery_action, 'verify_effect')
      const selected = await fixture.http(`/runs/${id}/recover`, {
        expected_run_revision: current.revision,
        assessment_keys: [operation.operation_key],
      })
      assert.equal(selected.status, 200, JSON.stringify(selected.value))
      await dispatch(fixture, id)
      current = await run(fixture, id)
      const historical = current.supported_effects!.find(
        (effect) => effect.kind === 'create_stock',
      )!
      assert.equal(historical.certainty, 'confirmed')
      assert.equal(historical.verification, 'missing_or_changed')
      const replacement = await fixture.http(`/runs/${id}/recover`, {
        expected_run_revision: current.revision,
        effect_keys: [historical.operation_key],
      })
      assert.equal(replacement.status, 409)
    }
    const repeated = await fixture.http(`/batches/${capture.batch.id}/preparations`, {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    })
    assert.equal(repeated.value.status, 'blocked')
    assert.ok(
      repeated.value.issues.some(
        (issue: { code: string }) => issue.code === 'original_contribution_already_approved',
      ),
    )
    assert.equal(
      (await fixture.fake.records()).filter(
        (record) => record.method === 'POST' && record.path === '/api/stock/',
      ).length,
      1,
    )
  } finally {
    await fixture.dispose()
  }
})
