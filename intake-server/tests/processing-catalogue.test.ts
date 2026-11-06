import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CaptureObservationDto, CatalogueProposalDto } from '@invimport/contracts'
import { applicableCatalogueSpec, assessCatalogue } from '../src/processing/catalogue.ts'
import { validatePartSpec } from '../src/capture/part-spec.ts'

const id = (n: number) => `5d2a8f71-0c3b-4e9a-a6d4-${n.toString(16).padStart(12, '0')}`
const context = id(900)
const source = { kind: 'note', note_id: id(800), text_sha256: 'e'.repeat(64) } as const
const sources = [source]
const observed = (
  n: number,
  model: CaptureObservationDto['model'],
  mapping: CaptureObservationDto['mapping'],
  pk: string,
): CaptureObservationDto => ({
  id: id(n),
  model,
  mapping,
  pk,
  target_context_id: context,
  label: `observed ${n}`,
  observed_at: '2026-11-06T01:00:00Z',
})
const observations = [
  observed(1, 'category', { kind: 'category' }, '31'),
  observed(
    2,
    'parameter_template',
    { kind: 'parameter_template', model_type: 'part.part', enabled: true },
    '57',
  ),
  observed(
    3,
    'category_parameter',
    { kind: 'category_parameter', category_id: '31', template_id: '57' },
    '203',
  ),
  observed(4, 'company', { kind: 'company', manufacturer: true, supplier: false }, '12'),
  observed(5, 'company', { kind: 'company', manufacturer: false, supplier: true }, '19'),
  observed(
    6,
    'parameter_template',
    { kind: 'parameter_template', model_type: 'part.part', enabled: false },
    '58',
  ),
  observed(
    7,
    'category_parameter',
    { kind: 'category_parameter', category_id: '44', template_id: '57' },
    '204',
  ),
]
const ref = <M extends 'category' | 'parameter_template' | 'category_parameter' | 'company'>(
  n: number,
  model: M,
  pk: string,
) => ({ observation_id: id(n), target_context_id: context, model, pk })

const applicable: CatalogueProposalDto = {
  category: { choice: 'existing', reference: ref(1, 'category', '31'), sources },
  parameters: [
    {
      name: 'Resistance',
      value: '1k',
      template: ref(2, 'parameter_template', '57'),
      category_mapping: ref(3, 'category_parameter', '203'),
      sources,
    },
  ],
  manufacturer: {
    company: { choice: 'existing', reference: ref(4, 'company', '12'), sources },
    mpn: 'RC0603FR-071KL',
    sources,
  },
  supplier: {
    company: { choice: 'existing', reference: ref(5, 'company', '19'), sources },
    sku: '311-1.00KHRCT-ND',
    price: null,
    sources,
  },
  description: null,
}

const byPath = (catalogue: CatalogueProposalDto) =>
  Object.fromEntries(
    assessCatalogue(catalogue, context, observations).map((item) => [
      item.path,
      item.status === 'applicable' ? 'applicable' : item.reason,
    ]),
  )

test('observed mapped references are applicable as they stand', () => {
  assert.deepEqual(byPath(applicable), {
    category: 'applicable',
    'parameters.0': 'applicable',
    manufacturer: 'applicable',
    supplier: 'applicable',
  })
  assert.deepEqual(
    byPath({
      category: null,
      parameters: [],
      manufacturer: null,
      supplier: null,
      description: null,
    }),
    {},
  )
})

test('values a Part spec cannot hold yet are kept and flagged with a reason', () => {
  assert.deepEqual(
    byPath({
      category: { choice: 'proposed_new', name: 'Thick film', reason: 'Not in the tree.', sources },
      parameters: [
        { name: 'Tolerance', value: '1%', template: null, category_mapping: null, sources },
        {
          name: 'Resistance',
          value: '1k',
          template: ref(2, 'parameter_template', '57'),
          category_mapping: null,
          sources,
        },
      ],
      manufacturer: {
        company: { choice: 'proposed_new', name: 'Yageo', reason: 'Logo on the reel.', sources },
        mpn: 'RC0603FR-071KL',
        sources,
      },
      supplier: {
        company: { choice: 'proposed_new', name: 'Local shop', reason: 'Receipt header.', sources },
        sku: null,
        price: { amount: '0.0123', currency: 'AUD' },
        sources,
      },
      description: { text: 'Thick film resistor, 0603, 1%.', sources },
    }),
    {
      category: 'new_category',
      'parameters.0': 'new_parameter_template',
      'parameters.1': 'parameter_mapping_missing',
      manufacturer: 'new_manufacturer',
      supplier: 'new_supplier',
      'supplier.price': 'supplier_price_unsupported',
      description: 'description_unsupported',
    },
  )
})

