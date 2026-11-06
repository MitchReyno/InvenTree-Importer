import { act, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import type {
  BatchRecordDto,
  BatchRecordsDto,
  CaptureSnapshotDto,
  InventoryPartSpecDto,
} from '@invimport/contracts'
import { applyRecordChange, type CaptureEditDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../../../test/render'
import { RecordsStage } from './RecordsStage'
import type { ProcessingClient } from '../../../processing/types'
import { CompanyDecision } from './CompanyDecision'

const context = '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03'

const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`

type Model = 'category' | 'parameter_template' | 'category_parameter' | 'company'

const observation = (n: number, model: Model, pk: string, label: string, mapping: object) => ({
  id: id(n),
  model,
  pk,
  mapping,
  target_context_id: context,
  label,
  observed_at: '2026-11-06T00:00:00.000Z',
})

const observations = [
  observation(901, 'category', '81', 'Resistors', { kind: 'category' }),
  observation(902, 'category', '82', 'Capacitors', { kind: 'category' }),
  observation(903, 'parameter_template', '201', 'Composition', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: true,
  }),
  observation(904, 'parameter_template', '202', 'Resistor type', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: true,
  }),
  observation(905, 'category_parameter', '301', 'Resistors · Composition', {
    kind: 'category_parameter',
    category_id: '81',
    template_id: '201',
  }),
  observation(906, 'category_parameter', '311', 'Resistors · Resistor type', {
    kind: 'category_parameter',
    category_id: '81',
    template_id: '202',
  }),
  observation(907, 'category_parameter', '312', 'Capacitors · Composition', {
    kind: 'category_parameter',
    category_id: '82',
    template_id: '201',
  }),
  observation(908, 'category_parameter', '313', 'Capacitors · Resistor type', {
    kind: 'category_parameter',
    category_id: '82',
    template_id: '202',
  }),
  observation(915, 'parameter_template', '209', 'Legacy note', {
    kind: 'parameter_template',
    model_type: 'part.part',
    enabled: false,
  }),
  observation(909, 'company', '12', 'Yageo', {
    kind: 'company',
    manufacturer: true,
    supplier: true,
  }),
  observation(910, 'company', '601', 'Vishay', {
    kind: 'company',
    manufacturer: true,
    supplier: false,
  }),
  observation(911, 'company', '602', 'DigiKey', {
    kind: 'company',
    manufacturer: false,
    supplier: true,
  }),
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
  manufacturer: { company: ref(909, 'company'), mpn: 'CF-47' },
  supplier: { company: ref(909, 'company'), sku: 'S-47' },
  tags: ['SMD'],
  description: 'Through-hole',
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
  supplier: { company: ref(909, 'company'), sku: 'S-100' },
  tags: [],
}

const lot = (n: number, part: string | null) => ({
  id: id(100 + n),
  label: `Lot ${n}`,
  revision: '1',
  contribution_key: id(200 + n),
  part_subject_id: part,
  quantity: { mode: 'set', value: '5' },
  location: { mode: 'unset' },
})

const batch = {
  id: id(1),
  revision: '7',
  archived: false,
  parts: [
    { id: partA, label: 'A', revision: '1', choice: { mode: 'create', spec: specA } },
    { id: partB, label: 'B', revision: '1', choice: { mode: 'create', spec: specB } },
    { id: partC, label: 'Unknown resistor', revision: '1', choice: { mode: 'unset' } },
  ],
  lots: [lot(1, partA), lot(2, partA), lot(3, partB), lot(4, partC)],
  observations,
} as unknown as CaptureSnapshotDto

const operatorOrigin = { kind: 'operator' as const }
const research = { kind: 'step' as const, step: 'research' as const, proposal_id: id(710) }

const entry = (value: Partial<BatchRecordDto> & Pick<BatchRecordDto, 'key' | 'type' | 'label'>) =>
  ({
    state: 'exists',
    target: null,
    fields: [],
    part_ids: [],
    lot_ids: [],
    decision: null,
    ...value,
  }) as BatchRecordDto

const records: BatchRecordsDto = {
  batch_id: batch.id,
  revision: '7',
  counts: [
    { type: 'category', new: 0, existing: 2, decide: 0 },
    { type: 'company', new: 0, existing: 2, decide: 0 },
    { type: 'part', new: 2, existing: 0, decide: 1 },
    { type: 'manufacturer_part', new: 1, existing: 0, decide: 0 },
    { type: 'supplier_part', new: 2, existing: 0, decide: 0 },
    { type: 'parameter_template', new: 0, existing: 1, decide: 0 },
    { type: 'parameter', new: 2, existing: 0, decide: 0 },
    { type: 'location', new: 0, existing: 0, decide: 0 },
    { type: 'stock_item', new: 4, existing: 0, decide: 0 },
    { type: 'tag', new: 0, existing: 1, decide: 0 },
  ],
  records: [
    entry({
      key: 'company:supplier:12',
      type: 'company',
      label: 'Yageo',
      target: { kind: 'company', role: 'supplier', pk: '12' },
      part_ids: [partA, partB],
      lot_ids: [id(101), id(102), id(103)],
    }),
    entry({
      key: `part:${partA}`,
      type: 'part',
      label: 'Carbon film resistor',
      state: 'new',
      target: { kind: 'part', part_subject_id: partA },
      part_ids: [partA],
      lot_ids: [id(101), id(102)],
      fields: [
        { name: 'name', value: 'Carbon film resistor', origin: operatorOrigin },
        { name: 'description', value: 'Through-hole', origin: operatorOrigin },
        { name: 'category', value: 'Resistors', origin: research },
        { name: 'tags', value: 'SMD', origin: research },
      ],
    }),
    entry({
      key: `part:${partC}`,
      type: 'part',
      label: 'Unknown resistor',
      state: 'choose',
      part_ids: [partC],
      lot_ids: [id(104)],
      decision: {
        code: 'part_choice_required',
        detail: 'Choose an existing Part or start a new one.',
      },
    }),
    entry({
      key: `supplier_part:${partA}`,
      type: 'supplier_part',
      label: 'S-47 · Carbon film resistor',
      state: 'new',
      target: { kind: 'supplier_part', part_subject_id: partA },
      part_ids: [partA],
      lot_ids: [id(101), id(102)],
      fields: [
        { name: 'company', value: 'Yageo', origin: operatorOrigin },
        { name: 'sku', value: 'S-47', origin: operatorOrigin },
      ],
    }),
    entry({
      key: 'parameter_template:201',
      type: 'parameter_template',
      label: 'Composition',
      target: { kind: 'parameter_template', pk: '201' },
      part_ids: [partA, partB],
      lot_ids: [id(101), id(102), id(103)],
    }),
  ],
}

function stage(edit = vi.fn(async () => true)) {
  const onDirtyChange = vi.fn()
  render(
    <RecordsStage
      batch={batch}
      client={{ read: vi.fn(async () => records) }}
      edit={edit}
      observe={vi.fn(async () => null)}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { edit, onDirtyChange }
}

async function open(user: ReturnType<typeof userEvent.setup>, type: RegExp, record: string) {
  await user.click(await screen.findByRole('button', { name: type }))
  await user.click(screen.getByRole('button', { name: record }))
}

describe('RecordsStage', () => {
  it('lists types with their counts and decisions waiting', async () => {
    stage()
    const rail = await screen.findByRole('navigation', { name: 'Record types' })
    const parts = within(rail).getByRole('button', { name: /^Parts/ })
    expect(parts).toHaveTextContent('2 new · 0 existing')
    expect(parts).toHaveTextContent('1 to decide')
    expect(within(rail).getByRole('button', { name: /^Companies/ })).not.toHaveTextContent(
      'to decide',
    )
  })

  it('maps a shared company to another in the same role, stating every Part it reaches', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Companies/, 'Yageo')
    const detail = screen.getByRole('region', { name: 'Yageo' })

    expect(detail).toHaveTextContent(
      'Applies to 2 Parts (Carbon film resistor, Ceramic capacitor), used by 3 lots.',
    )
    expect(detail).toHaveTextContent('Creating a company is not supported yet.')
    const select = within(detail).getByLabelText('Use another supplier')
    expect(within(select).queryByRole('option', { name: 'Vishay' })).not.toBeInTheDocument()
    await user.selectOptions(select, 'DigiKey')
    await user.click(within(detail).getByRole('button', { name: 'Save' }))

    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'company', role: 'supplier', pk: '12' },
      operation: { op: 'map_to_existing', reference: ref(911, 'company') },
    })
  })

  it('keeps the draft when a save is refused, for an explicit retry', async () => {
    const user = userEvent.setup()
    const { onDirtyChange } = stage(vi.fn(async () => false))
    await open(user, /^Companies/, 'Yageo')
    const detail = screen.getByRole('region', { name: 'Yageo' })
    const select = within(detail).getByLabelText('Use another supplier')
    await user.selectOptions(select, 'DigiKey')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await user.click(within(detail).getByRole('button', { name: 'Save' }))

    expect(select).toHaveValue(id(911))
    expect(within(detail).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('maps a template batch-wide, naming a Part whose category has no mapping', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parameter templates/, 'Composition')
    const detail = screen.getByRole('region', { name: 'Composition' })
    await user.selectOptions(within(detail).getByLabelText('Use another template'), 'Resistor type')
    await user.selectOptions(
      within(detail).getByLabelText('Mapping in Resistors'),
      'Resistors · Resistor type',
    )
    await user.click(within(detail).getByRole('button', { name: 'Save' }))

    expect(detail).toHaveTextContent('No category mapping fits “Ceramic capacitor”.')
    expect(edit).not.toHaveBeenCalled()

    await user.click(within(detail).getByRole('checkbox', { name: 'Exclude Ceramic capacitor' }))
    await user.click(within(detail).getByRole('button', { name: 'Save' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'parameter_template', pk: '201' },
      operation: {
        op: 'map_template',
        template: ref(904, 'parameter_template'),
        category_mappings: [ref(906, 'category_parameter')],
        exclude_parts: [partB],
      },
    })
  })

  it('edits a Part’s name and clears its description; each field shows who proposed it', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parts/, 'Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'Carbon film resistor' })

    expect(detail).toHaveTextContent('Applies to Carbon film resistor, used by 2 lots.')
    expect(within(detail).getByRole('row', { name: /Category/ })).toHaveTextContent(
      'Proposed by Research',
    )
    expect(within(detail).getByRole('row', { name: /Name/ })).toHaveTextContent('Set by you')
    expect(within(detail).queryByRole('button', { name: /^Ask/ })).not.toBeInTheDocument()

    const name = within(detail).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, ' Carbon resistor ')
    await user.click(within(detail).getByRole('button', { name: 'Save name' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: { op: 'set_name', value: 'Carbon resistor' },
    })

    await user.clear(within(detail).getByLabelText('Description'))
    await user.click(within(detail).getByRole('button', { name: 'Save description' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: { op: 'set_description', value: null },
    })
  })

  it('starts a new Part for a Part that needs a decision', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parts/, 'Unknown resistor')
    const detail = screen.getByRole('region', { name: 'Unknown resistor' })

    expect(detail).toHaveTextContent('Needs a decision')
    await user.type(within(detail).getByLabelText('New Part name'), 'Wirewound resistor')
    await user.selectOptions(within(detail).getByLabelText('Existing category'), 'Resistors')
    await user.click(within(detail).getByRole('button', { name: 'Start a new Part' }))

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        kind: 'part',
        id: partC,
        choice: {
          mode: 'create',
          spec: {
            name: 'Wirewound resistor',
            category: ref(901, 'category'),
            parameters: [],
            manufacturer: null,
            supplier: null,
            tags: [],
          },
        },
      }),
    )
  })

  it('edits a supplier SKU once for every lot using the Part', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Supplier parts/, 'S-47 · Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'S-47 · Carbon film resistor' })

    expect(detail).toHaveTextContent('Applies to Carbon film resistor, used by 2 lots.')
    const sku = within(detail).getByLabelText('SKU')
    await user.clear(sku)
    await user.type(sku, ' S-48 ')
    await user.click(within(detail).getByRole('button', { name: 'Save' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'supplier_part', part_subject_id: partA },
      operation: { op: 'set_sku', company: ref(909, 'company'), sku: 'S-48' },
    })
  })

  it('moves a Part to another category, mapping or dropping each parameter', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parts/, 'Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'Carbon film resistor' })
    await user.selectOptions(within(detail).getByLabelText('Move to category'), 'Capacitors')
    await user.click(within(detail).getByRole('button', { name: 'Save category' }))
    expect(detail).toHaveTextContent('Map or drop every parameter of “Carbon film resistor”')
    expect(edit).not.toHaveBeenCalled()

    await user.selectOptions(
      within(detail).getByLabelText('Composition in Capacitors'),
      'Capacitors · Composition',
    )
    await user.click(within(detail).getByRole('button', { name: 'Save category' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: {
        op: 'set_category',
        reference: ref(902, 'category'),
        parameter_mappings: [
          { template_pk: '201', category_mapping: ref(907, 'category_parameter') },
        ],
        drop_parameters: [],
      },
    })

    // An accepted save clears the choice; choose the category again to drop instead.
    await user.selectOptions(within(detail).getByLabelText('Move to category'), 'Capacitors')
    await user.click(within(detail).getByRole('checkbox', { name: 'Drop Composition' }))
    await user.click(within(detail).getByRole('button', { name: 'Save category' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: {
        op: 'set_category',
        reference: ref(902, 'category'),
        parameter_mappings: [],
        drop_parameters: ['201'],
      },
    })
  })

  it('edits, removes and adds parameters, and replaces tags', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parts/, 'Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'Carbon film resistor' })
    const target = { kind: 'parameter', part_subject_id: partA, template_pk: '201' }

    const value = within(detail).getByLabelText('Composition')
    await user.clear(value)
    await user.type(value, 'Metal film')
    await user.click(within(detail).getByRole('button', { name: 'Save Composition' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target,
      operation: {
        op: 'set_parameter',
        template: ref(903, 'parameter_template'),
        category_mapping: ref(905, 'category_parameter'),
        value: 'Metal film',
      },
    })
    await user.click(within(detail).getByRole('button', { name: 'Remove Composition' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target,
      operation: { op: 'remove_parameter' },
    })

    await user.selectOptions(within(detail).getByLabelText('Add a parameter'), 'Resistor type')
    await user.selectOptions(
      within(detail).getByLabelText('Mapping in this category'),
      'Resistors · Resistor type',
    )
    await user.type(within(detail).getByLabelText('Value'), 'Axial')
    await user.click(within(detail).getByRole('button', { name: 'Add parameter' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'parameter', part_subject_id: partA, template_pk: '202' },
      operation: {
        op: 'set_parameter',
        template: ref(904, 'parameter_template'),
        category_mapping: ref(906, 'category_parameter'),
        value: 'Axial',
      },
    })

    const tags = within(detail).getByLabelText('Tags')
    await user.clear(tags)
    await user.type(tags, 'THT, Bin 4, THT')
    await user.click(within(detail).getByRole('button', { name: 'Save tags' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: { op: 'set_tags', tags: ['THT', 'Bin 4'] },
    })
  })

  it('keeps an unsaved record open until it is saved or discarded', async () => {
    const user = userEvent.setup()
    const { onDirtyChange } = stage()
    await open(user, /^Companies/, 'Yageo')
    await user.selectOptions(screen.getByLabelText('Use another supplier'), 'DigiKey')
    await user.click(screen.getByRole('button', { name: /^Parts/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Save or discard this record’s changes')
    expect(screen.getByRole('region', { name: 'Yageo' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Use another supplier')).toHaveValue('')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: /^Parts/ }))
    expect(screen.queryByRole('region', { name: 'Yageo' })).not.toBeInTheDocument()
  })

  it('keeps offering the retry when loading current values fails', async () => {
    const user = userEvent.setup()
    const reload = vi.fn(async () => false)
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => records) }}
        edit={vi.fn(async () => false)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        reload={reload}
      />,
    )
    await open(user, /^Companies/, 'Yageo')
    await user.selectOptions(screen.getByLabelText('Use another supplier'), 'DigiKey')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const retry = await screen.findByRole('button', {
      name: 'Load current values, keep this draft',
    })
    await user.click(retry)

    expect(reload).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'Load current values, keep this draft' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Use another supplier')).toHaveValue(id(911))
  })

  it('opens a record a link points to, including the one it first opened', async () => {
    const user = userEvent.setup()
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => records) }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        initialType="parameter_template"
        initialRecord="201"
      />,
    )
    expect(await screen.findByRole('region', { name: 'Composition' })).toBeInTheDocument()
    await open(user, /^Companies/, 'Yageo')
    expect(screen.getByRole('region', { name: 'Yageo' })).toBeInTheDocument()

    act(() => {
      location.hash = `${batch.id}/review/records/parameter_template/201`
      dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByRole('region', { name: 'Composition' })).toBeInTheDocument()
  })

  it('sends a lot with no Part to its lot, with the reason', async () => {
    const user = userEvent.setup()
    const lotless = entry({
      key: `stock_item:${id(109)}`,
      type: 'stock_item',
      label: 'Lot 9',
      state: 'choose',
      lot_ids: [id(109)],
      decision: { code: 'part_choice_required', detail: 'Choose the Part for this lot.' },
    })
    render(
      <RecordsStage
        batch={batch}
        client={{
          read: vi.fn(async () => ({ ...records, records: [...records.records, lotless] })),
        }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
      />,
    )
    await open(user, /^Stock items/, 'Lot 9')
    const detail = screen.getByRole('region', { name: 'Lot 9' })

    expect(detail).toHaveTextContent('Choose the Part for this lot.')
    expect(within(detail).getByRole('link', { name: 'Open this lot' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/lots/${id(109)}`,
    )
  })

  it('shows an AI lot’s estimate as Examine’s, waiting to be accepted on the lot', async () => {
    const user = userEvent.setup()
    const estimated = entry({
      key: `stock_item:${id(110)}`,
      type: 'stock_item',
      label: 'Lot 10',
      state: 'choose',
      lot_ids: [id(110)],
      fields: [{ name: 'quantity', value: '12', origin: { kind: 'estimate', step: 'examine' } }],
      decision: {
        code: 'quantity_required',
        detail: 'Accept or replace the estimated quantity on this lot before approving it.',
      },
    })
    render(
      <RecordsStage
        batch={batch}
        client={{
          read: vi.fn(async () => ({ ...records, records: [...records.records, estimated] })),
        }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
      />,
    )
    await open(user, /^Stock items/, 'Lot 10')
    const detail = screen.getByRole('region', { name: 'Lot 10' })

    expect(within(detail).getByRole('row', { name: 'Quantity as saved' })).toHaveTextContent(
      '12Estimated by Examine',
    )
    expect(detail).toHaveTextContent('Accept or replace the estimated quantity')
    expect(within(detail).getByRole('link', { name: 'Open this lot' })).toBeInTheDocument()
  })

  it('asks the proposing step’s session about a field, and shows it was asked', async () => {
    const user = userEvent.setup()
    const chat = vi.fn(async () => ({ id: 'inbox' }))
    const processing = {
      read: vi.fn(async () => ({
        jobs: [
          { id: 'research-job', stage: 'research', subject_id: partA, session_state: 'running' },
          { id: 'other-job', stage: 'research', subject_id: id(99), session_state: 'running' },
        ],
      })),
      session: vi.fn(),
      chat,
    } as unknown as ProcessingClient
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => records) }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        processing={processing}
      />,
    )
    await open(user, /^Parts/, 'Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'Carbon film resistor' })
    const category = within(detail).getByRole('row', { name: 'Category as saved' })
    await user.click(await within(category).findByRole('button', { name: 'Ask Research' }))
    const message = within(detail).getByLabelText('Message to Research')
    expect(message).toHaveValue('Please check the category of Carbon film resistor.')
    await user.click(within(detail).getByRole('button', { name: 'Send to Research' }))

    expect(chat).toHaveBeenCalledWith(
      batch.id,
      'research-job',
      {
        idempotency_key: expect.any(String),
        text: 'Please check the category of Carbon film resistor.',
      },
      expect.any(String),
    )
    expect(await within(category).findByText('Asked Research')).toBeVisible()
    // A field set by the operator has no step to ask.
    expect(
      within(within(detail).getByRole('row', { name: 'Name as saved' })).queryByRole('button', {
        name: /^Ask/,
      }),
    ).not.toBeInTheDocument()
  })

  it('maps a proposed new manufacturer to its likely match or another, on every Part using it', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    const proposedCompany = entry({
      key: 'company:proposed:manufacturer:vsy',
      type: 'company',
      label: 'VSY',
      state: 'choose',
      part_ids: [partA],
      lot_ids: [id(101), id(102)],
      decision: {
        code: 'company_proposed_new',
        detail:
          'Creating a manufacturer is not supported yet. Use an existing company or pick another.',
      },
      proposed: {
        role: 'manufacturer',
        name: 'VSY',
        reason: 'The reel label reads VSY',
        number: 'R-10',
        likely: {
          reference: ref(910, 'company'),
          label: 'Vishay',
          why: 'Its name contains the other',
        },
      },
    })
    render(
      <RecordsStage
        batch={batch}
        client={{
          read: vi.fn(async () => ({ ...records, records: [...records.records, proposedCompany] })),
        }}
        edit={edit}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
      />,
    )
    await open(user, /^Companies/, 'VSY')
    const detail = screen.getByRole('region', { name: 'VSY' })
    expect(detail).toHaveTextContent('Proposed because: The reel label reads VSY')
    expect(detail).toHaveTextContent('Creating a new manufacturer is not supported yet.')
    expect(detail).toHaveTextContent(
      'Sets the manufacturer of Carbon film resistor to the chosen company, with part number R-10.',
    )
    await user.click(within(detail).getByRole('button', { name: 'Use Vishay' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'manufacturer_part', part_subject_id: partA },
      operation: { op: 'set_mpn', company: ref(910, 'company'), mpn: 'R-10' },
    })

    await user.selectOptions(within(detail).getByLabelText('Use another manufacturer'), 'Yageo')
    await user.click(within(detail).getByRole('button', { name: 'Use this manufacturer' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'manufacturer_part', part_subject_id: partA },
      operation: { op: 'set_mpn', company: ref(909, 'company'), mpn: 'R-10' },
    })
  })

  it('lists values the executor cannot create on the Part, with the agent’s reason', async () => {
    const user = userEvent.setup()
    const withNotes = {
      ...records,
      records: records.records.map((item) =>
        item.key === `part:${partA}`
          ? {
              ...item,
              unsupported: [
                {
                  field: 'category',
                  value: 'Thin-film resistors',
                  why: 'Creating a category is not supported yet; choose an existing category.',
                  reason: 'The packet says thin film',
                },
              ],
            }
          : item,
      ),
    }
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => withNotes) }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
      />,
    )
    await open(user, /^Parts/, 'Carbon film resistor')
    const detail = screen.getByRole('region', { name: 'Carbon film resistor' })
    const category = within(detail).getByRole('row', { name: 'Category as saved' })
    expect(category).toHaveTextContent(
      'Proposed Thin-film resistors: Creating a category is not supported yet; choose an existing category. Proposed because: The packet says thin film',
    )
    // The category editor offers the existing categories.
    expect(within(detail).getByLabelText('Move to category')).toBeInTheDocument()
    expect(
      within(detail).queryByRole('region', { name: 'Not supported yet' }),
    ).not.toBeInTheDocument()
  })

  it('offers no Ask for a session that has been cancelled', async () => {
    const user = userEvent.setup()
    const processing = {
      read: vi.fn(async () => ({
        jobs: [
          { id: 'research-job', stage: 'research', subject_id: partA, session_state: 'cancelled' },
        ],
      })),
      session: vi.fn(),
      chat: vi.fn(),
    } as unknown as ProcessingClient
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => records) }}
        edit={vi.fn(async () => true)}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        processing={processing}
      />,
    )
    await open(user, /^Parts/, 'Carbon film resistor')
    await waitFor(() => expect(processing.read).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /^Ask/ })).not.toBeInTheDocument()
  })

  it('drops record drafts when the batch discards local edits', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    const props = {
      batch,
      client: { read: vi.fn(async () => records) },
      edit: vi.fn(async () => true),
      observe: vi.fn(async () => null),
      onDirtyChange,
    }
    const { rerender } = render(<RecordsStage {...props} discarded={0} />)
    await open(user, /^Companies/, 'Yageo')
    await user.selectOptions(screen.getByLabelText('Use another supplier'), 'DigiKey')
    await user.click(screen.getByRole('button', { name: /^Parts/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Save or discard this record’s changes')

    rerender(<RecordsStage {...props} discarded={1} />)
    expect(screen.getByLabelText('Use another supplier')).toHaveValue('')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers only templates a Part can use, and saves a description on one trimmed line', async () => {
    const user = userEvent.setup()
    const { edit } = stage()
    await open(user, /^Parameter templates/, 'Composition')
    expect(
      within(screen.getByLabelText('Use another template')).queryByRole('option', {
        name: 'Legacy note',
      }),
    ).not.toBeInTheDocument()

    await open(user, /^Parts/, 'Carbon film resistor')
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, '  Axial,   1/4 W  ')
    await user.click(screen.getByRole('button', { name: 'Save description' }))
    expect(edit).toHaveBeenLastCalledWith({
      kind: 'record',
      target: { kind: 'part', part_subject_id: partA },
      operation: { op: 'set_description', value: 'Axial, 1/4 W' },
    })
  })

  it('holds every other save while one is in flight', async () => {
    const user = userEvent.setup()

    let finish: (saved: boolean) => void = () => {}

    const edit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    stage(edit)
    await open(user, /^Parts/, 'Carbon film resistor')
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Carbon resistor')
    const tags = screen.getByLabelText('Tags')
    await user.clear(tags)
    await user.type(tags, 'THT')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled()
    finish(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tags' })).toBeEnabled())
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('says when records cannot be read', async () => {
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => Promise.reject(new Error('down'))) }}
        edit={vi.fn()}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
      />,
    )
    expect(await screen.findByText(/Records are unavailable/)).toBeInTheDocument()
  })
})

