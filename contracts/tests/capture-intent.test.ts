import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  captureIntentFromLegacy,
  effectiveSettingsIntent,
  legacyContextFromIntent,
  validate,
  type CaptureContextDto,
  type CaptureSnapshotDto,
} from '../src/index.ts'

const legacy = JSON.parse(
  readFileSync(new URL('./fixtures/legacy-capture-snapshot.json', import.meta.url), 'utf8'),
) as CaptureSnapshotDto

const supplierRef = {
  observation_id: '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e20',
  target_context_id: '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03',
  model: 'company',
  pk: '9007199254740993',
}
const draftId = '7d1c3e9a-8b2f-4c6d-9e0a-1b2c3d4e5f60'
const intent = {
  supplier: { absent: false, selection: { mode: 'draft', draft_id: draftId } },
  order: {
    reference: { mode: 'manual', value: 'PO-0042 ' },
    purchase_date: { mode: 'auto' },
  },
  shared_tags: { manual: ['incoming'], auto: true },
}
const batchSettings = {
  expected_revision: '9007199254740995',
  change: {
    kind: 'batch_settings',
    title: 'Reel intake',
    default_location: { mode: 'unset' },
    intent,
    notes: { batch: 'Line one\nLine two', order: null },
    drafts: [
      {
        draft_id: draftId,
        kind: 'company',
        value: {
          name: 'New Supplier Pty',
          description: '',
          also_manufacturer: true,
          logo: null,
        },
      },
    ],
  },
}

test('legacy snapshot baseline still validates and maps to explicit intent without inventing data', () => {
  validate('CaptureSnapshot', legacy)
  assert.equal(legacy.settings_intent, undefined)
  assert.deepEqual(effectiveSettingsIntent(legacy), {
    supplier: { absent: false, selection: { mode: 'existing', reference: supplierRef } },
    order: {
      reference: { mode: 'auto' },
      purchase_date: { mode: 'manual', value: '2026-02-28' },
    },
    shared_tags: { manual: ['incoming', 'Bench A'], auto: false },
  })
})

test('legacy clear, unknown and unset modes keep distinct meaning in intent', () => {
  const cleared: CaptureContextDto = {
    supplier: { mode: 'clear' },
    purchase_date: { mode: 'clear' },
    tags: { mode: 'clear' },
  }
  assert.deepEqual(captureIntentFromLegacy(cleared), {
    supplier: { absent: true, selection: { mode: 'unset' } },
    order: { reference: { mode: 'auto' }, purchase_date: { mode: 'none' } },
    shared_tags: { manual: [], auto: false },
  })
  const unknown: CaptureContextDto = {
    supplier: { mode: 'unknown' },
    purchase_date: { mode: 'unknown' },
    tags: { mode: 'unknown' },
  }
  assert.deepEqual(captureIntentFromLegacy(unknown), captureIntentFromLegacy(undefined))
  assert.deepEqual(captureIntentFromLegacy(undefined), {
    supplier: { absent: false, selection: { mode: 'unset' } },
    order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
    shared_tags: { manual: [], auto: false },
  })
})

test('derived legacy context keeps Processing inputs for every intent choice', () => {
  validate('CaptureSettingsIntent', intent)
  assert.deepEqual(legacyContextFromIntent(intent as never), {
    supplier: { mode: 'unknown' },
    purchase_date: { mode: 'unset' },
    tags: { mode: 'set', value: ['incoming'] },
  })
  const absent = {
    ...intent,
    supplier: { absent: true, selection: { mode: 'existing', reference: supplierRef } },
    order: { reference: { mode: 'none' }, purchase_date: { mode: 'manual', value: '2026-11-03' } },
    shared_tags: { manual: [], auto: false },
  }
  assert.deepEqual(legacyContextFromIntent(absent as never), {
    supplier: { mode: 'clear' },
    purchase_date: { mode: 'set', value: '2026-11-03' },
    tags: { mode: 'unset' },
  })
  const existing = { ...absent, supplier: { ...absent.supplier, absent: false } }
  assert.deepEqual(legacyContextFromIntent(existing as never).supplier, {
    mode: 'set',
    value: supplierRef,
  })
})

test('complete batch settings accept new intent and retain exact manual text', () => {
  validate('CaptureEdit', batchSettings)
  validate('CaptureEdit', {
    ...batchSettings,
    change: {
      ...batchSettings.change,
      default_location: { mode: 'draft', draft_id: draftId },
      drafts: [
        {
          draft_id: draftId,
          kind: 'location',
          value: {
            name: 'Incoming inspection drawer',
            description: 'Top shelf',
            parent: {
              observation_id: '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e21',
              target_context_id: '0b6f9a52-4e1d-4c1a-9f65-1a2b3c4d5e03',
              model: 'location',
              pk: '9007199254740994',
            },
          },
        },
      ],
    },
  })
})

