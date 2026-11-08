import { describe, expect, it } from 'vitest'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { parameterMatrix } from './parameter-matrix'

const ref = (id: string, pk: string, model: string) => ({
  observation_id: id,
  target_context_id: 't',
  model,
  pk,
})

const part = (id: string, label: string, parameters: [string, string, string][]) => ({
  id,
  label,
  choice: {
    mode: 'create',
    spec: {
      name: label,
      category: ref('res', '81', 'category'),
      parameters: parameters.map(([obs, pk, value]) => ({
        template: ref(obs, pk, 'parameter_template'),
        category_mapping: ref('cm', '1', 'category_parameter'),
        value,
      })),
      manufacturer: null,
      supplier: null,
      tags: [],
    },
  },
})

const batch = {
  observations: [
    { id: 'res', label: 'Resistors' },
    { id: 'ohm', label: 'Resistance' },
    { id: 'tol', label: 'Tolerance' },
  ],
  parts: [
    part('a', 'Resistor A', [
      ['ohm', '1', '10k'],
      ['tol', '2', '1%'],
    ]),
    part('b', 'Resistor B', [['ohm', '1', '4.7k']]),
  ],
} as unknown as CaptureSnapshotDto

const record = (value: Partial<BatchRecordDto>) =>
  ({ fields: [], lot_ids: [], state: 'new', ...value }) as BatchRecordDto

const records = [
  record({
    key: 'parameter:a:2',
    type: 'parameter',
    target: { kind: 'parameter', part_subject_id: 'a', template_pk: '2' },
    fields: [{ name: 'value', value: '1%', origin: { kind: 'operator' } }],
  } as never),
  record({
    key: 'parameter_template:2',
    type: 'parameter_template',
    label: 'Tolerance',
    state: 'choose',
    target: { kind: 'parameter_template', pk: '2' },
  } as never),
]

describe('parameterMatrix', () => {
  it('lays each category out as Parts by templates, marking missing, new and added values', () => {
    const { groups, toDecide } = parameterMatrix(batch, records)
    expect(groups).toHaveLength(1)
    const [group] = groups
    expect(group.category).toBe('Resistors')
    expect(group.templates).toEqual([
      { pk: '1', label: 'Resistance', isNew: false },
      { pk: '2', label: 'Tolerance', isNew: true },
    ])
    expect(group.rows.map((row) => row.label)).toEqual(['Resistor A', 'Resistor B'])
    expect(group.rows[0].cells['2']).toMatchObject({ value: '1%', added: true })
    expect(group.rows[1].cells['2']).toMatchObject({ missing: true })
    expect(toDecide.map((item) => item.label)).toEqual(['Tolerance'])
  })
})
