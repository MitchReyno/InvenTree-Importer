import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto, ManualPreviewDto, ManualRunDto } from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'
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
async function draftedBatch(fixture: Fixture, parentPk: string | null = '43') {
  const capture = await fixture.seedCapture()
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
        value: { name: 'Acme Reels', description: '', also_manufacturer: true, logo: null },
      },
    ],
  })
  return { capture, locationDraft, companyDraft }
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
