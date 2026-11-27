import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  validate,
  type BatchRecordsDto,
  type CaptureObservationDto,
  type CaptureSnapshotDto,
  type InventoryPartSpecDto,
  type OperatorReviewDto,
  type RecordChangeDto,
  type RecordExistingValuesDto,
} from '@invimport/contracts'
import { manualFixture } from '../support/manual.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>
type Model = 'category' | 'parameter_template' | 'category_parameter' | 'company'

async function capture(fixture: Fixture, batchId: string) {
  const result = await fixture.http(`/batches/${batchId}`)
  assert.equal(result.status, 200)
  return result.value as CaptureSnapshotDto
}

function specOf(batch: CaptureSnapshotDto, partId: string) {
  const choice = batch.parts.find((part) => part.id === partId)!.choice
  assert.equal(choice.mode, 'create')
  return (choice as { spec: InventoryPartSpecDto }).spec
}

async function selections(fixture: Fixture, batchId: string) {
  const result = await fixture.db.pool.query(
    `SELECT subject_id, actor_id FROM capture_selection
     WHERE batch_id=$1 AND field='choice' ORDER BY version, subject_id`,
    [batchId],
  )
  return result.rows as { subject_id: string; actor_id: string }[]
}

/**
 * Part A (Resistors, used by lots A and B) and Part B (Capacitors, used by lot C) both use
 * template 201 and supplier company 12; only Part A has a manufacturer.
 */
async function recordBatch(fixture: Fixture) {
  const seeded = await fixture.seedCapture()
  let batch = seeded.batch
  const batchId = batch.id
  async function observe<M extends Model>(model: M, pk: string) {
    const response = await fixture.http(`/batches/${batchId}/observations`, { model, pk })
    assert.equal(response.status, 201, JSON.stringify(response.value))
    const observed = response.value as CaptureObservationDto
    return {
      observation_id: observed.id,
      target_context_id: observed.target_context_id,
      model,
      pk: observed.pk,
    }
  }
  async function edit(change: Record<string, unknown>) {
    const response = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: batch.revision,
      change,
    })
    assert.equal(response.status, 200, JSON.stringify(response.value))
    batch = response.value as CaptureSnapshotDto
  }
  const refs = {
    resistors: await observe('category', '81'),
    capacitors: await observe('category', '82'),
    resistance: await observe('parameter_template', '201'),
    resistorType: await observe('parameter_template', '202'),
    resistors201: await observe('category_parameter', '301'),
    resistors202: await observe('category_parameter', '311'),
    capacitors201: await observe('category_parameter', '312'),
    capacitors202: await observe('category_parameter', '313'),
    both: await observe('company', '12'),
    manufacturerOnly: await observe('company', '601'),
    supplierOnly: await observe('company', '602'),
  }
  const partA = seeded.partId
  await edit({
    kind: 'part',
    id: partA,
    choice: {
      mode: 'create',
      spec: {
        name: 'Carbon film resistor',
        category: refs.resistors,
        parameters: [
          { template: refs.resistance, category_mapping: refs.resistors201, value: '4.7 kΩ' },
        ],
        manufacturer: { company: refs.both, mpn: 'CF-47' },
        supplier: { company: refs.both, sku: 'S-47' },
        tags: ['SMD'],
      },
    },
  })
  await edit({ kind: 'add_part', label: 'Ceramic capacitor' })
  const partB = batch.parts.find((part) => part.label === 'Ceramic capacitor')!.id
  await edit({
    kind: 'part',
    id: partB,
    choice: {
      mode: 'create',
      spec: {
        name: 'Ceramic capacitor',
        category: refs.capacitors,
        parameters: [
          { template: refs.resistance, category_mapping: refs.capacitors201, value: '100 nF' },
        ],
        manufacturer: null,
        supplier: { company: refs.both, sku: 'S-100' },
        tags: [],
      },
    },
  })
  await edit({
    kind: 'add_lot',
    label: 'Packet C',
    note: '5 counted pieces.',
    part_subject_id: partB,
  })
  const c = batch.lots.find((lot) => lot.label === 'Packet C')!
  await edit({ kind: 'lot', id: c.id, quantity: { mode: 'set', value: '5' } })
  return { batchId, partA, partB, a: seeded.a, b: seeded.b, c, refs, batch }
}

function record(
  fixture: Fixture,
  batchId: string,
  revision: string,
  target: RecordChangeDto['target'],
  operation: RecordChangeDto['operation'],
) {
  return fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: revision,
    change: { kind: 'record', target, operation },
  })
}

