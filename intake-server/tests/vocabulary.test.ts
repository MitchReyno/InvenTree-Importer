import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CaptureObservationDto } from '@invimport/contracts'
import { catalogueVocabulary } from '#/processing/vocabulary.ts'

const context = '7c3e1d04-92ab-4f6e-b81d-000000000001'
const earlier = '7c3e1d04-92ab-4f6e-b81d-000000000002'

function observation(
  id: number,
  model: CaptureObservationDto['model'],
  label: string,
  targetContextId = context,
): CaptureObservationDto {
  return {
    id: `7c3e1d04-92ab-4f6e-b81d-${id.toString(16).padStart(12, '0')}`,
    model,
    pk: String(id),
    target_context_id: targetContextId,
    label,
    observed_at: '2026-11-26T01:02:03.000Z',
  }
}

test('the vocabulary is the current context’s catalogue records, by kind then label', () => {
  const entries = catalogueVocabulary(
    [
      observation(10, 'company', 'Diodes Incorporated'),
      observation(11, 'category', 'Rectifiers'),
      observation(12, 'category', 'Diodes'),
      observation(13, 'parameter_template', 'Forward Voltage'),
      // A Part or a location is not vocabulary.
      observation(14, 'part', '1N4148'),
      observation(15, 'location', 'Drawer 3'),
      // A record read in an earlier target context can't be cited.
      observation(16, 'category', 'Diodes', earlier),
    ],
    context,
  )
  assert.deepEqual(
    entries.map((entry) => [entry.reference.model, entry.label, entry.reference.pk]),
    [
      ['category', 'Diodes', '12'],
      ['category', 'Rectifiers', '11'],
      ['parameter_template', 'Forward Voltage', '13'],
      ['company', 'Diodes Incorporated', '10'],
    ],
  )
  assert.ok(entries.every((entry) => entry.reference.target_context_id === context))
})
