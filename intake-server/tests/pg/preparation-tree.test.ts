import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  CaptureObservationDto,
  CaptureSnapshotDto,
  ManualPreviewDto,
  PreparationTreeDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function prepare(fixture: Fixture, batch: CaptureSnapshotDto, lotId: string) {
  const scope = { expected_batch_revision: batch.revision, selected_lot_ids: [lotId] }
  const reviewed = await fixture.http(`/batches/${batch.id}/reviews`, scope)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
  const prepared = await fixture.http(`/batches/${batch.id}/preparations`, scope)
  assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
  return prepared.value.preparation as ManualPreviewDto
}

async function stored(fixture: Fixture, id: string) {
  const row = (
    await fixture.db.pool.query(
      `SELECT p.plan_bytes, p.preview_bytes, o.response_bytes
         FROM manual_preparation p JOIN manual_prepare_outcome o ON o.command_id = p.prepare_command_id
        WHERE p.id = $1`,
      [id],
    )
  ).rows[0]
  return [row.plan_bytes, row.preview_bytes, row.response_bytes].map((value: Buffer) =>
    value.toString('hex'),
  )
}

async function tree(fixture: Fixture, id: string) {
  const result = await fixture.http(`/preparations/${id}/tree`)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value as PreparationTreeDto
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

test('a stock preparation reads as a tree without changing what replay compares', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const preview = await prepare(fixture, capture.batch, capture.a.id)
    const before = await stored(fixture, preview.id)

    const read = await tree(fixture, preview.id)
    assert.equal(read.plan_version, 'bench-stock-plan/1')
    assert.deepEqual(
      read.nodes?.map((node) => [node.kind, node.state, node.parent_key, node.location_key]),
      [
        ['location', 'exists', null, null],
        ['part', 'exists', null, null],
        ['stock_item', 'new', 'part:pk:29', 'location:43'],
      ],
    )
    assert.equal(read.nodes?.at(-1)?.lot_id, capture.a.id)

    assert.deepEqual(await stored(fixture, preview.id), before)
    const accepted = await fixture.http(
      `/preparations/${preview.id}/approvals`,
      approval(preview),
      randomUUID(),
    )
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
    assert.equal((await fixture.http(`/preparations/${randomUUID()}/tree`)).status, 404)
  } finally {
    await fixture.dispose()
  }
})

test('a new Part reads under its observed category, with its parameter', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const captured = await fixture.seedCapture()
    let batch = captured.batch
    const observe = async (
      model: 'category' | 'parameter_template' | 'category_parameter',
      pk: string,
    ) => {
      const response = await fixture.http(`/batches/${batch.id}/observations`, { model, pk })
      assert.equal(response.status, 201, JSON.stringify(response.value))
      const observed = response.value as CaptureObservationDto
      return {
        observation_id: observed.id,
        target_context_id: observed.target_context_id,
        model,
        pk,
      }
    }
    const category = await observe('category', '81')
    const template = await observe('parameter_template', '201')
    const mapping = await observe('category_parameter', '301')
    const changed = await fixture.http(`/batches/${batch.id}/edits`, {
      expected_revision: batch.revision,
      change: {
        kind: 'part',
        id: batch.parts[0].id,
        choice: {
          mode: 'create',
          spec: {
            name: 'Shared resistor',
            category,
            parameters: [{ template, category_mapping: mapping, value: '4.7 kΩ' }],
            manufacturer: null,
            supplier: null,
            tags: [],
          },
        },
      },
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.value))
    batch = changed.value as CaptureSnapshotDto
    const preview = await prepare(fixture, batch, captured.a.id)
    const before = await stored(fixture, preview.id)

    const read = await tree(fixture, preview.id)
    const labels = new Map(
      (
        await fixture.db.pool.query(
          'SELECT id, label FROM capture_observation WHERE batch_id = $1',
          [batch.id],
        )
      ).rows.map((row: { id: string; label: string }) => [row.id, row.label]),
    )
    const part = `part:${batch.parts[0].id}`
    assert.deepEqual(
      read.nodes
        ?.filter((node) => node.kind !== 'location')
        .map((node) => [node.kind, node.label, node.state, node.parent_key]),
      [
        ['category', labels.get(category.observation_id), 'exists', null],
        ['part', 'Shared resistor', 'new', 'category:81'],
        ['parameter', `${labels.get(template.observation_id)}: 4.7 kΩ`, 'new', part],
        ['stock_item', `${captured.a.label} · 17`, 'new', part],
      ],
    )
    assert.deepEqual(await stored(fixture, preview.id), before)
  } finally {
    await fixture.dispose()
  }
})