test('a shared company maps on every Part in one revision, attributed to the operator', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, partB, refs, batch } = await recordBatch(fixture)
    const before = await selections(fixture, batchId)

    const stale = await record(
      fixture,
      batchId,
      (BigInt(batch.revision) - 1n).toString(),
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: refs.supplierOnly },
    )
    assert.equal(stale.status, 412, JSON.stringify(stale.value))
    assert.deepEqual(await selections(fixture, batchId), before)

    const mapped = await record(
      fixture,
      batchId,
      batch.revision,
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: refs.supplierOnly },
    )
    assert.equal(mapped.status, 200, JSON.stringify(mapped.value))
    const after = mapped.value as CaptureSnapshotDto
    assert.equal(after.revision, (BigInt(batch.revision) + 1n).toString())
    assert.equal(specOf(after, partA).supplier!.company.pk, '602')
    assert.equal(specOf(after, partA).supplier!.sku, 'S-47')
    assert.equal(specOf(after, partA).manufacturer!.company.pk, '12')
    assert.equal(specOf(after, partB).supplier!.company.pk, '602')
    const written = (await selections(fixture, batchId)).slice(before.length)
    assert.deepEqual(
      written.map((row) => row.subject_id),
      [partA, partB].sort(),
    )
    assert.ok(written.every((row) => row.actor_id === after.actor_id))
  } finally {
    await fixture.dispose()
  }
})

test('a company map to one without that role is refused and changes nothing', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, refs, batch } = await recordBatch(fixture)
    const refusedEdit = await record(
      fixture,
      batchId,
      batch.revision,
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: refs.manufacturerOnly },
    )
    assert.equal(refusedEdit.status, 422, JSON.stringify(refusedEdit.value))
    assert.equal(refusedEdit.value.code, 'company_role_incompatible')
    assert.equal((await capture(fixture, batchId)).revision, batch.revision)
  } finally {
    await fixture.dispose()
  }
})

test('a template map without a Part’s category mapping is refused unless that Part is excluded', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, partB, refs, batch } = await recordBatch(fixture)
    const target = { kind: 'parameter_template' as const, pk: '201' }
    const omitting = (exclude: string[]) => ({
      op: 'map_template' as const,
      template: refs.resistorType,
      category_mappings: [refs.resistors202],
      exclude_parts: exclude,
    })
    const refusedEdit = await record(fixture, batchId, batch.revision, target, omitting([]))
    assert.equal(refusedEdit.status, 422, JSON.stringify(refusedEdit.value))
    assert.equal(refusedEdit.value.code, 'parameter_category_incompatible')
    assert.equal((await capture(fixture, batchId)).revision, batch.revision)

    const excluded = await record(fixture, batchId, batch.revision, target, omitting([partB]))
    assert.equal(excluded.status, 200, JSON.stringify(excluded.value))
    const after = excluded.value as CaptureSnapshotDto
    assert.equal(specOf(after, partA).parameters[0].template.pk, '202')
    assert.equal(specOf(after, partA).parameters[0].category_mapping.pk, '311')
    assert.equal(specOf(after, partB).parameters[0].template.pk, '201')

    const both = await record(fixture, batchId, after.revision, target, {
      ...omitting([]),
      category_mappings: [refs.capacitors202],
    })
    assert.equal(both.status, 200, JSON.stringify(both.value))
    assert.equal(specOf(both.value, partB).parameters[0].category_mapping.pk, '313')
  } finally {
    await fixture.dispose()
  }
})

test('a category change is refused while a parameter is neither mapped nor dropped', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, refs, batch } = await recordBatch(fixture)
    const target = { kind: 'part' as const, part_subject_id: partA }
    const unmapped = await record(fixture, batchId, batch.revision, target, {
      op: 'set_category',
      reference: refs.capacitors,
      parameter_mappings: [],
      drop_parameters: [],
    })
    assert.equal(unmapped.status, 422, JSON.stringify(unmapped.value))
    assert.equal(unmapped.value.code, 'parameter_mapping_required')

    const mapped = await record(fixture, batchId, batch.revision, target, {
      op: 'set_category',
      reference: refs.capacitors,
      parameter_mappings: [{ template_pk: '201', category_mapping: refs.capacitors201 }],
      drop_parameters: [],
    })
    assert.equal(mapped.status, 200, JSON.stringify(mapped.value))
    assert.equal(specOf(mapped.value, partA).category.pk, '82')
  } finally {
    await fixture.dispose()
  }
})

