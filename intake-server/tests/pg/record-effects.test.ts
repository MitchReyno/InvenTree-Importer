import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto, ManualPreviewDto, ManualRunDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'
import { createHash } from 'node:crypto'
import { mediaRepository } from '../../src/media/repository.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import { editMedia } from '../../src/media/edit.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4ICLHdUIDAAhZAh0cg3OhAAAAAElFTkSuQmCC',
  'base64',
)
import { companyCreateKey, locationCreateKey } from '../../src/execution/effects-plan.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function prepare(fixture: Fixture, batch: CaptureSnapshotDto, lotId: string) {
  const scope = { expected_batch_revision: batch.revision, selected_lot_ids: [lotId] }
  const reviewed = await fixture.http(`/batches/${batch.id}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  return fixture.http(`/batches/${batch.id}/preparations`, scope)
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

async function apply(fixture: Fixture, runId: string) {
  const before = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
  const started = await fixture.http(`/runs/${runId}/start`, {
    expected_run_revision: before.revision,
  })
  assert.equal(started.status, 200, JSON.stringify(started.value))
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

/** Packet A resolves to the batch default, which becomes a new-location draft. */
async function draftedBatch(
  fixture: Fixture,
  parentPk: string | null = '43',
  logoFor: (
    batchId: string,
  ) => Promise<{ evidence_id: string; version_id: string } | null> = async () => null,
) {
  const capture = await fixture.seedCapture()
  const logo = await logoFor(capture.batch.id)
  const batch = capture.batch
  const parentObservation = parentPk
    ? batch.observations.find((item) => item.model === 'location' && item.pk === parentPk)!
    : null
  const locationDraft = randomUUID()
  const companyDraft = randomUUID()
  await capture.edit({
    kind: 'batch_settings',
    title: batch.title,
    default_location: { mode: 'draft', draft_id: locationDraft },
    intent: {
      supplier: { absent: false, selection: { mode: 'draft', draft_id: companyDraft } },
      order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
      shared_tags: { manual: [], auto: false },
    },
    notes: { batch: null, order: null },
    drafts: [
      {
        draft_id: locationDraft,
        kind: 'location',
        value: {
          name: 'Reel shelf',
          description: 'Opened reels',
          parent: parentObservation
            ? {
                observation_id: parentObservation.id,
                target_context_id: parentObservation.target_context_id,
                model: 'location',
                pk: parentObservation.pk,
              }
            : null,
        },
      },
      {
        draft_id: companyDraft,
        kind: 'company',
        value: { name: 'Acme Reels', description: '', also_manufacturer: true, logo },
      },
    ],
  })
  async function renameLocation(name: string) {
    const current = capture.batch
    const drafts = current.reference_drafts!.map(({ draft_id, kind, value }) =>
      kind === 'location'
        ? { draft_id, kind, value: { ...value, name } }
        : { draft_id, kind, value },
    )
    await capture.edit({
      kind: 'batch_settings',
      title: current.title,
      default_location: { mode: 'draft', draft_id: locationDraft },
      intent: current.settings_intent!.value,
      notes: { batch: null, order: null },
      drafts,
    } as never)
  }
  return { capture, locationDraft, companyDraft, renameLocation }
}

async function approved(fixture: Fixture, batch: CaptureSnapshotDto, lotId: string) {
  const prepared = await prepare(fixture, batch, lotId)
  assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
  const preview = prepared.value.preparation as ManualPreviewDto
  const accepted = await fixture.http(
    `/preparations/${preview.id}/approvals`,
    approval(preview),
    randomUUID(),
  )
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
  return accepted.value.run_id as string
}

async function posts(fixture: Fixture, path: string) {
  return (await fixture.fake.records()).filter(
    (value) => value.method === 'POST' && value.path === path,
  ).length
}

test(
  'autosaved drafts create nothing; one approved run creates the location, supplier and stock',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture, locationDraft, companyDraft } = await draftedBatch(fixture)
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
        'autosave never creates inventory records',
      )
      const prepared = await prepare(fixture, capture.batch, capture.a.id)
      assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
      assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
      const preview = prepared.value.preparation as ManualPreviewDto
      assert.equal(preview.capability, 'owned-fake-effects/2')
      assert.deepEqual(
        preview.supported_effects?.map((effect) => [effect.kind, effect.operation_key]),
        [
          ['create_location', locationCreateKey(locationDraft)],
          ['create_company', companyCreateKey(companyDraft)],
        ],
      )
      assert.equal(preview.effects[0].location_id, null)
      assert.equal(preview.effects[0].location_operation_key, locationCreateKey(locationDraft))
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
        'preparation only reads',
      )
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
        randomUUID(),
      )
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
      const result = await apply(fixture, accepted.value.run_id)
      assert.equal(result.state, 'settled_complete', JSON.stringify(result))
      const posts = (await fixture.fake.records()).filter((value) => value.method === 'POST')
      assert.deepEqual(
        posts.map((value) => value.path),
        ['/api/stock/location/', '/api/company/', '/api/stock/'],
      )
      assert.deepEqual(JSON.parse(posts[0].body.toString()), {
        name: 'Reel shelf',
        description: 'Opened reels',
        parent: '43',
      })
      assert.deepEqual(JSON.parse(posts[1].body.toString()), {
        name: 'Acme Reels',
        description: '',
        is_supplier: true,
        is_manufacturer: true,
      })
      const location = (
        await fixture.db.pool.query("SELECT pk FROM fake_record WHERE family='location'")
      ).rows[0].pk
      assert.equal(JSON.parse(posts[2].body.toString()).location, String(location))
      const stored = (
        await fixture.db.pool.query('SELECT family,body FROM fake_record ORDER BY pk')
      ).rows
      assert.deepEqual(
        stored.map((row) => row.family),
        ['location', 'company'],
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test('without the /2 capability a draft is a truthful unavailable intent', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { capture } = await draftedBatch(fixture)
    const scope = {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    }
    const reviewed = await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)
    assert.equal(reviewed.status, 409)
    assert.equal(reviewed.value.code, 'record_creation_unavailable')
    assert.equal(
      (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
      0,
    )
  } finally {
    await fixture.dispose()
  }
})

test(
  'one preparation can both inherit a reused new location and select it explicitly',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture } = await draftedBatch(fixture)
      const runId = await approved(fixture, capture.batch, capture.a.id)
      assert.equal((await apply(fixture, runId)).state, 'settled_complete')
      const locationPk = String(
        (await fixture.db.pool.query("SELECT pk FROM fake_record WHERE family='location'")).rows[0]
          .pk,
      )
      await capture.edit({ kind: 'lot', id: capture.b.id, location: { mode: 'inherit' } })
      await capture.edit({
        kind: 'add_lot',
        label: 'Packet C',
        note: '5 counted pieces.',
        part_subject_id: capture.partId,
      })
      const c = capture.batch.lots.find((value) => value.label === 'Packet C')!
      const observed = await fixture.http(`/batches/${capture.batch.id}/observations`, {
        model: 'location',
        pk: locationPk,
      })
      assert.equal(observed.status, 201, JSON.stringify(observed.value))
      await capture.edit({
        kind: 'lot',
        id: c.id,
        quantity: { mode: 'set', value: '5' },
        location: {
          mode: 'set',
          value: {
            observation_id: observed.value.id,
            target_context_id: observed.value.target_context_id,
            model: 'location',
            pk: locationPk,
          },
        },
      })
      const scope = {
        expected_batch_revision: capture.batch.revision,
        selected_lot_ids: [capture.b.id, c.id],
      }
      assert.equal((await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)).status, 200)
      const prepared = await fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
      assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
      const preview = prepared.value.preparation as ManualPreviewDto
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
        randomUUID(),
      )
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
      assert.equal((await apply(fixture, accepted.value.run_id)).state, 'settled_complete')
      const stock = (await fixture.fake.records()).filter(
        (value) => value.method === 'POST' && value.path === '/api/stock/',
      )
      assert.deepEqual(
        stock.slice(1).map((value) => JSON.parse(value.body.toString()).location),
        [locationPk, locationPk],
      )
      assert.equal(await posts(fixture, '/api/stock/location/'), 1, 'never created twice')
    } finally {
      await fixture.dispose()
    }
  },
)

/** Run A creates the records; run B reuses them for Packet B and settles before its stock. */
async function reusingRun(fixture: Fixture) {
  const drafted = await draftedBatch(fixture)
  const { capture } = drafted
  const first = await approved(fixture, capture.batch, capture.a.id)
  assert.equal((await apply(fixture, first)).state, 'settled_complete')
  await capture.edit({ kind: 'lot', id: capture.b.id, location: { mode: 'inherit' } })
  const later = await approved(fixture, capture.batch, capture.b.id)
  async function dispatch(runId: string, selection: Record<string, string[]>) {
    const current = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
    const chosen = await fixture.http(`/runs/${runId}/recover`, {
      expected_run_revision: current.revision,
      ...selection,
    })
    assert.equal(chosen.status, 200, JSON.stringify(chosen.value))
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
  /** Changes the stored record and has run A inspect its create, which reports the change. */
  async function invalidate(family: 'location' | 'company') {
    await fixture.db.pool.query(
      "UPDATE fake_record SET body=jsonb_set(body,'{name}','\"Renamed\"') WHERE family=$1",
      [family],
    )
    const key =
      family === 'location'
        ? locationCreateKey(drafted.locationDraft)
        : companyCreateKey(drafted.companyDraft)
    await dispatch(first, { assessment_keys: [key] })
    const inspected = (await fixture.http(`/runs/${first}`)).value as ManualRunDto
    assert.equal(
      inspected.supported_effects!.find((effect) => effect.operation_key === key)!.verification,
      'missing_or_changed',
    )
  }
  return { capture, first, later, dispatch, invalidate }
}

for (const family of ['location', 'company'] as const) {
  test(
    `a resumed run never stocks while a reused ${family} has since been inspected as changed`,
    { timeout: 60000 },
    async () => {
      const fixture = await manualFixture({ records: true })
      try {
        const { capture, later, dispatch, invalidate } = await reusingRun(fixture)
        await fixture.fake.fault('read_unavailable')
        assert.equal((await apply(fixture, later)).state, 'settled_incomplete')
        await fixture.fake.fault('none')
        assert.equal(await posts(fixture, '/api/stock/'), 1)
        await invalidate(family)
        await dispatch(later, { effect_keys: [capture.b.id] })
        assert.equal(await posts(fixture, '/api/stock/'), 1, 'no stock while the reuse is unusable')
        const resumed = (await fixture.http(`/runs/${later}`)).value as ManualRunDto
        assert.equal(resumed.state, 'settled_incomplete')
      } finally {
        await fixture.dispose()
      }
    },
  )
}

test(
  'stock already placed in a reused location can still be inspected after that location changes',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture, later, dispatch, invalidate } = await reusingRun(fixture)
      assert.equal((await apply(fixture, later)).state, 'settled_complete')
      await invalidate('location')
      const before = (await fixture.fake.records()).filter((value) => value.method === 'GET').length
      await dispatch(later, { assessment_keys: [capture.b.id] })
      const reads = (await fixture.fake.records()).filter((value) => value.method === 'GET').length
      assert.ok(reads > before, 'the inspection reads the stock')
      const inspected = (await fixture.http(`/runs/${later}`)).value as ManualRunDto
      const stock = inspected.supported_effects!.find(
        (effect) => effect.operation_key === capture.b.id,
      )!
      assert.equal(stock.verification, 'matches')
      assert.equal(await posts(fixture, '/api/stock/'), 2)
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'a later lot reuses the confirmed new location and supplier without creating them again',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture } = await draftedBatch(fixture)
      const first = await prepare(fixture, capture.batch, capture.a.id)
      const preview = first.value.preparation as ManualPreviewDto
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
        randomUUID(),
      )
      assert.equal((await apply(fixture, accepted.value.run_id)).state, 'settled_complete')
      const created = (
        await fixture.db.pool.query('SELECT family,pk FROM fake_record ORDER BY pk')
      ).rows.map((row) => [row.family, String(row.pk)])
      await capture.edit({ kind: 'lot', id: capture.b.id, location: { mode: 'inherit' } })
      const second = await prepare(fixture, capture.batch, capture.b.id)
      assert.equal(second.value.status, 'prepared', JSON.stringify(second.value))
      const reused = second.value.preparation as ManualPreviewDto
      assert.deepEqual(reused.supported_effects, [], 'no record is created twice')
      const run = await fixture.http(
        `/preparations/${reused.id}/approvals`,
        approval(reused),
        randomUUID(),
      )
      assert.equal(run.status, 200, JSON.stringify(run.value))
      assert.equal((await apply(fixture, run.value.run_id)).state, 'settled_complete')
      const posts = (await fixture.fake.records()).filter((value) => value.method === 'POST')
      assert.deepEqual(
        posts.map((value) => value.path),
        ['/api/stock/location/', '/api/company/', '/api/stock/', '/api/stock/'],
      )
      assert.equal(JSON.parse(posts[3].body.toString()).location, created[0][1])
      assert.equal((await fixture.db.pool.query('SELECT 1 FROM fake_record')).rows.length, 2)
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'a lost create acknowledgement stays unknown under the original operation through restart',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture, locationDraft } = await draftedBatch(fixture)
      const runId = await approved(fixture, capture.batch, capture.a.id)
      await fixture.fake.fault('record_drop_response')
      assert.equal((await apply(fixture, runId)).state, 'recovery_required')
      await fixture.fake.fault('none')
      let state = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const create = state.supported_effects!.find((effect) => effect.kind === 'create_location')!
      assert.equal(create.operation_key, locationCreateKey(locationDraft))
      assert.equal(create.certainty, 'unknown')
      assert.deepEqual(create.remote_pks, [])
      assert.equal(create.recovery_action, null, 'an unattributed create has no recovery')
      // A restart re-dispatches the original run; it never sends the create again.
      const command = (
        await fixture.db.pool.query(
          'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
          [runId],
        )
      ).rows[0]
      await executeManualDispatch(
        fixture.runner.pool,
        fixture.runnerConfig,
        command.workflow_id,
        JSON.parse(command.payload_bytes.toString('utf8')),
      ).catch(() => undefined)
      state = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      assert.equal(state.state, 'recovery_required')
      const recover = await fixture.http(`/runs/${runId}/recover`, {
        expected_run_revision: state.revision,
        effect_keys: [create.operation_key],
      })
      assert.equal(recover.status, 409, 'resuming an uncertain create is refused')
      assert.equal(await posts(fixture, '/api/stock/location/'), 1)
      assert.equal(await posts(fixture, '/api/company/'), 0)
      assert.equal(await posts(fixture, '/api/stock/'), 0)
      // A later lot with the same draft cannot mint a new create while the original is unknown.
      await capture.edit({ kind: 'lot', id: capture.b.id, location: { mode: 'inherit' } })
      const later = await fixture.http(`/batches/${capture.batch.id}/reviews`, {
        expected_batch_revision: capture.batch.revision,
        selected_lot_ids: [capture.b.id],
      })
      assert.equal(later.status, 409)
      assert.equal(later.value.code, 'source_history_unsettled')
      const searched = (await fixture.fake.records()).filter(
        (value) => value.method === 'GET' && /[?&](search|name)=/.test(value.path),
      )
      assert.deepEqual(searched, [], 'no lookup by name ever settles a create')
      assert.equal(await posts(fixture, '/api/stock/location/'), 1)
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'a malformed but attributed create is confirmed only by an explicit original-output check',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture } = await draftedBatch(fixture)
      const runId = await approved(fixture, capture.batch, capture.a.id)
      await fixture.fake.fault('record_malformed')
      assert.equal((await apply(fixture, runId)).state, 'recovery_required')
      await fixture.fake.fault('none')
      const state = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const create = state.supported_effects!.find((effect) => effect.kind === 'create_location')!
      assert.equal(create.certainty, 'unknown')
      assert.equal(create.remote_pks.length, 1)
      assert.equal(create.recovery_action, 'verify_effect')
      const selected = await fixture.http(`/runs/${runId}/recover`, {
        expected_run_revision: state.revision,
        assessment_keys: [create.operation_key],
      })
      assert.equal(selected.status, 200, JSON.stringify(selected.value))
      const command = (
        await fixture.db.pool.query(
          'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
          [runId],
        )
      ).rows[0]
      await executeManualDispatch(
        fixture.runner.pool,
        fixture.runnerConfig,
        command.workflow_id,
        JSON.parse(command.payload_bytes.toString('utf8')),
      )
      const verified = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const confirmed = verified.supported_effects!.find(
        (effect) => effect.kind === 'create_location',
      )!
      assert.equal(confirmed.certainty, 'confirmed')
      assert.equal(confirmed.verification, 'matches')
      assert.equal(await posts(fixture, '/api/stock/location/'), 1, 'never created twice')
      async function resume(key: string) {
        const current = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
        const chosen = await fixture.http(`/runs/${runId}/recover`, {
          expected_run_revision: current.revision,
          effect_keys: [key],
        })
        assert.equal(chosen.status, 200, JSON.stringify(chosen.value))
        const next = (
          await fixture.db.pool.query(
            'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
            [runId],
          )
        ).rows[0]
        return executeManualDispatch(
          fixture.runner.pool,
          fixture.runnerConfig,
          next.workflow_id,
          JSON.parse(next.payload_bytes.toString('utf8')),
        )
      }
      const company = verified.supported_effects!.find(
        (effect) => effect.kind === 'create_company',
      )!
      await resume(company.operation_key)
      assert.equal((await resume(capture.a.id)).state, 'settled_complete')
      // The recovered output is reused by a later lot through approval, never created again.
      await capture.edit({ kind: 'lot', id: capture.b.id, location: { mode: 'inherit' } })
      const laterRun = await approved(fixture, capture.batch, capture.b.id)
      assert.equal((await apply(fixture, laterRun)).state, 'settled_complete')
      assert.equal(await posts(fixture, '/api/stock/location/'), 1)
      assert.equal(await posts(fixture, '/api/company/'), 1)
      const stocks = await fixture.fake.stocks()
      assert.equal(stocks.length, 2)
      assert.equal(stocks[1].location, confirmed.remote_pks[0])
    } finally {
      await fixture.dispose()
    }
  },
)

test('cancellation, a changed draft and an unreadable parent all stop before any create', async () => {
  const fixture = await manualFixture({ records: true })
  try {
    const { capture, renameLocation } = await draftedBatch(fixture)
    const runId = await approved(fixture, capture.batch, capture.a.id)
    const before = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
    const cancelled = await fixture.http(`/runs/${runId}/cancel`, {
      expected_run_revision: before.revision,
    })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.value))
    assert.equal((await fixture.fake.records()).filter((v) => v.method === 'POST').length, 0)

    const other = await manualFixture({ records: true })
    try {
      const drafted = await draftedBatch(other)
      const prepared = await prepare(other, drafted.capture.batch, drafted.capture.a.id)
      const preview = prepared.value.preparation as ManualPreviewDto
      await drafted.renameLocation('Reel shelf 2')
      const stale = await other.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
        randomUUID(),
      )
      assert.equal(stale.status, 409, 'a changed draft makes the preparation stale')
      await other.fake.fault('read_unavailable')
      const blocked = await prepare(other, drafted.capture.batch, drafted.capture.a.id)
      assert.equal(blocked.value.status, 'blocked', JSON.stringify(blocked.value))
      await other.fake.fault('none')
      const corrected = await prepare(other, drafted.capture.batch, drafted.capture.a.id)
      assert.equal(corrected.value.status, 'prepared', 'the draft stays correctable')
      assert.equal((await other.fake.records()).filter((v) => v.method === 'POST').length, 0)
    } finally {
      await other.dispose()
    }
    void renameLocation
  } finally {
    await fixture.dispose()
  }
})

test(
  'a stock line never runs without its confirmed new location, even when resumed alone',
  { timeout: 60000 },
  async () => {
    const fixture = await manualFixture({ records: true })
    try {
      const { capture, locationDraft } = await draftedBatch(fixture)
      const runId = await approved(fixture, capture.batch, capture.a.id)
      await fixture.fake.fault('read_unavailable')
      assert.equal((await apply(fixture, runId)).state, 'settled_incomplete')
      await fixture.fake.fault('none')
      assert.equal(await posts(fixture, '/api/stock/location/'), 0)
      async function resume(key: string) {
        const current = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
        const selected = await fixture.http(`/runs/${runId}/recover`, {
          expected_run_revision: current.revision,
          effect_keys: [key],
        })
        assert.equal(selected.status, 200, JSON.stringify(selected.value))
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
      await resume(capture.a.id)
      assert.equal(await posts(fixture, '/api/stock/'), 0, 'no stock without its location')
      await resume(locationCreateKey(locationDraft))
      await resume(capture.a.id)
      assert.equal(await posts(fixture, '/api/stock/location/'), 1)
      assert.equal(await posts(fixture, '/api/stock/'), 1)
      const location = (
        await fixture.db.pool.query("SELECT pk FROM fake_record WHERE family='location'")
      ).rows[0].pk
      assert.equal((await fixture.fake.stocks())[0].location, String(location))
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'a new supplier logo is sent once as the company image and confirmed from the output',
  { timeout: 120000 },
  async (context) => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    if (!image) {
      context.skip('explicit isolated decoder image required')
      return
    }
    const fixture = await manualFixture({ records: true, media: true })
    try {
      const { capture, companyDraft } = await draftedBatch(fixture, '43', async (batchId) => {
        const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store!)
        const uploaded = (await repository.upload(batchId, randomUUID(), '1', 'logo.png', png)) as {
          evidence_id: string
          version: { id: string }
        }
        await processMediaCommand(fixture.db.pool, fixture.store!, fixture.config, image)
        return { evidence_id: uploaded.evidence_id, version_id: uploaded.version.id }
      })
      const runId = await approved(fixture, capture.batch, capture.a.id)
      await fixture.fake.fault('record_without_image')
      assert.equal((await apply(fixture, runId)).state, 'recovery_required')
      await fixture.fake.fault('none')
      const unconfirmed = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const pending = unconfirmed.supported_effects!.find(
        (effect) => effect.operation_key === companyCreateKey(companyDraft),
      )!
      assert.equal(pending.certainty, 'unknown', 'an output without the image is not confirmed')
      const selected = await fixture.http(`/runs/${runId}/recover`, {
        expected_run_revision: unconfirmed.revision,
        assessment_keys: [pending.operation_key],
      })
      assert.equal(selected.status, 200, JSON.stringify(selected.value))
      const command = (
        await fixture.db.pool.query(
          'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1 ORDER BY d.sequence DESC LIMIT 1',
          [runId],
        )
      ).rows[0]
      await executeManualDispatch(
        fixture.runner.pool,
        fixture.runnerConfig,
        command.workflow_id,
        JSON.parse(command.payload_bytes.toString('utf8')),
      )
      const companies = (await fixture.fake.records()).filter(
        (value) => value.method === 'POST' && value.path === '/api/company/',
      )
      assert.equal(companies.length, 1)
      assert.match(companies[0].body.toString('latin1'), /name="image"; filename="bench-/)
      const stored = (
        await fixture.db.pool.query("SELECT image_sha256 FROM fake_record WHERE family='company'")
      ).rows[0]
      assert.equal(stored.image_sha256, createHash('sha256').update(png).digest('hex'))
      const state = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      const create = state.supported_effects!.find(
        (effect) => effect.operation_key === companyCreateKey(companyDraft),
      )!
      assert.equal(create.certainty, 'confirmed')
      assert.equal(create.verification, 'matches', 'the stored company carries the image')
      assert.notEqual(create.inputs.image, '')
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'a stock attachment completes on stock placed in a location created by the same run',
  { timeout: 120000 },
  async (context) => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    if (!image) {
      context.skip('explicit isolated decoder image required')
      return
    }
    const fixture = await manualFixture({ records: true, media: true })
    try {
      const { capture } = await draftedBatch(fixture)
      const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store!)
      const uploaded = (await repository.upload(
        capture.batch.id,
        randomUUID(),
        '1',
        'label.png',
        png,
      )) as { evidence_id: string; version: { id: string } }
      await processMediaCommand(fixture.db.pool, fixture.store!, fixture.config, image)
      const linked = await editMedia(
        fixture.api.pool,
        fixture.config,
        capture.batch.id,
        randomUUID(),
        {
          expected_revision: (await repository.snapshot(capture.batch.id)).revision,
          change: {
            kind: 'link',
            evidence_id: uploaded.evidence_id,
            subject_id: capture.a.id,
            linked: true,
          },
        } as never,
      )
      await editMedia(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), {
        expected_revision: (linked as { revision: string }).revision,
        change: {
          kind: 'select_attachment',
          subject_id: capture.a.id,
          mode: 'selected',
          version_id: uploaded.version.id,
          destination: 'lot_attachment',
        },
      })
      const refreshed = (await fixture.http(`/batches/${capture.batch.id}`))
        .value as CaptureSnapshotDto
      const runId = await approved(fixture, refreshed, capture.a.id)
      assert.equal((await apply(fixture, runId)).state, 'settled_complete')
      assert.equal(await posts(fixture, '/api/stock/attachment/'), 1)
      const state = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      assert.equal(state.attachments?.[0].certainty, 'confirmed', JSON.stringify(state.attachments))
    } finally {
      await fixture.dispose()
    }
  },
)
