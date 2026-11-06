import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type ManualPreviewDto, type InventoryPartSpecDto } from '@invimport/contracts'
import { preparationTree } from '../src/review/preparation-tree.ts'
import type { ExecutablePlan } from '../src/execution/media-plan.ts'
import { logicalEffectKey, partEffects, locationCreateKey } from '../src/execution/effects-plan.ts'

const context = '0c6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03'
const id = (n: number) => `0c6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`
const ref = <M extends string>(n: number, model: M, pk: string) => ({
  observation_id: id(n),
  target_context_id: context,
  model,
  pk,
})
const labels = new Map([
  [id(901), 'Resistors'],
  [id(903), 'Resistance'],
  [id(909), 'Yageo'],
  [id(910), 'DigiKey'],
])
const label = (observationId: string) => labels.get(observationId)

const lotA = id(101)
const lotB = id(102)
const subject = id(10)
const spec: InventoryPartSpecDto = {
  name: 'Carbon film resistor',
  category: ref(901, 'category', '81'),
  parameters: [
    {
      template: ref(903, 'parameter_template', '201'),
      category_mapping: ref(905, 'category_parameter', '301'),
      value: '4.7 kΩ',
    },
  ],
  manufacturer: { company: ref(909, 'company', '12'), mpn: 'CF-47' },
  supplier: { company: ref(910, 'company', '13'), sku: 'S-47' },
  tags: [],
}

const header = {
  deploymentId: id(1),
  targetId: id(2),
  contextId: context,
  epoch: id(3),
  continuity: 'owned-test',
  sourceId: id(4),
  originalSourceKey: id(4),
}

function stockEffect(lot: string, extra: object) {
  return {
    lot_id: lot,
    lot_label: lot === lotA ? 'Lot A' : 'Lot B',
    part_label: 'Existing resistor',
    quantity: lot === lotA ? '10' : '5',
    location_label: 'Bin 43',
    location_id: '43',
    contribution_key: id(200),
    barcode: 'bi1:x:y',
    ...extra,
  }
}

function preview(effects: object[], extra: object = {}) {
  return {
    id: id(50),
    batch_id: id(51),
    selected_lot_ids: effects.map((effect) => (effect as { lot_id: string }).lot_id),
    remaining_lot_ids: [],
    plan_sha256: 'a'.repeat(64),
    review_fingerprint: 'b'.repeat(64),
    target_revision: '1',
    capability: 'owned-fake-stock/1',
    effects,
    ...extra,
  } as unknown as ManualPreviewDto
}

const shape = (nodes: ReturnType<typeof preparationTree>) =>
  nodes?.map((node) => [node.kind, node.label, node.state, node.parent_key, node.location_key])

test('a stock plan places each stock item under its existing Part and location', () => {
  const plan = {
    ...header,
    version: 'bench-stock-plan/1',
    build: 'bench-stock/1',
    capability: 'owned-fake-stock/1',
    operations: [
      {
        operationKey: lotA,
        contributionKey: id(200),
        part: '29',
        location: '43',
        quantity: '10',
        barcode: 'x',
      },
      {
        operationKey: lotB,
        contributionKey: id(201),
        part: '29',
        location: null,
        quantity: '5',
        barcode: 'y',
      },
    ],
  } as unknown as ExecutablePlan
  const nodes = preparationTree(
    plan,
    preview([
      stockEffect(lotA, { part_id: '29' }),
      stockEffect(lotB, { part_id: '29', location_id: null, location_label: 'No location' }),
    ]),
    label,
  )
  assert.deepEqual(shape(nodes), [
    ['location', 'Bin 43', 'exists', null, null],
    ['part', 'Existing resistor', 'exists', null, null],
    ['stock_item', 'Lot A · 10', 'new', 'part:pk:29', 'location:43'],
    ['stock_item', 'Lot B · 5', 'new', 'part:pk:29', null],
  ])
  assert.equal(nodes?.find((node) => node.kind === 'stock_item')?.lot_id, lotA)
  validate('PreparationTree', { preparation_id: id(50), plan_version: plan.version, nodes })
})

function effectsPlan(version: 'bench-effects-plan/1' | 'bench-effects-plan/2', prior = false) {
  const binding = {
    subjectId: subject,
    spec,
    specDigest: 'c'.repeat(64),
    prior: prior ? { runId: id(60), intentId: id(61), pk: '77' } : null,
  }
  const draft = id(30)
  return {
    ...header,
    version,
    build: version === 'bench-effects-plan/1' ? 'bench-effects/1' : 'bench-effects/2',
    capability:
      version === 'bench-effects-plan/1' ? 'owned-fake-effects/1' : 'owned-fake-effects/2',
    mediaConfigured: false,
    manifestDigest: 'd'.repeat(64),
    parts: [binding],
    partAttachments: [],
    effects: partEffects(binding),
    operations: [
      {
        operationKey: lotA,
        contributionKey: id(200),
        part: null,
        partOperationKey: logicalEffectKey(subject, 'create_part'),
        location: version === 'bench-effects-plan/1' ? '43' : null,
        ...(version === 'bench-effects-plan/2'
          ? { locationOperationKey: locationCreateKey(draft) }
          : {}),
        quantity: '10',
        barcode: 'x',
      },
    ],
    evidence: [],
    attachments: [],
    mediaInputsDigest: 'e'.repeat(64),
    ...(version === 'bench-effects-plan/2'
      ? {
          locations: [
            {
              draftId: draft,
              spec: { name: 'Shelf B', description: '', parent: null },
              specDigest: 'f'.repeat(64),
              prior: null,
            },
          ],
          companies: [
            {
              draftId: id(31),
              spec: { name: 'New Supply Co', description: '', isManufacturer: false, logo: null },
              specDigest: 'f'.repeat(64),
              prior: null,
            },
          ],
        }
      : {}),
  } as unknown as ExecutablePlan
}

