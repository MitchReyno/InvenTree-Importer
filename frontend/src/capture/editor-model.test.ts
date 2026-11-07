import type { CaptureSnapshotDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { captureEditorChange, captureEditorDefaults } from './editor-model'

const context = '40000000-0000-4000-8000-000000000004'
const category = {
  id: '90000000-0000-4000-8000-000000000001',
  model: 'category',
  pk: '81',
  mapping: { kind: 'category' },
  target_context_id: context,
  label: 'Resistors',
  observed_at: '2026-11-06T09:00:00Z',
}
const partId = 'a0000000-0000-4000-8000-000000000001'
const spec = {
  name: 'Carbon film resistor',
  description: 'Axial, 1/4 W',
  category: {
    observation_id: category.id,
    target_context_id: context,
    model: 'category',
    pk: '81',
  },
  parameters: [],
  manufacturer: null,
  supplier: null,
  tags: [],
}
const batch = {
  id: '10000000-0000-4000-8000-000000000001',
  revision: '3',
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  parts: [{ id: partId, label: 'Resistor', revision: '1', choice: { mode: 'create', spec } }],
  lots: [],
  observations: [category],
} as unknown as CaptureSnapshotDto

describe('captureEditorChange', () => {
  it('keeps a Part’s description, which the editor does not show, when it saves the spec', () => {
    const values = { ...captureEditorDefaults(batch, partId), label: 'Resistor, carbon' }
    const change = captureEditorChange(batch, partId, values)

    expect(change).toMatchObject({
      kind: 'part',
      label: 'Resistor, carbon',
      choice: {
        mode: 'create',
        spec: { name: 'Carbon film resistor', description: 'Axial, 1/4 W' },
      },
    })
  })
})