test('editing a Part marks its reviewed lots changed since review, and no others', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, a, b, c, refs } = await recordBatch(fixture)
    const current = await capture(fixture, batchId)
    const reviewed = await fixture.http(`/batches/${batchId}/reviews`, {
      expected_batch_revision: current.revision,
      selected_lot_ids: [a.id, b.id, c.id],
    })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))
    const latest = await capture(fixture, batchId)

    const sku = await record(
      fixture,
      batchId,
      latest.revision,
      { kind: 'supplier_part', part_subject_id: partA },
      { op: 'set_sku', company: refs.both, sku: 'S-48' },
    )
    assert.equal(sku.status, 200, JSON.stringify(sku.value))
    const review = (await fixture.http(`/batches/${batchId}/operator-review`))
      .value as OperatorReviewDto
    const state = (id: string) => review.lots.find((lot) => lot.lot_id === id)?.review_state
    assert.equal(state(a.id), 'changed_after_review')
    assert.equal(state(b.id), 'changed_after_review')
    assert.equal(state(c.id), 'reviewed')
  } finally {
    await fixture.dispose()
  }
})

test('record edits change review state through Part material, not by calling operator review', async () => {
  const source = await readFile(new URL('../../src/capture/repository.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /operator-review/)
})

test('a description is set on one Part and clearing removes it from the spec', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, batch } = await recordBatch(fixture)
    const target = { kind: 'part' as const, part_subject_id: partA }
    const set = await record(fixture, batchId, batch.revision, target, {
      op: 'set_description',
      value: 'Through-hole, 1/4 W',
    })
    assert.equal(set.status, 200, JSON.stringify(set.value))
    assert.equal(specOf(set.value, partA).description, 'Through-hole, 1/4 W')
    const cleared = await record(fixture, batchId, set.value.revision, target, {
      op: 'set_description',
      value: null,
    })
    assert.equal(cleared.status, 200, JSON.stringify(cleared.value))
    assert.equal('description' in specOf(cleared.value, partA), false)
  } finally {
    await fixture.dispose()
  }
})

test('the records read lists the batch’s records, follows edits and writes nothing', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId, partA, partB, refs, batch } = await recordBatch(fixture)
    const before = await selections(fixture, batchId)
    const read = await fixture.http(`/batches/${batchId}/records`)
    assert.equal(read.status, 200, JSON.stringify(read.value))
    const records = read.value as BatchRecordsDto
    assert.equal(records.revision, batch.revision)
    const supplier = records.records.find((item) => item.key === 'company:supplier:12')!
    assert.deepEqual([...supplier.part_ids].sort(), [partA, partB].sort())
    assert.equal(supplier.lot_ids.length, 3)
    assert.deepEqual(await selections(fixture, batchId), before)

    const mapped = await record(
      fixture,
      batchId,
      batch.revision,
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: refs.supplierOnly },
    )
    assert.equal(mapped.status, 200, JSON.stringify(mapped.value))
    const after = (await fixture.http(`/batches/${batchId}/records`)).value as BatchRecordsDto
    assert.equal(
      after.records.some((item) => item.key === 'company:supplier:12'),
      false,
    )
    assert.deepEqual(
      [...after.records.find((item) => item.key === 'company:supplier:602')!.part_ids].sort(),
      [partA, partB].sort(),
    )
  } finally {
    await fixture.dispose()
  }
})

test('the existing values read reads each mapped record from the target and stores nothing', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId } = await recordBatch(fixture)
    const before = await selections(fixture, batchId)
    const records = (await fixture.http(`/batches/${batchId}/records`)).value as BatchRecordsDto
    const mapped = records.records.filter((item) => item.mapped)
    assert.ok(mapped.some((item) => item.key === 'company:supplier:12'))

    const read = await fixture.http(`/batches/${batchId}/records/existing`)
    assert.equal(read.status, 200, JSON.stringify(read.value))
    const existing = read.value as RecordExistingValuesDto
    validate('RecordExistingValues', existing)
    assert.deepEqual(
      existing.records.map((item) => item.key),
      mapped.slice(0, existing.records.length).map((item) => item.key),
    )
    const supplier = existing.records.find((item) => item.key === 'company:supplier:12')!
    assert.equal(supplier.status, 'found')
    assert.ok(
      supplier.status === 'found' &&
        supplier.fields.some((field) => field.name === 'name' && field.value),
    )
    assert.deepEqual(await selections(fixture, batchId), before)
  } finally {
    await fixture.dispose()
  }
})

test('the existing values read refuses once the target context has rotated', async () => {
  const fixture = await manualFixture({ effects: true })
  try {
    const { batchId } = await recordBatch(fixture)
    const next = randomUUID()
    await fixture.db.pool.query('INSERT INTO target_context VALUES ($1,$2,2,$3)', [
      next,
      fixture.identity.target,
      Buffer.alloc(32, 1),
    ])
    await fixture.db.pool.query('UPDATE target SET current_context_id=$1 WHERE id=$2', [
      next,
      fixture.identity.target,
    ])
    const read = await fixture.http(`/batches/${batchId}/records/existing`)
    assert.equal(read.status, 409, JSON.stringify(read.value))
    assert.equal((read.value as { code: string }).code, 'target_context_changed')
  } finally {
    await fixture.dispose()
  }
})