test('batch settings refuse quantity mode, PO intent and malformed or cross-kind drafts', () => {
  const company = batchSettings.change.drafts[0]
  const invalid = [
    { ...batchSettings.change, quantity: { mode: 'set', value: '1' } },
    { ...batchSettings.change, create_purchase_order: true },
    { ...batchSettings.change, default_location: { mode: 'inherit' } },
    { ...batchSettings.change, notes: { batch: '', order: null } },
    { ...batchSettings.change, notes: { batch: 'x'.repeat(8193), order: null } },
    {
      ...batchSettings.change,
      intent: { ...intent, order: { ...intent.order, reference: { mode: 'manual', value: '' } } },
    },
    {
      ...batchSettings.change,
      intent: {
        ...intent,
        order: { ...intent.order, reference: { mode: 'manual', value: 'x'.repeat(129) } },
      },
    },
    {
      ...batchSettings.change,
      intent: {
        ...intent,
        order: { ...intent.order, purchase_date: { mode: 'manual', value: '2026-11-3' } },
      },
    },
    { ...batchSettings.change, intent: { ...intent, shared_tags: { manual: [], auto: 'yes' } } },
    {
      ...batchSettings.change,
      intent: {
        ...intent,
        supplier: {
          absent: false,
          selection: { mode: 'existing', reference: { ...supplierRef, model: 'location' } },
        },
      },
    },
    {
      ...batchSettings.change,
      drafts: [{ ...company, value: { ...company.value, parent: null } }],
    },
    {
      ...batchSettings.change,
      drafts: [{ ...company, value: { ...company.value, name: '' } }],
    },
    {
      ...batchSettings.change,
      drafts: [{ ...company, value: { ...company.value, description: 'x'.repeat(251) } }],
    },
    {
      ...batchSettings.change,
      drafts: Array.from({ length: 17 }, (_, index) => ({
        ...company,
        draft_id: `7d1c3e9a-8b2f-4c6d-9e0a-1b2c3d4e5f${String(index).padStart(2, '0')}`,
      })),
    },
  ]
  for (const change of invalid) {
    assert.throws(() => validate('CaptureEdit', { expected_revision: '1', change }))
  }
})

test('snapshot exposes retained intent, current notes and drafts only as optional fields', () => {
  const actor = legacy.actor_id
  validate('CaptureSnapshot', {
    ...legacy,
    settings_intent: {
      version: '9007199254740996',
      value: intent,
      default_location_draft: null,
      actor_id: actor,
      created_at: '2026-11-04T00:00:00.000Z',
    },
    setting_notes: [
      {
        scope: 'batch',
        version: '9007199254740996',
        text: null,
        actor_id: actor,
        created_at: '2026-11-04T00:00:00.000Z',
      },
    ],
    reference_drafts: [
      {
        ...batchSettings.change.drafts[0],
        version: '9007199254740996',
        actor_id: actor,
        created_at: '2026-11-04T00:00:00.000Z',
      },
    ],
  })
})

test('unrelated intent saves keep retained legacy modes; only changed fields are rederived', async () => {
  const { nextLegacyContext } = await import('../src/index.ts')
  const current: CaptureContextDto = {
    supplier: { mode: 'unknown' },
    purchase_date: { mode: 'unknown' },
    tags: { mode: 'clear' },
  }
  const previous = captureIntentFromLegacy(current)
  assert.deepEqual(nextLegacyContext(current, previous, previous), current)
  const tagsChanged = {
    ...previous,
    shared_tags: { manual: ['reel'], auto: true },
  }
  assert.deepEqual(nextLegacyContext(current, previous, tagsChanged), {
    supplier: { mode: 'unknown' },
    purchase_date: { mode: 'unknown' },
    tags: { mode: 'set', value: ['reel'] },
  })
  const autoOnly = { ...previous, shared_tags: { manual: [], auto: true } }
  assert.deepEqual(
    nextLegacyContext(current, previous, autoOnly),
    current,
    'Auto alone is not legacy context',
  )
  assert.equal(nextLegacyContext(undefined, previous, previous), undefined, 'no row is invented')
  const reordered = JSON.parse(
    '{"shared_tags":{"auto":false,"manual":[]},"order":{"purchase_date":{"mode":"auto"},"reference":{"mode":"auto"}},"supplier":{"selection":{"mode":"unset"},"absent":false}}',
  )
  assert.deepEqual(
    nextLegacyContext(current, previous, reordered),
    current,
    'reordered but unchanged intent keys keep retained modes',
  )
})
