import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  BatchRecordDto,
  BatchRecordsDto,
  CaptureSnapshotDto,
  ProcessingJobDto,
} from '@invimport/contracts'
import { render } from '#/test/render'
import { ProcessingInventory } from './ProcessingInventory'

const id = (n: number) => `c0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const tube = id(101)
const resistors = id(102)
const partA = id(10)
const partB = id(11)
const job = id(300)

const batch = {
  id: id(1),
  revision: '4',
  archived: false,
  defaults: {
    quantity: { mode: 'set', value: '10' },
    location: {
      mode: 'set',
      value: { observation_id: id(900), target_context_id: id(901), model: 'location', pk: '14' },
    },
  },
  parts: [],
  lots: [
    {
      id: tube,
      label: 'LM358 op-amps (tube)',
      part_subject_id: partA,
      quantity: { mode: 'set', value: '5' },
      location: { mode: 'inherit' },
    },
    {
      id: resistors,
      label: '10 kΩ resistors',
      part_subject_id: partB,
      // An AI lot that inherits never takes the batch default of 10, as approval reads it.
      origin: 'agent',
      estimated_quantity: '12',
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  observations: [],
} as unknown as CaptureSnapshotDto

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
  revision: '4',
  counts: [],
  records: [
    entry({
      key: `part:${partA}`,
      type: 'part',
      label: 'OPA-0004 LM358DR',
      part_ids: [partA],
      lot_ids: [tube],
      mapped: { model: 'part', pk: '4' },
    }),
    entry({
      key: `part:${partB}`,
      type: 'part',
      label: 'RES-0144 10 kΩ 1%',
      state: 'new',
      part_ids: [partB],
      lot_ids: [resistors],
      reuse: {
        reference: {
          observation_id: id(902),
          target_context_id: id(901),
          model: 'part',
          pk: '31',
        },
        label: 'RES-0031',
        reason: '5% tolerance',
      },
    }),
    entry({
      key: 'company:manufacturer:41',
      type: 'company',
      label: 'Global Connector Technology',
      part_ids: [partA],
      lot_ids: [tube],
      target: { kind: 'company', role: 'manufacturer', pk: '41' },
    }),
    entry({
      key: 'location:14',
      type: 'location',
      label: 'Incoming inspection drawer',
      lot_ids: [resistors],
      mapped: { model: 'location', pk: '14' },
    }),
    entry({
      key: `stock_item:${tube}`,
      type: 'stock_item',
      label: 'LM358 op-amps (tube)',
      state: 'new',
      lot_ids: [tube],
      fields: [{ name: 'quantity', value: '5', origin: { kind: 'operator' } }],
    }),
    entry({
      key: `stock_item:${resistors}`,
      type: 'stock_item',
      label: '10 kΩ resistors',
      state: 'choose',
      lot_ids: [resistors],
      fields: [{ name: 'quantity', value: '12', origin: { kind: 'estimate', step: 'examine' } }],
      decision: {
        code: 'quantity_required',
        detail: 'Accept or replace the estimated quantity on this lot before approving it.',
      },
    }),
    entry({
      key: 'location:31',
      type: 'location',
      label: 'Bench bin B3',
      lot_ids: [tube],
      mapped: { model: 'location', pk: '31' },
    }),
  ],
}

const question = {
  id: id(400),
  job_id: job,
  attempt_id: id(301),
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: 'open',
  subject_id: tube,
  spec: {
    kind: 'clarification',
    prompt: 'Is the LM358 tube already in InvenTree?',
    reason: 'Stock #1712 has the same Part, date code and bin.',
  },
  assumption: 'Treating it as new until you say.',
} as const

const countQuestion = {
  ...question,
  id: id(401),
  subject_id: resistors,
  spec: {
    kind: 'quantity',
    prompt: 'How many resistors are in the bag?',
    reason: 'The estimate is rough.',
  },
} as const

const jobs = [
  {
    id: job,
    subject_id: tube,
    stage: 'inventory',
    revision: '2',
    state: 'waiting_for_user',
    attempt_id: id(301),
    input_sha256: 'a'.repeat(64),
    attempt_number: '1',
    qualification: 'native_unverified',
    session_state: 'waiting_input',
    proposals: [],
    questions: [question],
  },
  {
    id: id(310),
    subject_id: resistors,
    stage: 'inventory',
    revision: '2',
    state: 'waiting_for_user',
    attempt_id: id(311),
    input_sha256: 'a'.repeat(64),
    attempt_number: '1',
    qualification: 'native_unverified',
    session_state: 'waiting_input',
    proposals: [],
    questions: [
      countQuestion,
      {
        ...question,
        id: id(402),
        job_id: id(310),
        subject_id: resistors,
        spec: { ...question.spec, prompt: 'Are these the reel in drawer 2?' },
      },
    ],
  },
] as unknown as ProcessingJobDto[]

function mount(read = vi.fn(async () => records), shown = jobs) {
  const onOpenSession = vi.fn()
  render(<ProcessingInventory batch={batch} jobs={shown} onOpenSession={onOpenSession} />, {
    clients: { records: { read } },
  })
  return { onOpenSession, read }
}

describe('ProcessingInventory', () => {
  it('lists each lot’s Part match with why, linking to Review › Records', async () => {
    mount()
    const parts = await screen.findByRole('region', { name: 'Parts' })

    const row = (lot: string) => within(parts).getByText(lot).closest('li')!

    expect(row('LM358 op-amps (tube)')).toHaveTextContent('OPA-0004 LM358DR')
    expect(row('LM358 op-amps (tube)')).toHaveTextContent('Exists')
    expect(row('10 kΩ resistors')).toHaveTextContent('RES-0144 10 kΩ 1%')
    expect(row('10 kΩ resistors')).toHaveTextContent('New')
    expect(row('10 kΩ resistors')).toHaveTextContent('Not reusing RES-0031: 5% tolerance')
    expect(
      within(row('10 kΩ resistors')).getByRole('link', { name: 'RES-0144 10 kΩ 1%' }),
    ).toHaveAttribute('href', `#${batch.id}/review/records/part/${partB}`)
  })

  it('compares the lot with the record its question asks about, unknown fields reading Not known', async () => {
    const user = userEvent.setup()
    const { onOpenSession } = mount()
    // The batch's own values show at once; the Part and location follow the records read.
    await screen.findByRole('region', { name: 'Parts' })
    const card = screen.getByRole('region', {
      name: 'Compare before answering: LM358 op-amps (tube)',
    })
    expect(card).toHaveTextContent('Is the LM358 tube already in InvenTree?')
    const table = within(card).getByRole('table')

    const cells = (field: string) =>
      within(within(table).getByRole('rowheader', { name: field }).closest('tr')!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Field', 'This batch: LM358 op-amps (tube)', 'In InvenTree'])
    expect(cells('Part')).toEqual(['OPA-0004 LM358DR', 'Not known'])
    expect(cells('Date code')).toEqual(['Not known', 'Not known'])
    expect(cells('Location')).toEqual(['Bench bin B3', 'Not known'])
    expect(cells('Quantity')).toEqual(['5 pcs', 'Not known'])

    await user.click(within(card).getByRole('button', { name: 'Answer in the session' }))
    expect(onOpenSession).toHaveBeenCalledWith(job)
  })

  it('lists location and company matches, linking to Review › Records', async () => {
    mount()
    const matches = await screen.findByRole('region', { name: 'Locations and companies' })

    expect(within(matches).getByRole('link', { name: 'Bench bin B3' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/records/location/31`,
    )
    expect(within(matches).getByText('Bench bin B3').closest('li')).toHaveTextContent(
      'from 1 lot override',
    )
    expect(within(matches).getByText('Incoming inspection drawer').closest('li')).toHaveTextContent(
      'batch default',
    )
    expect(
      within(matches).getByRole('link', { name: 'Global Connector Technology' }),
    ).toHaveAttribute('href', `#${batch.id}/review/records/company/manufacturer%3A41`)
  })

  it('says when records cannot be read, and still offers the comparison', async () => {
    mount(vi.fn(async () => Promise.reject(new Error('down'))))
    expect(await screen.findByText(/Records are unavailable/)).toBeVisible()
    const card = screen.getByRole('region', {
      name: 'Compare before answering: LM358 op-amps (tube)',
    })
    expect(card).toHaveTextContent('Not known')
    expect(card).not.toHaveTextContent('5 pcs')
  })

  it('compares no quantity question, and keeps an AI lot’s estimate an estimate', async () => {
    mount()
    await screen.findByRole('region', { name: 'Parts' })
    expect(screen.queryByText('How many resistors are in the bag?')).toBeNull()
    const card = screen.getByRole('region', { name: 'Compare before answering: 10 kΩ resistors' })
    const quantity = within(
      within(card).getByRole('rowheader', { name: 'Quantity' }).closest('tr')!,
    )
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(quantity).toEqual(['About 12 pcs · Examine’s estimate, not yet accepted', 'Not known'])
  })

  it('compares a stepped question by its title and reason, but not one that only asks for a count', async () => {
    const stepped = {
      ...question,
      id: id(403),
      spec: undefined,
      assumption: undefined,
      schema_version: 'bench-intake-question/2',
      fields: ['identity'],
      title: 'The LM358 tube and stock #1712',
      reason: 'Stock #1712 has the same Part, date code and bin.',
      steps: [
        {
          id: 'same',
          prompt: 'Is it the tube in stock?',
          assumption: 'Treating it as new.',
          answer: {
            kind: 'choice',
            other: false,
            options: [
              { id: 'same', label: 'Same tube as stock #1712' },
              { id: 'new', label: 'Different tube: add new stock' },
            ],
          },
        },
      ],
    }
    const countOnly = {
      ...stepped,
      id: id(404),
      subject_id: resistors,
      title: 'How many resistors are left?',
      steps: [
        { id: 'left', prompt: 'How many?', assumption: 'About 12.', answer: { kind: 'number' } },
      ],
    }
    const twoSteps = {
      ...stepped,
      id: id(405),
      title: 'Where the LM358 tube goes',
      steps: [
        stepped.steps[0],
        { id: 'why', prompt: 'Why?', assumption: 'No reason given.', answer: { kind: 'text' } },
      ],
    }
    const shown = [
      { ...jobs[0], questions: [stepped, twoSteps] },
      { ...jobs[1], questions: [countOnly] },
    ] as unknown as ProcessingJobDto[]
    mount(undefined, shown)
    await screen.findByRole('region', { name: 'Parts' })
    const [card, stepsCard] = screen.getAllByRole('region', {
      name: 'Compare before answering: LM358 op-amps (tube)',
    })
    // A one-step question is labelled by its prompt, with its kind and assumption.
    expect(card).toHaveTextContent('Is it the tube in stock? · choose one of 2')
    expect(card).toHaveTextContent('Stock #1712 has the same Part, date code and bin.')
    expect(card).toHaveTextContent('Continuing on: Treating it as new.')
    // A question with steps is labelled by its title, with its step count and every assumption.
    expect(stepsCard).toHaveTextContent('Where the LM358 tube goes · 2 steps')
    expect(stepsCard).toHaveTextContent('Continuing on: Treating it as new. · No reason given.')
    expect(
      screen.queryByRole('region', { name: 'Compare before answering: 10 kΩ resistors' }),
    ).toBeNull()
  })
})