const newPartEffect = (extra: object = {}) =>
  stockEffect(lotA, {
    part_id: null,
    part_operation_key: logicalEffectKey(subject, 'create_part'),
    part_label: 'Carbon film resistor',
    ...extra,
  })

test('an effects plan nests a new Part and its records under its category', () => {
  const plan = effectsPlan('bench-effects-plan/1')
  const nodes = preparationTree(plan, preview([newPartEffect()]), label)
  const part = `part:${subject}`
  assert.deepEqual(shape(nodes), [
    ['category', 'Resistors', 'exists', null, null],
    ['company', 'Yageo', 'exists', null, null],
    ['company', 'DigiKey', 'exists', null, null],
    ['location', 'Bin 43', 'exists', null, null],
    ['part', 'Carbon film resistor', 'new', 'category:81', null],
    ['parameter', 'Resistance: 4.7 kΩ', 'new', part, null],
    ['manufacturer_part', 'CF-47 · Yageo', 'new', part, null],
    ['supplier_part', 'S-47 · DigiKey', 'new', part, null],
    ['stock_item', 'Lot A · 10', 'new', part, 'location:43'],
  ])
  assert.ok(
    nodes
      ?.filter((node) => node.parent_key === part)
      .every((node) => node.part_subject_id === subject),
  )
  validate('PreparationTree', { preparation_id: id(50), plan_version: plan.version, nodes })
})

test('a /2 plan lists the new location and company it creates', () => {
  const plan = effectsPlan('bench-effects-plan/2')
  const draft = id(30)
  const nodes = preparationTree(
    plan,
    preview([
      newPartEffect({
        location_id: null,
        location_label: 'Shelf B (new location)',
        location_operation_key: locationCreateKey(draft),
      }),
    ]),
    label,
  )
  assert.deepEqual(
    nodes
      ?.filter(
        (node) => node.state === 'new' && (node.kind === 'location' || node.kind === 'company'),
      )
      .map((node) => [node.kind, node.label, node.key]),
    [
      ['company', 'New Supply Co', `company:new:${id(31)}`],
      ['location', 'Shelf B', `location:new:${draft}`],
    ],
  )
  assert.equal(
    nodes?.find((node) => node.kind === 'stock_item')?.location_key,
    `location:new:${draft}`,
  )
})

test('a Part created by an earlier run, and its records, already exist', () => {
  const nodes = preparationTree(
    effectsPlan('bench-effects-plan/1', true),
    preview([newPartEffect()]),
    label,
  )
  assert.deepEqual(
    nodes
      ?.filter((node) => node.parent_key === `part:${subject}` || node.kind === 'part')
      .map((node) => [node.kind, node.state]),
    [
      ['part', 'exists'],
      ['parameter', 'exists'],
      ['manufacturer_part', 'exists'],
      ['supplier_part', 'exists'],
      ['stock_item', 'new'],
    ],
  )
})

test('a media plan places each stock attachment under its stock item', () => {
  const plan = {
    ...header,
    version: 'bench-media-plan/1',
    build: 'bench-media/1',
    capability: 'owned-fake-media/1',
    operations: [
      {
        operationKey: lotA,
        contributionKey: id(200),
        part: '29',
        location: '43',
        quantity: '10',
        barcode: 'x',
      },
    ],
    attachments: [
      { artifactKey: id(70), stockOperationKey: lotA, destination: 'stock_attachment' },
    ],
    evidence: [],
    mediaInputsDigest: 'e'.repeat(64),
  } as unknown as ExecutablePlan
  const nodes = preparationTree(
    plan,
    preview([stockEffect(lotA, { part_id: '29' })], {
      capability: 'owned-fake-media/1',
      attachments: [
        {
          artifact_key: id(70),
          lot_id: lotA,
          lot_label: 'Lot A',
          evidence_label: 'Bag photo',
          destination: 'stock_attachment',
        },
      ],
    }),
    label,
  )
  assert.deepEqual(shape(nodes)?.at(-1), ['attachment', 'Bag photo', 'new', `stock:${lotA}`, null])
})

test('names fall back to the primary key when no observation is retained', () => {
  const nodes = preparationTree(
    effectsPlan('bench-effects-plan/1'),
    preview([newPartEffect()]),
    () => undefined,
  )
  assert.equal(nodes?.[0].label, 'Category 81')
})

test('an unknown plan version gives no tree', () => {
  const plan = { ...header, version: 'bench-future-plan/9' } as unknown as ExecutablePlan
  assert.equal(preparationTree(plan, preview([stockEffect(lotA, { part_id: '29' })]), label), null)
})
