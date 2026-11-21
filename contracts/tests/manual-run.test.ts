import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const id = '00000000-0000-4000-8000-000000000001'
const run = {
  run_id: id,
  approval_id: id,
  preparation_id: id,
  batch_id: id,
  revision: '1',
  round_number: '1',
  state: 'settled_complete',
  effect_certainty: 'confirmed',
  confirmed_stock_ids: ['7101'],
  attributed_stock_ids: ['7101'],
  cancellation_requested: false,
  dispatch_state: 'finished',
  operations: [],
  cursor: { stream_id: id, sequence: '1' },
}

test('a run may carry when it was approved, and runs read before that stay valid', () => {
  validate('ManualRun', run)
  validate('ManualRun', { ...run, approved_at: '2026-11-08T09:42:00.000Z' })
  for (const approved_at of ['', 'yesterday', null]) {
    assert.throws(() => validate('ManualRun', { ...run, approved_at }))
  }
})