/** Saves move the revision as the server does; the first save can be refused as a 412. */
function LiveStage({
  conflictFirst = false,
  renamedElsewhere,
  failReadAfterSave = false,
  slowReadAfterSave,
}: {
  conflictFirst?: boolean
  /** A name another client saves, which loading current values brings in. */
  renamedElsewhere?: string
  /** The records read for any revision after the first fails once. */
  failReadAfterSave?: boolean
  /** Holds the records read for any later revision until this promise settles. */
  slowReadAfterSave?: Promise<void>
}) {
  const [failing, setFailing] = useState(failReadAfterSave)
  const [current, setCurrent] = useState(batch)
  const [refused, setRefused] = useState(conflictFirst)

  async function edit(change: CaptureEditDto['change']) {
    if (refused) {
      return false
    }
    if (change.kind !== 'record') {
      return false
    }
    const { specs } = applyRecordChange(current, change)
    setCurrent({
      ...current,
      revision: String(Number(current.revision) + 1),
      parts: current.parts.map((item) =>
        specs.has(item.id)
          ? { ...item, choice: { mode: 'create', spec: specs.get(item.id)! } }
          : item,
      ),
    } as CaptureSnapshotDto)
    return true
  }

  return (
    <RecordsStage
      batch={current}
      client={{
        read: vi.fn(async () => {
          if (slowReadAfterSave && current.revision !== batch.revision) {
            await slowReadAfterSave
          }
          if (failing && current.revision !== batch.revision) {
            setFailing(false)
            throw new Error('records read failed')
          }
          return { ...records, revision: current.revision }
        }),
      }}
      edit={edit}
      observe={vi.fn(async () => null)}
      onDirtyChange={vi.fn()}
      reload={async () => {
        setRefused(false)
        setCurrent((value) => {
          const next = { ...value, revision: String(Number(value.revision) + 1) }
          if (!renamedElsewhere) {
            return next
          }
          const { specs } = applyRecordChange(value, {
            kind: 'record',
            target: { kind: 'part', part_subject_id: partA },
            operation: { op: 'set_name', value: renamedElsewhere },
          })
          return {
            ...next,
            parts: value.parts.map((item) =>
              item.id === partA
                ? { ...item, choice: { mode: 'create', spec: specs.get(partA)! } }
                : item,
            ),
          } as CaptureSnapshotDto
        })
        return true
      }}
    />
  )
}

