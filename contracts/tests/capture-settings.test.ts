import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'

const context = {
  supplier: { mode: 'unset' },
  purchase_date: { mode: 'set', value: '2026-11-03' },
  tags: { mode: 'set', value: ['incoming', 'bench'] },
}
const settings = {
  expected_revision: '9007199254740993',
  change: {
    kind: 'settings',
    title: 'Separate packets',
    quantity: { mode: 'set', value: '9007199254740.123456' },
    location: { mode: 'clear' },
    context,
    note: 'Keep separate physical lots.',
  },
}

test('composite settings preserve exact quantities, calendar dates and context modes', () => {
  validate('CaptureEdit', settings)
  validate('CaptureEdit', {
    expected_revision: '1',
    change: {
      kind: 'lot',
      id: '00000000-0000-4000-8000-000000000001',
      context: {
        supplier: { mode: 'inherit' },
        purchase_date: { mode: 'clear' },
        tags: { mode: 'unknown' },
      },
    },
  })
})

test('settings reject PO intent, duplicate tags, malformed dates and coerced exact values', () => {
  for (const change of [
    { ...settings.change, create_purchase_order: true },
    { ...settings.change, quantity: { mode: 'set', value: 1 } },
    { ...settings.change, context: { ...context, tags: { mode: 'set', value: ['x', 'x'] } } },
    {
      ...settings.change,
      context: { ...context, purchase_date: { mode: 'set', value: '03/11/2026' } },
    },
    { ...settings.change, context: { ...context, supplier: { mode: 'inherit' } } },
  ]) {
    assert.throws(() => validate('CaptureEdit', { expected_revision: '1', change }))
  }
})

test('batch context rejects excessive tag counts and long tag values', () => {
  for (const value of [
    Array.from({ length: 33 }, (_, index) => `tag-${index}`),
    ['x'.repeat(101)],
  ]) {
    assert.throws(() =>
      validate('CaptureEdit', {
        expected_revision: '1',
        change: { kind: 'settings', context: { ...context, tags: { mode: 'set', value } } },
      }),
    )
  }
})

test('calendar-date shape refuses year zero and trailing whitespace', () => {
  for (const value of ['0000-01-01', '2026-11-03\n']) {
    assert.throws(() =>
      validate('CaptureEdit', {
        expected_revision: '1',
        change: {
          kind: 'settings',
          context: { ...context, purchase_date: { mode: 'set', value } },
        },
      }),
    )
  }
})

test('composite settings retain a selected note subject without changing legacy batch-note intent', () => {
  validate('CaptureEdit', {
    ...settings,
    change: { ...settings.change, note_subject_id: '00000000-0000-4000-8000-000000000001' },
  })
})
