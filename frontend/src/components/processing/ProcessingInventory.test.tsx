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
    quantity: { mode: 'unknown' },
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
  spec: {
    kind: 'clarification',
    subject_id: tube,
    prompt: 'Is the LM358 tube already in InvenTree?',
    reason: 'Stock #1712 has the same Part, date code and bin.',
  },
  assumption: 'Treating it as new until you say.',
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
] as unknown as ProcessingJobDto[]

function mount(read = vi.fn(async () => records)) {
  const onOpenSession = vi.fn()
  render(<ProcessingInventory batch={batch} jobs={jobs} onOpenSession={onOpenSession} />, {
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
    const card = screen.getByRole('region', { name: 'Compare before answering' })
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
    const card = screen.getByRole('region', { name: 'Compare before answering' })
    expect(card).toHaveTextContent('5 pcs')
  })
})
