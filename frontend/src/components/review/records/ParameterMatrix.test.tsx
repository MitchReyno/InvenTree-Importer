import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../../../test/render'
import { ParameterMatrix } from './ParameterMatrix'

const ref = (id: string, pk: string, model: string) => ({
  observation_id: id,
  target_context_id: 't',
  model,
  pk,
})

const batch = {
  observations: [
    { id: 'cap', label: 'Capacitors' },
    { id: 'volt', label: 'Voltage' },
  ],
  parts: [
    {
      id: 'c',
      label: 'CAP-0101',
      choice: {
        mode: 'create',
        spec: {
          name: 'CAP-0101',
          category: ref('cap', '90', 'category'),
          parameters: [
            {
              template: ref('volt', '5', 'parameter_template'),
              category_mapping: ref('cm', '6', 'category_parameter'),
              value: '25 V',
            },
          ],
          manufacturer: null,
          supplier: null,
          tags: [],
        },
      },
    },
  ],
} as unknown as CaptureSnapshotDto

const records = [
  {
    key: 'parameter:c:5',
    type: 'parameter',
    label: 'Voltage: 25 V',
    state: 'new',
    target: { kind: 'parameter', part_subject_id: 'c', template_pk: '5' },
    part_ids: ['c'],
    lot_ids: [],
    decision: null,
    fields: [
      {
        name: 'value',
        value: '25 V',
        origin: {
          kind: 'step',
          step: 'research',
          proposal_id: 'p',
          source_kind: 'label',
          agreement: 'disagree',
          alternatives: [{ value: '35 V', source_kind: 'distributor_page' }],
          chosen_because: 'Using the label.',
        },
      },
    ],
  },
  {
    key: 'part:c',
    type: 'part',
    label: 'CAP-0101',
    state: 'new',
    target: { kind: 'part', part_subject_id: 'c' },
    part_ids: ['c'],
    lot_ids: [],
    decision: null,
    fields: [],
    required_missing: [{ template_pk: '7', name: 'Dielectric', reason: 'Not in the pages read.' }],
  },
] as unknown as BatchRecordDto[]

describe('ParameterMatrix', () => {
  it('marks a disputed value and a template the category needs, and resolves the dispute', async () => {
    const user = userEvent.setup()
    const edit = vi.fn(async () => true)
    const send = vi.fn(async () => undefined)
    render(
      <ParameterMatrix
        batch={batch}
        records={records}
        open={vi.fn()}
        edit={edit}
        ask={(record, step) =>
          record.key === 'parameter:c:5' && step === 'research' ? send : undefined
        }
      />,
    )
    const matrix = screen.getByRole('region', { name: 'Parameters by category' })
    expect(within(matrix).getByRole('columnheader', { name: /Dielectric/ })).toHaveTextContent(
      'Required here',
    )
    const missing = within(matrix).getByRole('cell', { name: /missing/ })
    expect(missing).toHaveTextContent('! missing')
    expect(missing).toHaveAccessibleDescription('Not in the pages read.')
    expect(
      within(matrix).getByRole('button', { name: /CAP-0101, Voltage: 25 V/ }),
    ).toHaveTextContent('◆')

    const conflict = within(matrix).getByRole('group', {
      name: 'CAP-0101 Voltage: sources disagree',
    })
    expect(conflict).toHaveTextContent(
      'CAP-0101 Voltage: the label says 25 V; a distributor page says 35 V. Using the label.',
    )
    await user.click(within(conflict).getByRole('button', { name: 'Use 35 V' }))
    expect(edit).toHaveBeenCalledWith({
      kind: 'record',
      target: { kind: 'parameter', part_subject_id: 'c', template_pk: '5' },
      operation: {
        op: 'set_parameter',
        template: ref('volt', '5', 'parameter_template'),
        category_mapping: ref('cm', '6', 'category_parameter'),
        value: '35 V',
      },
    })
    expect(within(conflict).getByRole('button', { name: 'Ask Research' })).toBeVisible()
  })

  it('offers no Ask where the step has no open session', () => {
    render(<ParameterMatrix batch={batch} records={records} open={vi.fn()} edit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Ask/ })).toBeNull()
  })
})