describe('RecordsStage with saves that move the revision', () => {
  it('keeps other unsaved sections of a Part when one section saves', async () => {
    const user = userEvent.setup()
    render(<LiveStage />)
    await open(user, /^Parts/, 'Carbon film resistor')
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Carbon resistor')
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Axial, 1/4 W')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled())
    expect(screen.getByLabelText('Name')).toHaveValue('Carbon resistor')
    expect(screen.getByLabelText('Description')).toHaveValue('Axial, 1/4 W')
    expect(screen.getByRole('button', { name: 'Save description' })).toBeEnabled()
  })

  it('retries a draft after a conflict by loading current values without losing it', async () => {
    const user = userEvent.setup()
    render(<LiveStage conflictFirst />)
    await open(user, /^Supplier parts/, 'S-47 · Carbon film resistor')
    const sku = screen.getByLabelText('SKU')
    await user.clear(sku)
    await user.type(sku, 'S-48')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await user.click(
      await screen.findByRole('button', { name: 'Load current values, keep this draft' }),
    )
    expect(screen.getByLabelText('SKU')).toHaveValue('S-48')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
    expect(screen.getByLabelText('SKU')).toHaveValue('S-48')
  })

  it('shows tags and a description as saved once a normalised save is accepted', async () => {
    const user = userEvent.setup()
    render(<LiveStage />)
    await open(user, /^Parts/, 'Carbon film resistor')
    const tags = screen.getByLabelText('Tags')
    await user.clear(tags)
    await user.type(tags, 'THT,Bin 4, THT')
    await user.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(screen.getByLabelText('Tags')).toHaveValue('THT, Bin 4'))
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled()

    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, '  Axial,   1/4 W  ')
    await user.click(screen.getByRole('button', { name: 'Save description' }))
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('Axial, 1/4 W'))
    expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /^Companies/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('brings another client’s change into a clean field when current values load', async () => {
    const user = userEvent.setup()
    render(<LiveStage conflictFirst renamedElsewhere="Resistor, carbon" />)
    await open(user, /^Parts/, 'Carbon film resistor')
    const tags = screen.getByLabelText('Tags')
    await user.clear(tags)
    await user.type(tags, 'THT')
    await user.click(screen.getByRole('button', { name: 'Save tags' }))
    await user.click(
      await screen.findByRole('button', { name: 'Load current values, keep this draft' }),
    )

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Resistor, carbon'))
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    expect(screen.getByLabelText('Tags')).toHaveValue('THT')
  })

  it('keeps drafts when the read after a save fails, and reads again on request', async () => {
    const user = userEvent.setup()
    render(<LiveStage failReadAfterSave />)
    await open(user, /^Parts/, 'Carbon film resistor')
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Axial')
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Carbon resistor')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText(/Records may be out of date/)).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Axial')
    await user.click(screen.getByRole('button', { name: 'Load current values' }))
    await waitFor(() =>
      expect(screen.queryByText(/Records may be out of date/)).not.toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Description')).toHaveValue('Axial')
  })

  it('treats a padded SKU or parameter value as saved once the trimmed value is accepted', async () => {
    const user = userEvent.setup()
    render(<LiveStage />)
    await open(user, /^Supplier parts/, 'S-47 · Carbon film resistor')
    const sku = screen.getByLabelText('SKU')
    await user.clear(sku)
    await user.type(sku, ' S-48 ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByLabelText('SKU')).toHaveValue('S-48'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await open(user, /^Parts/, 'Carbon film resistor')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const value = screen.getByLabelText('Composition')
    await user.clear(value)
    await user.type(value, ' Metal film ')
    await user.click(screen.getByRole('button', { name: 'Save Composition' }))
    await waitFor(() => expect(screen.getByLabelText('Composition')).toHaveValue('Metal film'))
    expect(screen.getByRole('button', { name: 'Save Composition' })).toBeDisabled()
  })

  it('does not warn that records are out of date while a save’s new read arrives', async () => {
    const user = userEvent.setup()

    let arrive = () => {}

    const slow = new Promise<void>((resolve) => {
      arrive = resolve
    })
    render(<LiveStage slowReadAfterSave={slow} />)
    await open(user, /^Parts/, 'Carbon film resistor')
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Carbon resistor')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(screen.getByLabelText('Name')).toBeDisabled())
    expect(screen.queryByText(/Records may be out of date/)).not.toBeInTheDocument()
    arrive()
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeEnabled())
  })

  it('ignores an unknown record type in the route', async () => {
    render(
      <RecordsStage
        batch={batch}
        client={{ read: vi.fn(async () => records) }}
        edit={vi.fn()}
        observe={vi.fn(async () => null)}
        onDirtyChange={vi.fn()}
        initialType="bogus"
      />,
    )
    expect(await screen.findByRole('navigation', { name: 'Record types' })).toBeInTheDocument()
  })
})

describe('CompanyDecision', () => {
  it('offers the likely existing match with its reason and states creation is not supported', async () => {
    const user = userEvent.setup()
    const useExisting = vi.fn()
    render(
      <CompanyDecision
        role="manufacturer"
        proposed={{ name: 'GCT', reason: 'Packet logo reads GCT.' }}
        likely={{ label: 'Global Connector Technology', reason: 'GCT is its trading name.' }}
        scope="Applies to USB-C socket, used by 1 lot."
        onUseLikely={useExisting}
      />,
    )
    const decision = screen.getByRole('region', { name: 'Proposed new manufacturer: GCT' })
    expect(decision).toHaveTextContent('Needs a decision')
    expect(decision).toHaveTextContent('GCT is its trading name.')
    expect(decision).toHaveTextContent('Creating a new manufacturer is not supported yet.')
    expect(decision).toHaveTextContent('Applies to USB-C socket, used by 1 lot.')
    await user.click(
      within(decision).getByRole('button', { name: 'Use Global Connector Technology' }),
    )
    expect(useExisting).toHaveBeenCalled()
  })
})
