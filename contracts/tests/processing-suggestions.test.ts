import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = (n: number) => `0b6f9a52-4e1d-4c1a-9f65-${n.toString(16).padStart(12, '0')}`
const digest = 'a'.repeat(64)
const binding = {
  schema_version: 'bench-intake-runner/2',
  job_id: id(1),
  attempt_id: id(2),
  command_id: id(3),
  input_sha256: digest,
  profile_id: 'synthetic-research/2',
  handler_version: 'processing/2',
  sequence: '1',
}
const proposal = {
  schema_version: 'bench-intake-proposal/4',
  subject_id: id(4),
  summary: 'Two full reels visible on the label photo.',
  sources: [{ kind: 'media_version', evidence_id: id(5), version_id: id(6), sha256: digest }],
}

test('a synthetic proposal can carry an evidence-bound estimated quantity and tag suggestions', () => {
  validate('ProcessingEnvelope', {
    ...binding,
    kind: 'proposal',
    payload: { ...proposal, quantity: { value: '40', status: 'estimated' }, tags: ['smd', '0603'] },
  })
  validate('ProcessingEnvelope', { ...binding, kind: 'proposal', payload: proposal })
})

test('a suggestion cannot claim a counted quantity, omit evidence or ride an older runner', () => {
  assert.throws(() =>
    validate('ProcessingEnvelope', {
      ...binding,
      kind: 'proposal',
      payload: { ...proposal, quantity: { value: '40', status: 'counted' } },
    }),
  )
  assert.throws(() =>
    validate('ProcessingEnvelope', {
      ...binding,
      kind: 'proposal',
      payload: { ...proposal, sources: [] },
    }),
  )
  assert.throws(() =>
    validate('ProcessingEnvelope', {
      ...binding,
      schema_version: 'bench-intake-runner/4',
      profile_id: 'native-agent/1',
      handler_version: 'processing/4',
      kind: 'proposal',
      payload: { ...proposal, quantity: { value: '40', status: 'estimated' } },
    }),
  )
})