test('references that fail Part spec checks are unsupported, not silently applied', () => {
  assert.deepEqual(
    byPath({
      ...applicable,
      category: { choice: 'existing', reference: ref(1, 'category', '32'), sources },
      parameters: [
        {
          name: 'Resistance',
          value: '1k',
          template: ref(6, 'parameter_template', '58'),
          category_mapping: ref(3, 'category_parameter', '203'),
          sources,
        },
      ],
      manufacturer: {
        company: { choice: 'existing', reference: ref(5, 'company', '19'), sources },
        mpn: 'X',
        sources,
      },
      supplier: {
        company: { choice: 'existing', reference: ref(5, 'company', '19'), sources },
        sku: null,
        price: null,
        sources,
      },
    }),
    {
      category: 'mapping_observation_invalid',
      'parameters.0': 'category_not_applicable',
      manufacturer: 'company_role_incompatible',
      supplier: 'supplier_sku_missing',
    },
  )
  assert.deepEqual(
    byPath({
      ...applicable,
      parameters: [
        {
          name: 'Resistance',
          value: '1k',
          template: ref(6, 'parameter_template', '58'),
          category_mapping: ref(3, 'category_parameter', '203'),
          sources,
        },
        {
          name: 'Resistance',
          value: '1k',
          template: ref(2, 'parameter_template', '57'),
          category_mapping: ref(7, 'category_parameter', '204'),
          sources,
        },
        {
          name: 'Power',
          value: '0.1W',
          template: { ...ref(2, 'parameter_template', '57'), target_context_id: id(901) },
          category_mapping: ref(3, 'category_parameter', '203'),
          sources,
        },
      ],
    }),
    {
      category: 'applicable',
      'parameters.0': 'parameter_category_incompatible',
      'parameters.1': 'parameter_category_incompatible',
      'parameters.2': 'mapping_observation_invalid',
      manufacturer: 'applicable',
      supplier: 'applicable',
    },
  )
})

test('an existing manufacturer with its MPN applies cleanly through validatePartSpec', () => {
  const spec = applicableCatalogueSpec(applicable, context, observations, {
    name: 'RC0603 1k',
    tags: [],
  })
  assert.ok(spec)
  assert.doesNotThrow(() => validatePartSpec(spec, context, observations))
  assert.deepEqual(spec.manufacturer, {
    company: ref(4, 'company', '12'),
    mpn: 'RC0603FR-071KL',
  })
  // A parameter carries both its template and the category's mapping for it.
  assert.deepEqual(spec.parameters, [
    {
      template: ref(2, 'parameter_template', '57'),
      category_mapping: ref(3, 'category_parameter', '203'),
      value: '1k',
    },
  ])
})

test('unsupported catalogue values stay in the proposal and never reach a Part spec', () => {
  const newCategory: CatalogueProposalDto = {
    ...applicable,
    category: {
      choice: 'proposed_new',
      name: 'Precision resistors',
      reason: 'Tighter tolerance',
      sources,
    },
  }
  assert.equal(
    applicableCatalogueSpec(newCategory, context, observations, { name: 'x', tags: [] }),
    null,
  )

  const mixed: CatalogueProposalDto = {
    ...applicable,
    parameters: [
      ...applicable.parameters,
      { name: 'Power', value: '0.1W', template: null, category_mapping: null, sources },
      {
        name: 'Tolerance',
        value: '1%',
        template: ref(2, 'parameter_template', '57'),
        category_mapping: null,
        sources,
      },
    ],
    manufacturer: {
      company: { choice: 'proposed_new', name: 'Yageo', reason: 'Not on the server', sources },
      mpn: 'RC0603FR-071KL',
      sources,
    },
    supplier: {
      ...applicable.supplier!,
      price: { amount: '0.10', currency: 'USD' },
    },
  }
  const spec = applicableCatalogueSpec(mixed, context, observations, { name: 'x', tags: [] })
  assert.ok(spec)
  assert.doesNotThrow(() => validatePartSpec(spec, context, observations))
  assert.equal(spec.manufacturer, null)
  assert.equal(spec.parameters.length, 1)
  assert.equal('price' in spec.supplier!, false)
})
