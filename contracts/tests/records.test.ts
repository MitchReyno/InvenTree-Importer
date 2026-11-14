import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RecordEditError,
  applyRecordChange,
  recordScope,
  validate,
  type CaptureSnapshotDto,
  type InventoryPartSpecDto,
  type RecordChangeDto,
} from '../src/index.ts'

const context = '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03'
const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`

type Model = 'category' | 'parameter_template' | 'category_parameter' | 'company'
const observation = (n: number, model: Model, pk: string, mapping: object) => ({
  id: id(n),
  model,
  pk,
  mapping,
  target_context_id: context,
  label: `${model} ${pk}`,
  observed_at: '2026-11-06T00:00:00.000Z',
})
const observations = [
  observation(901, 'category', '81', { kind: 'category' }),
  observation(902, 'category', '82', { kind: 'category' }),
  observation(903, 'parameter_template', '201', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: true,
  }),
  observation(904, 'parameter_template', '202', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: true,
  }),
  observation(905, 'category_parameter', '301', {
    kind: 'category_parameter',
    category_id: '81',
    template_id: '201',
  }),
  observation(906, 'category_parameter', '311', {
    kind: 'category_parameter',
    category_id: '81',
    template_id: '202',
  }),
  observation(907, 'category_parameter', '312', {
    kind: 'category_parameter',
    category_id: '82',
    template_id: '201',
  }),
  observation(908, 'category_parameter', '313', {
    kind: 'category_parameter',
    category_id: '82',
    template_id: '202',
  }),
  observation(909, 'company', '12', { kind: 'company', manufacturer: true, supplier: true }),
  observation(910, 'company', '601', { kind: 'company', manufacturer: true, supplier: false }),
  observation(911, 'company', '602', { kind: 'company', manufacturer: false, supplier: true }),
]
const ref = <M extends Model>(n: number, model: M) => {
  const found = observations.find((item) => item.id === id(n))!
  return { observation_id: found.id, target_context_id: context, model, pk: found.pk }
}

const partA = id(10)
const partB = id(11)
const partC = id(12)

const specA: InventoryPartSpecDto = {
  name: 'Carbon film resistor',
  category: ref(901, 'category'),
  parameters: [
    {
      template: ref(903, 'parameter_template'),
      category_mapping: ref(905, 'category_parameter'),
      value: 'Carbon',
    },
  ],
  manufacturer: { company: ref(909, 'company'), mpn: 'CF-1' },
  supplier: { company: ref(909, 'company'), sku: 'S-1' },
  tags: ['SMD'],
}
const specB: InventoryPartSpecDto = {
  name: 'Ceramic capacitor',
  category: ref(902, 'category'),
  parameters: [
    {
      template: ref(903, 'parameter_template'),
      category_mapping: ref(907, 'category_parameter'),
      value: 'Ceramic',
    },
  ],
  manufacturer: null,
  supplier: { company: ref(909, 'company'), sku: 'S-2' },
  tags: [],
}

const lot = (n: number, part: string | null, retired = false) => ({
  id: id(100 + n),
  label: `Lot ${n}`,
  revision: '1',
  contribution_key: id(200 + n),
  part_subject_id: part,
  quantity: { mode: 'unset' as const },
  location: { mode: 'unset' as const },
  ...(retired ? { retired: true as const } : {}),
})

const batch = {
  parts: [
    { id: partA, label: 'A', revision: '1', choice: { mode: 'create', spec: specA } },
    { id: partB, label: 'B', revision: '1', choice: { mode: 'create', spec: specB } },
    { id: partC, label: 'C', revision: '1', choice: { mode: 'unset' } },
  ],
  lots: [lot(1, partA), lot(2, partA), lot(3, partB), lot(4, partA, true), lot(5, null)],
  observations,
} as unknown as CaptureSnapshotDto

const change = (
  target: RecordChangeDto['target'],
  operation: RecordChangeDto['operation'],
): RecordChangeDto => ({ kind: 'record', target, operation })

function refused(run: () => unknown, code: string, partId?: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof RecordEditError)
    assert.equal(error.code, code)
    assert.equal(error.partId, partId)
    return true
  })
}

test('record changes are part of the capture edit contract', () => {
  validate('CaptureEdit', {
    expected_revision: '3',
    change: change(
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: ref(910, 'company') },
    ),
  })
  validate('CaptureEdit', {
    expected_revision: '3',
    change: change(
      { kind: 'part', part_subject_id: partA },
      { op: 'set_description', value: null },
    ),
  })
  assert.throws(() =>
    validate('CaptureEdit', {
      expected_revision: '3',
      change: change(
        { kind: 'part', part_subject_id: partA },
        { op: 'set_description', value: 'x'.repeat(251) },
      ),
    }),
  )
  validate('InventoryPartSpec', { ...specA, description: 'Through-hole, 1/4 W' })
  assert.throws(() => validate('InventoryPartSpec', { ...specA, description: '' }))
  assert.throws(() => validate('InventoryPartSpec', { ...specA, description: ' 1/4 W' }))
  assert.throws(() => validate('InventoryPartSpec', { ...specA, description: '1/4 W\nAxial' }))
})

test('a shared company reaches every Part using it in that role, and their active lots', () => {
  const scope = recordScope(batch, { kind: 'company', role: 'supplier', pk: '12' })
  assert.deepEqual(scope, { partIds: [partA, partB], lotIds: [id(101), id(102), id(103)] })
  assert.deepEqual(recordScope(batch, { kind: 'company', role: 'manufacturer', pk: '12' }), {
    partIds: [partA],
    lotIds: [id(101), id(102)],
  })
})

test('mapping a company changes only that role on every Part using it', () => {
  const result = applyRecordChange(
    batch,
    change(
      { kind: 'company', role: 'supplier', pk: '12' },
      { op: 'map_to_existing', reference: ref(911, 'company') },
    ),
  )
  assert.deepEqual([...result.specs.keys()], [partA, partB])
  assert.equal(result.specs.get(partA)!.supplier!.company.pk, '602')
  assert.equal(result.specs.get(partA)!.supplier!.sku, 'S-1')
  assert.equal(result.specs.get(partA)!.manufacturer!.company.pk, '12')
  assert.equal(result.specs.get(partB)!.supplier!.company.pk, '602')
})

test('mapping a company to one observed without that role, or not observed, is refused', () => {
  refused(
    () =>
      applyRecordChange(
        batch,
        change(
          { kind: 'company', role: 'supplier', pk: '12' },
          { op: 'map_to_existing', reference: ref(910, 'company') },
        ),
      ),
    'company_role_incompatible',
  )
  refused(
    () =>
      applyRecordChange(
        { ...batch, observations: observations.slice(0, 10) } as CaptureSnapshotDto,
        change(
          { kind: 'company', role: 'supplier', pk: '12' },
          { op: 'map_to_existing', reference: ref(911, 'company') },
        ),
      ),
    'mapping_observation_invalid',
  )
  refused(
    () =>
      applyRecordChange(
        batch,
        change(
          { kind: 'company', role: 'supplier', pk: '601' },
          { op: 'map_to_existing', reference: ref(909, 'company') },
        ),
      ),
    'record_not_found',
  )
})

test('a template maps batch-wide with a category mapping per affected category', () => {
  const result = applyRecordChange(
    batch,
    change(
      { kind: 'parameter_template', pk: '201' },
      {
        op: 'map_template',
        template: ref(904, 'parameter_template'),
        category_mappings: [ref(906, 'category_parameter'), ref(908, 'category_parameter')],
        exclude_parts: [],
      },
    ),
  )
  assert.deepEqual(result.partIds, [partA, partB])
  assert.deepEqual(
    result.specs.get(partA)!.parameters.map((item) => [item.template.pk, item.category_mapping.pk]),
    [['202', '311']],
  )
  assert.deepEqual(
    result.specs.get(partB)!.parameters.map((item) => [item.template.pk, item.category_mapping.pk]),
    [['202', '313']],
  )
  assert.equal(result.specs.get(partB)!.parameters[0].value, 'Ceramic')
})

test('a template mapping that omits a Part’s category names that Part, unless it is excluded', () => {
  const omitting = (exclude: string[]) =>
    change(
      { kind: 'parameter_template', pk: '201' },
      {
        op: 'map_template',
        template: ref(904, 'parameter_template'),
        category_mappings: [ref(906, 'category_parameter')],
        exclude_parts: exclude,
      },
    )
  refused(() => applyRecordChange(batch, omitting([])), 'parameter_category_incompatible', partB)
  const result = applyRecordChange(batch, omitting([partB]))
  assert.deepEqual(result.partIds, [partA])
  assert.deepEqual(result.lotIds, [id(101), id(102)])
})

test('changing a category needs every parameter mapped or dropped', () => {
  const target = { kind: 'part' as const, part_subject_id: partA }
  refused(
    () =>
      applyRecordChange(
        batch,
        change(target, {
          op: 'set_category',
          reference: ref(902, 'category'),
          parameter_mappings: [],
          drop_parameters: [],
        }),
      ),
    'parameter_mapping_required',
    partA,
  )
  const mapped = applyRecordChange(
    batch,
    change(target, {
      op: 'set_category',
      reference: ref(902, 'category'),
      parameter_mappings: [
        { template_pk: '201', category_mapping: ref(907, 'category_parameter') },
      ],
      drop_parameters: [],
    }),
  )
  assert.equal(mapped.specs.get(partA)!.category.pk, '82')
  assert.equal(mapped.specs.get(partA)!.parameters[0].category_mapping.pk, '312')
  const dropped = applyRecordChange(
    batch,
    change(target, {
      op: 'set_category',
      reference: ref(902, 'category'),
      parameter_mappings: [],
      drop_parameters: ['201'],
    }),
  )
  assert.deepEqual(dropped.specs.get(partA)!.parameters, [])
  refused(
    () =>
      applyRecordChange(
        batch,
        change(target, {
          op: 'set_category',
          reference: ref(902, 'category'),
          parameter_mappings: [
            { template_pk: '201', category_mapping: ref(905, 'category_parameter') },
          ],
          drop_parameters: [],
        }),
      ),
    'parameter_category_incompatible',
    partA,
  )
})

test('a Part’s name, tags and description change on that Part alone; clearing deletes it', () => {
  const target = { kind: 'part' as const, part_subject_id: partA }
  const named = applyRecordChange(batch, change(target, { op: 'set_name', value: 'Resistor' }))
  assert.deepEqual(named.partIds, [partA])
  assert.equal(named.specs.get(partA)!.name, 'Resistor')
  const tagged = applyRecordChange(
    batch,
    change(target, { op: 'set_tags', tags: ['THT', 'Bin 4'] }),
  )
  assert.deepEqual(tagged.specs.get(partA)!.tags, ['THT', 'Bin 4'])
  const described = applyRecordChange(
    batch,
    change(target, { op: 'set_description', value: '1/4 W' }),
  )
  assert.equal(described.specs.get(partA)!.description, '1/4 W')
  const withDescription = {
    ...batch,
    parts: [
      { ...batch.parts[0], choice: { mode: 'create', spec: described.specs.get(partA)! } },
      ...batch.parts.slice(1),
    ],
  } as CaptureSnapshotDto
  const cleared = applyRecordChange(
    withDescription,
    change(target, { op: 'set_description', value: null }),
  )
  assert.equal('description' in cleared.specs.get(partA)!, false)
  assert.equal(JSON.stringify(cleared.specs.get(partA)), JSON.stringify(specA))
})

test('parameters are added, edited and removed on one Part', () => {
  const edited = applyRecordChange(
    batch,
    change(
      { kind: 'parameter', part_subject_id: partA, template_pk: '201' },
      {
        op: 'set_parameter',
        template: ref(903, 'parameter_template'),
        category_mapping: ref(905, 'category_parameter'),
        value: 'Metal film',
      },
    ),
  )
  assert.equal(edited.specs.get(partA)!.parameters[0].value, 'Metal film')
  const added = applyRecordChange(
    batch,
    change(
      { kind: 'parameter', part_subject_id: partA, template_pk: '202' },
      {
        op: 'set_parameter',
        template: ref(904, 'parameter_template'),
        category_mapping: ref(906, 'category_parameter'),
        value: 'Axial',
      },
    ),
  )
  assert.deepEqual(
    added.specs.get(partA)!.parameters.map((item) => item.template.pk),
    ['201', '202'],
  )
  const removed = applyRecordChange(
    batch,
    change(
      { kind: 'parameter', part_subject_id: partA, template_pk: '201' },
      {
        op: 'remove_parameter',
      },
    ),
  )
  assert.deepEqual(removed.specs.get(partA)!.parameters, [])
  refused(
    () =>
      applyRecordChange(
        batch,
        change(
          { kind: 'parameter', part_subject_id: partA, template_pk: '202' },
          {
            op: 'remove_parameter',
          },
        ),
      ),
    'record_not_found',
  )
})

test('manufacturer and supplier parts change once on their Part', () => {
  const sku = applyRecordChange(
    batch,
    change(
      { kind: 'supplier_part', part_subject_id: partA },
      { op: 'set_sku', company: ref(909, 'company'), sku: 'S-9' },
    ),
  )
  assert.deepEqual(sku.partIds, [partA])
  assert.deepEqual(sku.lotIds, [id(101), id(102)])
  assert.equal(sku.specs.get(partA)!.supplier!.sku, 'S-9')
  const mpn = applyRecordChange(
    batch,
    change(
      { kind: 'manufacturer_part', part_subject_id: partB },
      { op: 'set_mpn', company: ref(910, 'company'), mpn: 'CC-0805' },
    ),
  )
  assert.deepEqual(mpn.specs.get(partB)!.manufacturer, {
    company: ref(910, 'company'),
    mpn: 'CC-0805',
  })
})

test('a Part with no spec, an unknown Part and a mismatched operation are refused', () => {
  refused(
    () =>
      applyRecordChange(
        batch,
        change({ kind: 'part', part_subject_id: partC }, { op: 'set_name', value: 'X' }),
      ),
    'record_part_has_no_spec',
    partC,
  )
  refused(
    () =>
      applyRecordChange(
        batch,
        change({ kind: 'part', part_subject_id: id(99) }, { op: 'set_name', value: 'X' }),
      ),
    'record_not_found',
  )
  refused(
    () =>
      applyRecordChange(
        batch,
        change({ kind: 'part', part_subject_id: partA }, { op: 'remove_parameter' }),
      ),
    'record_operation_invalid',
  )
})

test('a template already on a Part is refused as a duplicate, and a parameter keeps its template', () => {
  const both = {
    ...batch,
    parts: [
      {
        ...batch.parts[0],
        choice: {
          mode: 'create',
          spec: {
            ...specA,
            parameters: [
              ...specA.parameters,
              {
                template: ref(904, 'parameter_template'),
                category_mapping: ref(906, 'category_parameter'),
                value: 'Axial',
              },
            ],
          },
        },
      },
      ...batch.parts.slice(1),
    ],
  } as CaptureSnapshotDto
  refused(
    () =>
      applyRecordChange(
        both,
        change(
          { kind: 'parameter_template', pk: '201' },
          {
            op: 'map_template',
            template: ref(904, 'parameter_template'),
            category_mappings: [ref(906, 'category_parameter'), ref(908, 'category_parameter')],
            exclude_parts: [],
          },
        ),
      ),
    'duplicate_parameter_mapping',
    partA,
  )
  refused(
    () =>
      applyRecordChange(
        batch,
        change(
          { kind: 'parameter', part_subject_id: partA, template_pk: '201' },
          {
            op: 'set_parameter',
            template: ref(904, 'parameter_template'),
            category_mapping: ref(906, 'category_parameter'),
            value: 'Axial',
          },
        ),
      ),
    'record_operation_invalid',
  )
})
