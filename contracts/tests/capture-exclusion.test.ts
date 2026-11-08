import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate, type CaptureSnapshotDto } from '../src/index.ts'

const legacy = JSON.parse(
  readFileSync(new URL('./fixtures/legacy-capture-snapshot.json', import.meta.url), 'utf8'),
) as CaptureSnapshotDto
const lotId = legacy.lots[0].id

test('a lot is excluded with a reason and included again', () => {
  const edit = (change: unknown) => ({ expected_revision: '1', change })
  validate('CaptureEdit', edit({ kind: 'lot_exclusion', lot_id: lotId, reason: 'Damaged leads' }))
  validate('CaptureEdit', edit({ kind: 'lot_exclusion', lot_id: lotId, reason: null }))
  for (const change of [
    { kind: 'lot_exclusion', lot_id: lotId },
    { kind: 'lot_exclusion', lot_id: lotId, reason: '' },
    { kind: 'lot_exclusion', lot_id: lotId, reason: 'x'.repeat(501) },
    { kind: 'lot_exclusion', lot_id: lotId, reason: 'Two\nlines' },
    { kind: 'lot_exclusion', lot_id: 'not-an-id', reason: 'Damaged' },
  ]) {
    assert.throws(() => validate('CaptureEdit', edit(change)), JSON.stringify(change))
  }
})

test('an excluded lot carries its reason, and an older snapshot without it stays readable', () => {
  validate('CaptureSnapshot', legacy)
  const excluded = {
    ...legacy,
    lots: [
      { ...legacy.lots[0], excluded: { reason: 'Damaged leads', at: '2026-11-08T05:00:00.000Z' } },
    ],
  }
  validate('CaptureSnapshot', excluded)
  assert.throws(() =>
    validate('CaptureSnapshot', {
      ...legacy,
      lots: [{ ...legacy.lots[0], excluded: { reason: '', at: '2026-11-08T05:00:00.000Z' } }],
    }),
  )
})
