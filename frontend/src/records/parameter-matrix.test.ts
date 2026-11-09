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
]

describe('parameterMatrix', () => {
  it('lays each category out as Parts by templates, marking missing and added values', () => {
    const groups = parameterMatrix(batch, records)
    expect(groups).toHaveLength(1)
    const [group] = groups
    expect(group.category).toBe('Resistors')
    expect(group.templates).toEqual([
      { pk: '1', label: 'Resistance' },
      { pk: '2', label: 'Tolerance' },
    ])
    expect(group.rows.map((row) => row.label)).toEqual(['Resistor A', 'Resistor B'])
    expect(group.rows[0].cells['2']).toMatchObject({ value: '1%', added: true })
    expect(group.rows[1].cells['2']).toMatchObject({ missing: true })
  })

  it('marks a value whose sources disagree, and a template the category needs that no Part has', () => {
    const conflicted = [
      record({
        key: 'parameter:b:1',
        type: 'parameter',
        target: { kind: 'parameter', part_subject_id: 'b', template_pk: '1' },
        fields: [
          {
            name: 'value',
            value: '4.7k',
            origin: {
              kind: 'step',
              step: 'research',
              proposal_id: 'p',
              source_kind: 'label',
              agreement: 'disagree',
              alternatives: [{ value: '4.75k', source_kind: 'distributor_page' }],
              chosen_because: 'Using the label.',
            },
          },
        ],
      } as never),
      record({
        key: 'part:a',
        type: 'part',
        target: { kind: 'part', part_subject_id: 'a' },
        required_missing: [{ template_pk: '9', name: 'Power', reason: 'Not in the datasheet.' }],
      } as never),
    ]
    const [group] = parameterMatrix(batch, conflicted)
    expect(group.templates.map((template) => template.label)).toEqual([
      'Resistance',
      'Tolerance',
      'Power',
    ])
    expect(group.templates[2]).toMatchObject({ required: true })
    expect(group.rows[0].cells['9']).toMatchObject({
      missing: true,
      required: true,
      reason: 'Not in the datasheet.',
    })
    // A Part without the template is missing it too, but its step did not say why.
    expect(group.rows[1].cells['9']).toMatchObject({ missing: true, required: true })
    expect(group.rows[1].cells['1'].conflict).toEqual({
      used: { value: '4.7k', source_kind: 'label' },
      alternatives: [{ value: '4.75k', source_kind: 'distributor_page' }],
      because: 'Using the label.',
      step: 'research',
      template: ref('ohm', '1', 'parameter_template'),
      categoryMapping: ref('cm', '1', 'category_parameter'),
    })
    expect(group.rows[0].cells['1'].conflict).toBeUndefined()
  })
})
