import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  projectRecords,
  validate,
  type BatchRecordDto,
  type CaptureSnapshotDto,
  type InventoryPartSpecDto,
  type ProcessingSnapshotDto,
} from '../src/index.ts'

const context = '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03'
const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`

type Model =
  'category' | 'parameter_template' | 'category_parameter' | 'company' | 'part' | 'location'
const observation = (n: number, model: Model, pk: string, label: string, mapping?: object) => ({
  id: id(n),
  model,
  pk,
  ...(mapping ? { mapping } : {}),
  target_context_id: context,
  label,
  observed_at: '2026-11-06T00:00:00.000Z',
})
const observations = [
  observation(901, 'category', '81', 'Resistors', { kind: 'category' }),
  observation(903, 'parameter_template', '201', 'Resistance', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: true,
  }),
  observation(905, 'category_parameter', '301', 'Resistors · Resistance', {
    kind: 'category_parameter',
    category_id: '81',
    template_id: '201',
  }),
  observation(909, 'company', '12', 'Yageo', {
    kind: 'company',
    manufacturer: true,
    supplier: true,
  }),
  observation(912, 'part', '29', 'Existing Part 29'),
  observation(913, 'location', '43', 'Bin 43'),
]
const ref = <M extends Model>(n: number, model: M) => {
  const found = observations.find((item) => item.id === id(n))!
  return { observation_id: found.id, target_context_id: context, model, pk: found.pk }
}

const partA = id(10)
const partB = id(11)
const partC = id(12)
const partD = id(13)

const specA: InventoryPartSpecDto = {
  name: 'Carbon film resistor',
  category: ref(901, 'category'),
  parameters: [
    {
      template: ref(903, 'parameter_template'),
      category_mapping: ref(905, 'category_parameter'),
      value: '4.7 kΩ',
    },
  ],
  manufacturer: { company: ref(909, 'company'), mpn: 'CF-47' },
  supplier: { company: ref(909, 'company'), sku: 'S-47' },
  tags: ['SMD'],
}
const specB: InventoryPartSpecDto = {
  name: 'Metal film resistor',
  category: ref(901, 'category'),
  parameters: [],
  manufacturer: null,
  supplier: { company: ref(909, 'company'), sku: 'S-10' },
  tags: ['SMD', 'Bin 4'],
}

const lot = (
  n: number,
  part: string | null,
  location: CaptureSnapshotDto['lots'][number]['location'],
  retired = false,
) => ({
  id: id(100 + n),
  label: `Lot ${n}`,
  revision: '1',
  contribution_key: id(200 + n),
  part_subject_id: part,
  quantity: { mode: 'set' as const, value: String(n) },
  location,
  ...(retired ? { retired: true as const } : {}),
})
const inBin = { mode: 'set' as const, value: ref(913, 'location') }
const inherit = { mode: 'inherit' as const }

const capture = {
  id: id(1),
  revision: '7',
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  parts: [
    { id: partA, label: 'A', revision: '1', choice: { mode: 'create', spec: specA } },
    { id: partB, label: 'B', revision: '1', choice: { mode: 'create', spec: specB } },
    { id: partC, label: 'Unknown resistor', revision: '1', choice: { mode: 'unset' } },
    {
      id: partD,
      label: 'Stocked part',
      revision: '1',
      choice: { mode: 'set', value: ref(912, 'part') },
    },
  ],
  lots: [
    lot(1, partA, inBin),
    lot(2, partA, inherit),
    lot(3, partB, inBin),
    lot(4, partC, inBin),
    lot(5, partD, inBin),
    lot(6, partA, inBin, true),
  ],
  observations,
} as unknown as CaptureSnapshotDto

const proposal = (n: number, value: object) => ({ id: id(n), message_id: id(n + 1), value })
const processing = {
  jobs: [
    {
      id: id(700),
      subject_id: partA,
      stage: 'research',
      proposals: [
        proposal(710, {
          schema_version: 'bench-intake-proposal/5',
          subject_id: partA,
          summary: 'Yageo carbon film resistor.',
          sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
          tags: ['SMD'],
          relies_on: {
            fields: ['research'],
            sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
          },
          catalogue: {
            category: { choice: 'existing', reference: ref(901, 'category'), sources: [] },
            parameters: [],
            manufacturer: {
              company: { choice: 'existing', reference: ref(909, 'company'), sources: [] },
              mpn: 'CF-47',
              sources: [],
            },
            supplier: null,
            description: null,
          },
        }),
      ],
      questions: [],
    },
  ],
} as unknown as ProcessingSnapshotDto

const of = (records: BatchRecordDto[], type: BatchRecordDto['type']) =>
  records.filter((record) => record.type === type)

test('records come from capture state and validate against the contract', () => {
  const result = projectRecords({ capture, processing: undefined, lotGroups: null })
  validate('BatchRecords', result)
  assert.equal(result.batch_id, id(1))
  assert.equal(result.revision, '7')

  assert.deepEqual(
    of(result.records, 'part').map((record) => [record.label, record.state, record.lot_ids]),
    [
      ['Carbon film resistor', 'new', [id(101), id(102)]],
      ['Metal film resistor', 'new', [id(103)]],
      ['Unknown resistor', 'choose', [id(104)]],
      ['Existing Part 29', 'exists', [id(105)]],
    ],
  )
  const undecided = of(result.records, 'part')[2]
  assert.equal(undecided.decision?.code, 'part_choice_required')
  assert.equal(undecided.target, null)

  const [category] = of(result.records, 'category')
  assert.equal(category.state, 'exists')
  assert.equal(category.label, 'Resistors')
  assert.deepEqual(category.part_ids, [partA, partB])

  assert.deepEqual(
    of(result.records, 'company').map((record) => [record.key, record.state, record.part_ids]),
    [
      ['company:manufacturer:12', 'exists', [partA]],
      ['company:supplier:12', 'exists', [partA, partB]],
    ],
  )
  assert.deepEqual(of(result.records, 'company')[1].target, {
    kind: 'company',
    role: 'supplier',
    pk: '12',
  })
  assert.deepEqual(
    of(result.records, 'supplier_part').map((record) => record.fields.map((f) => f.value)),
    [
      ['Yageo', 'S-47'],
      ['Yageo', 'S-10'],
    ],
  )
  assert.deepEqual(
    of(result.records, 'parameter').map((record) => [record.label, record.target]),
    [['Resistance: 4.7 kΩ', { kind: 'parameter', part_subject_id: partA, template_pk: '201' }]],
  )
  assert.deepEqual(
    of(result.records, 'tag').map((record) => [record.label, record.part_ids]),
    [
      ['Bin 4', [partB]],
      ['SMD', [partA, partB]],
    ],
  )
})

test('before structured proposals exist nothing is proposed new or unsupported', () => {
  const result = projectRecords({ capture, processing: undefined, lotGroups: null })
  assert.ok(result.records.every((record) => record.state !== 'unsupported'))
  assert.ok(
    result.records.every((record) =>
      record.fields.every((field) => field.origin.kind === 'operator'),
    ),
  )
})

test('stock items and locations follow active lots; a lot with no location needs a decision', () => {
  const result = projectRecords({ capture, processing: undefined, lotGroups: null })
  assert.deepEqual(
    of(result.records, 'stock_item').map((record) => record.label),
    ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4', 'Lot 5'],
  )
  assert.deepEqual(
    of(result.records, 'location').map((record) => [record.label, record.state, record.lot_ids]),
    [
      ['Bin 43', 'exists', [id(101), id(103), id(104), id(105)]],
      ['No location', 'choose', [id(102)]],
    ],
  )
  assert.equal(of(result.records, 'location')[1].decision?.code, 'location_required')
})

test('an excluded lot has no records; a Part only it used is left out too', () => {
  const excluded = {
    ...capture,
    lots: capture.lots.map((item) =>
      item.id === id(103) || item.id === id(102)
        ? { ...item, excluded: { reason: 'Damaged', at: '2026-11-08T05:00:00.000Z' } }
        : item,
    ),
  } as CaptureSnapshotDto
  const result = projectRecords({ capture: excluded, processing: undefined, lotGroups: null })
  assert.deepEqual(
    of(result.records, 'stock_item').map((record) => record.label),
    ['Lot 1', 'Lot 4', 'Lot 5'],
  )
  // Part B's only lot is excluded; Part A keeps Lot 1 alone.
  const partLots = of(result.records, 'part').map((record) => record.lot_ids)
  assert.equal(
    partLots.some((lots) => lots.includes(id(103))),
    false,
  )
  assert.ok(partLots.some((lots) => lots.length === 1 && lots[0] === id(101)))
})

test('a lot taking a new default location draft is placed under that draft, not a decision', () => {
  const draftId = id(950)
  const withDraft = {
    ...capture,
    settings_intent: { default_location_draft: draftId },
    reference_drafts: [
      {
        draft_id: draftId,
        kind: 'location',
        value: { name: 'Shelf B', description: '', parent: null },
      },
    ],
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: withDraft, processing: undefined, lotGroups: null })
  assert.deepEqual(
    of(result.records, 'location').map((record) => [record.label, record.state, record.lot_ids]),
    [
      ['Bin 43', 'exists', [id(101), id(103), id(104), id(105)]],
      ['Shelf B', 'new', [id(102)]],
    ],
  )
  assert.deepEqual(
    result.counts.find((item) => item.type === 'location'),
    { type: 'location', new: 1, existing: 1, decide: 0 },
  )
})

test('a new default location whose parent is no longer observed needs a decision', () => {
  const draftId = id(950)
  const withDraft = {
    ...capture,
    settings_intent: { default_location_draft: draftId },
    reference_drafts: [
      {
        draft_id: draftId,
        kind: 'location',
        value: {
          name: 'Shelf B',
          description: '',
          parent: {
            observation_id: id(999),
            target_context_id: context,
            model: 'location',
            pk: '44',
          },
        },
      },
    ],
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: withDraft, processing: undefined, lotGroups: null })
  const draft = of(result.records, 'location').find((record) => record.label === 'Shelf B')
  assert.equal(draft?.state, 'choose')
  assert.equal(draft?.decision?.code, 'location_draft_parent_invalid')
  assert.deepEqual(
    result.counts.find((item) => item.type === 'location'),
    { type: 'location', new: 0, existing: 1, decide: 1 },
  )
})

test('a stock item with no exact quantity needs a decision', () => {
  const unsetQuantity = {
    ...capture,
    lots: capture.lots.map((item) =>
      item.id === id(102) ? { ...item, quantity: { mode: 'inherit' } } : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: unsetQuantity, processing: undefined, lotGroups: null })
  const item = of(result.records, 'stock_item').find((record) => record.label === 'Lot 2')
  assert.equal(item?.state, 'choose')
  assert.equal(item?.decision?.code, 'quantity_required')
  assert.equal(of(result.records, 'stock_item')[0].state, 'new')
})

test('a lot with no Part needs one, ahead of its quantity', () => {
  const noPart = {
    ...capture,
    lots: capture.lots.map((item) =>
      item.id === id(102) ? { ...item, part_subject_id: null, quantity: { mode: 'unset' } } : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: noPart, processing: undefined, lotGroups: null })
  const item = of(result.records, 'stock_item').find((record) => record.label === 'Lot 2')
  assert.equal(item?.state, 'choose')
  assert.equal(item?.decision?.code, 'part_choice_required')
})

test('locations waiting on evidence groups are a decision with a reason', () => {
  const grouped = {
    ...capture,
    group_locations: [{ group_id: id(960), version: '1', location: inBin }],
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: grouped, processing: undefined, lotGroups: null })
  const waiting = of(result.records, 'location').find(
    (record) => record.key === 'location:unavailable',
  )
  assert.equal(waiting?.state, 'choose')
  assert.equal(waiting?.decision?.code, 'location_groups_unavailable')
})

test('an AI lot taking the batch quantity shows its estimate and needs it accepted', () => {
  const estimated = {
    ...capture,
    defaults: { quantity: { mode: 'set', value: '10' }, location: { mode: 'unset' } },
    lots: capture.lots.map((item) =>
      item.id === id(102)
        ? { ...item, quantity: { mode: 'inherit' }, origin: 'agent', estimated_quantity: '12' }
        : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: estimated, processing: undefined, lotGroups: null })
  const item = of(result.records, 'stock_item').find((record) => record.label === 'Lot 2')
  assert.equal(item?.state, 'choose')
  assert.equal(item?.decision?.code, 'quantity_required')
  assert.deepEqual(item?.fields, [
    { name: 'quantity', value: '12', origin: { kind: 'estimate', step: 'examine' } },
  ])
  validate('BatchRecords', result)
})

test('an AI lot with no estimate asks for an exact quantity, not to accept one', () => {
  const unestimated = {
    ...capture,
    defaults: { quantity: { mode: 'set', value: '10' }, location: { mode: 'unset' } },
    lots: capture.lots.map((item) =>
      item.id === id(102) ? { ...item, quantity: { mode: 'inherit' }, origin: 'agent' } : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: unestimated, processing: undefined, lotGroups: null })
  const item = of(result.records, 'stock_item').find((record) => record.label === 'Lot 2')
  assert.equal(item?.decision?.detail, 'Set an exact quantity for this lot.')
  assert.deepEqual(item?.fields, [{ name: 'quantity', value: null, origin: { kind: 'operator' } }])
})

test('a lot whose Part is missing names no Part', () => {
  const missing = {
    ...capture,
    lots: capture.lots.map((item) =>
      item.id === id(102) ? { ...item, part_subject_id: id(99) } : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({ capture: missing, processing: undefined, lotGroups: null })
  const item = of(result.records, 'stock_item').find((record) => record.label === 'Lot 2')
  assert.equal(item?.decision?.code, 'part_choice_required')
  assert.deepEqual(item?.part_ids, [])
})

test('each type counts new, existing and to-decide records', () => {
  const result = projectRecords({ capture, processing: undefined, lotGroups: null })
  assert.deepEqual(
    result.counts.find((item) => item.type === 'part'),
    { type: 'part', new: 2, existing: 1, decide: 1 },
  )
  assert.deepEqual(
    result.counts.find((item) => item.type === 'location'),
    { type: 'location', new: 0, existing: 1, decide: 1 },
  )
})

test('a field still matching the latest proposal shows the step that proposed it', () => {
  const result = projectRecords({ capture, processing, lotGroups: null })
  const part = of(result.records, 'part')[0]
  const origin = (name: string) => part.fields.find((field) => field.name === name)?.origin
  assert.deepEqual(origin('category'), { kind: 'step', step: 'research', proposal_id: id(710) })
  assert.deepEqual(origin('tags'), { kind: 'step', step: 'research', proposal_id: id(710) })
  assert.deepEqual(origin('name'), { kind: 'operator' })
  const manufacturer = of(result.records, 'manufacturer_part')[0]
  assert.deepEqual(
    manufacturer.fields.map((field) => [field.name, field.origin.kind]),
    [
      ['company', 'step'],
      ['mpn', 'step'],
    ],
  )
  // Part B's tags were never proposed.
  const partBRecord = of(result.records, 'part')[1]
  assert.deepEqual(partBRecord.fields.find((field) => field.name === 'tags')?.origin, {
    kind: 'operator',
  })
})

test('long names, codes and values still give labels within the contract', () => {
  const long = 'x'.repeat(256)
  const spec = {
    ...specA,
    name: long,
    manufacturer: { company: ref(909, 'company'), mpn: long },
    supplier: { company: ref(909, 'company'), sku: long },
    parameters: [{ ...specA.parameters[0], value: long }],
  }
  const result = projectRecords({
    capture: {
      ...capture,
      parts: [{ ...capture.parts[0], choice: { mode: 'create', spec } }],
    } as CaptureSnapshotDto,
    processing: undefined,
    lotGroups: null,
  })
  validate('BatchRecords', result)
  assert.ok(result.records.every((record) => record.label.length <= 256))
})

test('a Part whose choice was cleared needs a decision', () => {
  const result = projectRecords({
    capture: {
      ...capture,
      parts: [{ ...capture.parts[2], choice: { mode: 'clear' } }],
    } as CaptureSnapshotDto,
    processing: undefined,
    lotGroups: null,
  })
  assert.equal(result.records.find((record) => record.type === 'part')?.state, 'choose')
})

test('a field shows the step of any proposal it still matches, whatever their order', () => {
  const later = {
    ...processing.jobs[0],
    proposals: [
      processing.jobs[0].proposals[0],
      proposal(720, {
        schema_version: 'bench-intake-proposal/4',
        subject_id: partA,
        summary: 'Earlier tags only.',
        sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
        tags: ['THT'],
      }),
    ],
  }
  const result = projectRecords({
    capture,
    processing: { ...processing, jobs: [later] } as ProcessingSnapshotDto,
    lotGroups: null,
  })
  const part = of(result.records, 'part')[0]
  assert.equal(part.fields.find((field) => field.name === 'tags')?.origin.kind, 'step')
  assert.equal(part.fields.find((field) => field.name === 'category')?.origin.kind, 'step')
})

test('a batch at the subject limit with every Part full stays within the contract', () => {
  const parameter = specA.parameters[0]
  // Every Part has its own category, companies, templates and tags, so nothing is shared.
  const parts = Array.from({ length: 100 }, (_, n) => ({
    id: id(3000 + n),
    label: `P${n}`,
    revision: '1',
    choice: {
      mode: 'create',
      spec: {
        ...specA,
        name: `Part ${n}`,
        category: { ...specA.category, pk: String(500 + n) },
        manufacturer: { company: { ...ref(909, 'company'), pk: String(2000 + n) }, mpn: 'M' },
        supplier: { company: { ...ref(909, 'company'), pk: String(3000 + n) }, sku: 'S' },
        parameters: Array.from({ length: 32 }, (_, k) => ({
          ...parameter,
          template: { ...parameter.template, pk: String(10000 + n * 32 + k) },
        })),
        tags: Array.from({ length: 32 }, (_, k) => `Tag ${n}-${k}`),
      },
    },
  }))
  const result = projectRecords({
    capture: { ...capture, parts, lots: [] } as unknown as CaptureSnapshotDto,
    processing: undefined,
    lotGroups: null,
  })
  assert.equal(result.records.length, 10200)
  validate('BatchRecords', result)
})

test('a stock item that takes the batch quantity shows it', () => {
  const result = projectRecords({
    capture: {
      ...capture,
      defaults: { quantity: { mode: 'set', value: '10' }, location: { mode: 'unset' } },
      lots: [{ ...capture.lots[0], quantity: { mode: 'inherit' } }],
    } as unknown as CaptureSnapshotDto,
    processing: undefined,
    lotGroups: null,
  })
  const stock = result.records.find((record) => record.type === 'stock_item')!
  assert.equal(stock.fields.find((field) => field.name === 'quantity')?.value, '10')
})

test('a Part’s field also shows the step when a proposal about one of its lots matches', () => {
  const lotProposal = {
    ...processing.jobs[0],
    subject_id: id(101),
    stage: 'identifying',
    proposals: [
      proposal(730, {
        schema_version: 'bench-intake-proposal/4',
        subject_id: id(103),
        summary: 'Lot 3 looks like an SMD part in bin 4.',
        sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
        tags: ['SMD', 'Bin 4'],
      }),
    ],
  }
  const result = projectRecords({
    capture,
    processing: { ...processing, jobs: [lotProposal] } as ProcessingSnapshotDto,
    lotGroups: null,
  })
  // Lot 3 belongs to Part B, whose tags are exactly the proposed ones.
  const partB = of(result.records, 'part')[1]
  assert.deepEqual(partB.fields.find((field) => field.name === 'tags')?.origin, {
    kind: 'step',
    step: 'examine',
    proposal_id: id(730),
  })
})

const proposedNew = (name: string, reason: string) => ({
  choice: 'proposed_new',
  name,
  reason,
  sources: [],
})

function catalogueJob(subject: string, catalogue: object, extra: object = {}) {
  return {
    jobs: [
      {
        id: id(720),
        subject_id: subject,
        stage: 'research',
        state: 'ready',
        ...extra,
        proposals: [
          proposal(730, {
            schema_version: 'bench-intake-proposal/5',
            subject_id: subject,
            summary: 'Thin-film resistor.',
            sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
            relies_on: {
              fields: ['research'],
              sources: [{ kind: 'note', note_id: id(800), text_sha256: 'a'.repeat(64) }],
            },
            catalogue: {
              category: null,
              parameters: [],
              manufacturer: null,
              supplier: null,
              description: null,
              ...catalogue,
            },
          }),
        ],
        questions: [],
      },
    ],
  } as unknown as ProcessingSnapshotDto
}

const withGct = {
  ...capture,
  observations: [
    ...capture.observations,
    observation(920, 'company', '31', 'Global Connector Technology', {
      kind: 'company',
      manufacturer: true,
      supplier: false,
    }),
  ],
} as unknown as CaptureSnapshotDto

test('a proposed new manufacturer is a decision, with a likely existing match by initials', () => {
  const result = projectRecords({
    capture: withGct,
    processing: catalogueJob(partB, {
      manufacturer: {
        company: proposedNew('GCT', 'The reel label reads GCT'),
        mpn: 'R-10',
        sources: [],
      },
    }),
    lotGroups: null,
  })
  validate('BatchRecords', result)
  const gct = of(result.records, 'company').find((record) => record.proposed?.name === 'GCT')
  assert.equal(gct?.key, `company:proposed:manufacturer:${partB}`)
  assert.equal(gct?.state, 'choose')
  assert.equal(gct?.decision?.code, 'company_proposed_new')
  assert.deepEqual(gct?.part_ids, [partB])
  assert.deepEqual(gct?.proposed, {
    role: 'manufacturer',
    name: 'GCT',
    reason: 'The reel label reads GCT',
    number: 'R-10',
    likely: {
      reference: {
        observation_id: id(920),
        target_context_id: context,
        model: 'company',
        pk: '31',
      },
      label: 'Global Connector Technology',
      why: 'Its initials are GCT',
    },
  })
  assert.equal(result.counts.find((count) => count.type === 'company')?.decide, 1)
})

test('a proposed new company has no likely match without a rule that finds one', () => {
  const result = projectRecords({
    capture: withGct,
    processing: catalogueJob(partB, {
      manufacturer: {
        company: proposedNew('Acme Reels', 'Printed on the box'),
        mpn: 'A-1',
        sources: [],
      },
    }),
    lotGroups: null,
  })
  assert.equal(
    of(result.records, 'company').find((record) => record.proposed?.name === 'Acme Reels')?.proposed
      ?.likely,
    null,
  )
})

test('a role the Part already has is not asked about again', () => {
  const result = projectRecords({
    capture: withGct,
    processing: catalogueJob(partA, {
      manufacturer: {
        company: proposedNew('GCT', 'The reel label reads GCT'),
        mpn: 'R-10',
        sources: [],
      },
    }),
    lotGroups: null,
  })
  assert.equal(
    of(result.records, 'company').some((record) => record.proposed?.name === 'GCT'),
    false,
  )
})

test('values the executor cannot create are listed on the Part as not supported yet, with the reason', () => {
  const result = projectRecords({
    capture,
    processing: catalogueJob(partB, {
      category: proposedNew('Thin-film resistors', 'The packet says thin film'),
      parameters: [
        { name: 'Tolerance', value: '1%', template: null, category_mapping: null, sources: [] },
        {
          name: 'Resistance',
          value: '10 kΩ',
          template: ref(903, 'parameter_template'),
          category_mapping: null,
          sources: [],
        },
      ],
      supplier: {
        company: { choice: 'existing', reference: ref(909, 'company'), sources: [] },
        sku: 'S-10',
        price: { amount: '0.10', currency: 'USD' },
        sources: [],
      },
    }),
    lotGroups: null,
  })
  validate('BatchRecords', result)
  const part = of(result.records, 'part').find((record) => record.key === `part:${partB}`)
  assert.deepEqual(part?.unsupported, [
    {
      field: 'category',
      value: 'Thin-film resistors',
      why: 'Creating a category is not supported yet; choose an existing category.',
      reason: 'The packet says thin film',
    },
    {
      field: 'parameter',
      value: 'Tolerance: 1%',
      why: 'Creating a parameter template is not supported yet.',
      reason: null,
    },
    {
      field: 'parameter',
      value: 'Resistance: 10 kΩ',
      why: "Mapping this parameter template to the Part's category is not supported yet.",
      reason: null,
    },
    {
      field: 'supplier',
      value: '0.10 USD',
      why: 'Supplier prices are not supported yet.',
      reason: null,
    },
  ])
  assert.equal(
    of(result.records, 'part').find((record) => record.key === `part:${partA}`)?.unsupported,
    undefined,
  )
})

test('every value the shared assessment cannot apply is listed, never dropped', () => {
  const long = 'x'.repeat(251)
  const result = projectRecords({
    capture: withGct,
    processing: catalogueJob(partD, {
      category: proposedNew('Thin-film resistors', 'The packet says thin film'),
      parameters: [
        {
          name: 'Resistance',
          value: '10 kΩ',
          template: ref(903, 'parameter_template'),
          category_mapping: ref(905, 'category_parameter'),
          sources: [],
        },
      ],
      manufacturer: {
        company: proposedNew('GCT', 'The reel label reads GCT'),
        mpn: 'R-10',
        sources: [],
      },
      supplier: {
        company: { choice: 'existing', reference: ref(909, 'company'), sources: [] },
        sku: null,
        price: null,
        sources: [],
      },
      description: { text: long, sources: [] },
    }),
    lotGroups: null,
  })
  validate('BatchRecords', result)
  // Part D is matched in InvenTree, so the new manufacturer is listed rather than decided.
  assert.equal(
    of(result.records, 'company').some((record) => record.proposed?.name === 'GCT'),
    false,
  )
  const part = of(result.records, 'part').find((record) => record.key === `part:${partD}`)
  assert.deepEqual(
    part?.unsupported?.map((item) => [item.field, item.value, item.why, item.reason]),
    [
      [
        'category',
        'Thin-film resistors',
        'Creating a category is not supported yet; choose an existing category.',
        'The packet says thin film',
      ],
      ['parameter', 'Resistance: 10 kΩ', 'This parameter waits for an existing category.', null],
      [
        'manufacturer',
        'GCT · R-10',
        'Creating a manufacturer is not supported yet.',
        'The reel label reads GCT',
      ],
      ['supplier', 'Yageo', 'A supplier part needs a SKU.', null],
      ['description', long, 'A description must be one line of at most 250 characters.', null],
    ],
  )
})

const twoParts = (first: object, second: object) =>
  ({
    jobs: [
      ...catalogueJob(partB, first).jobs,
      { ...catalogueJob(partC, second).jobs[0], id: id(721) },
    ],
  }) as unknown as ProcessingSnapshotDto

test('each Part proposing the same new company gets its own decision with its own number', () => {
  const withC = {
    ...withGct,
    parts: withGct.parts.map((item) =>
      item.id === partC ? { ...item, choice: { mode: 'create', spec: specB } } : item,
    ),
  } as unknown as CaptureSnapshotDto
  const result = projectRecords({
    capture: withC,
    processing: twoParts(
      { manufacturer: { company: proposedNew('GCT', 'Label'), mpn: 'USB4105', sources: [] } },
      { manufacturer: { company: proposedNew('GCT', 'Label'), mpn: 'USB4085', sources: [] } },
    ),
    lotGroups: null,
  })
  const gct = of(result.records, 'company').filter((record) => record.proposed?.name === 'GCT')
  assert.deepEqual(
    gct.map((record) => [record.label, record.part_ids, record.proposed?.number]),
    [
      ['GCT for Metal film resistor', [partB], 'USB4105'],
      ['GCT for Metal film resistor', [partC], 'USB4085'],
    ],
  )
})

test('a Part already matched in InvenTree, or still unset, gets no company decision', () => {
  for (const subject of [partD, partC]) {
    const result = projectRecords({
      capture: withGct,
      processing: catalogueJob(subject, {
        manufacturer: { company: proposedNew('GCT', 'Label'), mpn: 'R-1', sources: [] },
      }),
      lotGroups: null,
    })
    assert.equal(
      of(result.records, 'company').some((record) => record.proposed?.name === 'GCT'),
      false,
    )
  }
})

test('names keep their identity in any script, and an empty match is no match', () => {
  const capture = {
    ...withGct,
    observations: [
      ...withGct.observations,
      observation(921, 'company', '41', '村田製作所', {
        kind: 'company',
        manufacturer: true,
        supplier: false,
      }),
      observation(922, 'company', '42', 'Radiall', {
        kind: 'company',
        manufacturer: true,
        supplier: false,
      }),
      observation(923, 'company', '43', 'Murata Manufacturing', {
        kind: 'company',
        manufacturer: true,
        supplier: false,
      }),
    ],
  } as unknown as CaptureSnapshotDto
  const likely = (name: string) =>
    of(
      projectRecords({
        capture,
        processing: catalogueJob(partB, {
          manufacturer: { company: proposedNew(name, 'Label'), mpn: 'R-1', sources: [] },
        }),
        lotGroups: null,
      }).records,
      'company',
    ).find((record) => record.proposed)?.proposed?.likely?.label ?? null
  assert.equal(likely('村田製作所'), '村田製作所')
  assert.equal(likely('東芝'), null)
  assert.equal(likely('ADI'), null)
  assert.equal(likely('Murata'), 'Murata Manufacturing')
})

test('a current proposal wins over a superseded one', () => {
  const result = projectRecords({
    capture: withGct,
    processing: {
      jobs: [
        ...catalogueJob(
          partB,
          {
            manufacturer: {
              company: proposedNew('Old Co', 'Earlier guess'),
              mpn: 'R-1',
              sources: [],
            },
          },
          { state: 'superseded' },
        ).jobs,
        {
          ...catalogueJob(partB, {
            manufacturer: { company: proposedNew('GCT', 'Label'), mpn: 'R-2', sources: [] },
          }).jobs[0],
          id: id(722),
        },
      ],
    } as unknown as ProcessingSnapshotDto,
    lotGroups: null,
  })
  assert.deepEqual(
    of(result.records, 'company')
      .filter((record) => record.proposed)
      .map((record) => record.proposed?.name),
    ['GCT'],
  )
})

test('a superseded catalogue no longer counts once a current job has proposed', () => {
  const result = projectRecords({
    capture: withGct,
    processing: {
      jobs: [
        ...catalogueJob(
          partB,
          {
            manufacturer: {
              company: proposedNew('Old Co', 'Earlier guess'),
              mpn: 'R-1',
              sources: [],
            },
          },
          { state: 'superseded' },
        ).jobs,
        {
          ...catalogueJob(partB, {}).jobs[0],
          id: id(723),
          proposals: [
            {
              id: id(740),
              message_id: id(741),
              value: {
                schema_version: 'bench-intake-proposal/4',
                subject_id: partB,
                summary: 'Identity only.',
              },
            },
          ],
        },
      ],
    } as unknown as ProcessingSnapshotDto,
    lotGroups: null,
  })
  assert.equal(
    of(result.records, 'company').some((record) => record.proposed),
    false,
  )
})

test('a stale catalogue gives way to the current one from the same job', () => {
  const stale = catalogueJob(partB, {
    manufacturer: {
      company: proposedNew('GCT', 'The reel label reads GCT'),
      mpn: 'R-10',
      sources: [],
    },
  })
  const job = stale.jobs[0]
  const [first] = job.proposals
  const revised = {
    ...first,
    id: id(731),
    message_id: id(732),
    value: {
      ...first.value,
      catalogue: {
        category: null,
        parameters: [],
        manufacturer: null,
        supplier: null,
        description: null,
      },
    },
    currentness: { state: 'current' },
  }
  const processing = {
    jobs: [
      {
        ...job,
        proposals: [
          { ...first, currentness: { state: 'stale', reason: 'operator_correction' } },
          revised,
        ],
      },
    ],
  } as unknown as ProcessingSnapshotDto
  const result = projectRecords({ capture: withGct, processing, lotGroups: null })
  assert.equal(
    of(result.records, 'company').some((record) => record.proposed?.name === 'GCT'),
    false,
  )
})

test('a field credited to a proposal says what kind of source it came from and how well it agrees', () => {
  const said = structuredClone(processing) as unknown as {
    jobs: { proposals: { value: { catalogue: Record<string, Record<string, unknown>> } }[] }[]
  }
  const catalogue = said.jobs[0].proposals[0].value.catalogue
  Object.assign(catalogue.category, { source_kind: 'label', agreement: 'read' })
  Object.assign(catalogue.manufacturer, { source_kind: 'distributor_page', agreement: 'disagree' })
  const result = projectRecords({
    capture,
    processing: said as unknown as ProcessingSnapshotDto,
    lotGroups: null,
  })
  validate('BatchRecords', result)
  const part = of(result.records, 'part')[0]
  assert.deepEqual(part.fields.find((field) => field.name === 'category')?.origin, {
    kind: 'step',
    step: 'research',
    proposal_id: id(710),
    source_kind: 'label',
    agreement: 'read',
  })
  // Tags were not given a kind, so their origin names the step alone.
  assert.deepEqual(part.fields.find((field) => field.name === 'tags')?.origin, {
    kind: 'step',
    step: 'research',
    proposal_id: id(710),
  })
  const manufacturer = of(result.records, 'manufacturer_part')[0]
  assert.deepEqual(
    manufacturer.fields.map((field) => field.origin),
    [
      {
        kind: 'step',
        step: 'research',
        proposal_id: id(710),
        source_kind: 'distributor_page',
        agreement: 'disagree',
      },
      {
        kind: 'step',
        step: 'research',
        proposal_id: id(710),
        source_kind: 'distributor_page',
        agreement: 'disagree',
      },
    ],
  )
})
