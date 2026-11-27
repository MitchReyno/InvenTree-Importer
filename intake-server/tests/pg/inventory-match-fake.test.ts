import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { isolatedDatabase } from '../support/database.ts'
import { inventoryFake } from '../fixtures/inventory-fake.ts'
import { inventoryTransport } from '#/inventory/transport.ts'
import { matchReader, type MatchReader } from '#/inventory/match-reads.ts'

const BINDING = { targetId: 'target-match-pg', contextId: 'context-match-pg' }
const CONTEXT = '3a9c1e7b-5d2f-4b8a-9c6e-0f1a2b3c4d5e'
const NSN = 'nsn:5961-01-123-4567'
const OVER_BOUND_CATEGORY = 95

let db: Awaited<ReturnType<typeof isolatedDatabase>>
let fake: Awaited<ReturnType<typeof inventoryFake>>
let reader: MatchReader

function readerFor(origin: string) {
  const transport = inventoryTransport({
    kind: 'protected-read-only',
    origin,
    targetId: BINDING.targetId,
    contextId: BINDING.contextId,
    protectedOrigins: [origin],
    credential: 'fake-only',
  })
  return matchReader({
    matchList: (operation, timeoutMs) => transport.matchList(BINDING, operation, timeoutMs),
    read: (operation) => transport.read(BINDING, operation),
    targetContextId: CONTEXT,
  })
}

before(async () => {
  db = await isolatedDatabase({ migrate: false })
  fake = await inventoryFake(db.pool)
  const overBound = Array.from({ length: 101 }, (_, index) => ({
    pk: 5001 + index,
    category: OVER_BOUND_CATEGORY,
    template: 6001 + index,
  }))
  await fake.seedMatch({
    categories: [
      { pk: 80, name: 'Passives' },
      { pk: 81, name: 'Resistors', parent: 80 },
      { pk: 90, name: 'Semiconductors' },
      { pk: OVER_BOUND_CATEGORY, name: 'Crowded' },
    ],
    parts: [
      {
        pk: 12,
        name: 'Resistor 10k',
        ipn: 'R-10K',
        category: 81,
        image: '/media/part_images/r.png',
      },
      { pk: 13, name: 'Resistor 10k tight', ipn: '', category: 81, variant_of: 12 },
      { pk: 14, name: 'Diode 1N4148', category: 90, active: false },
    ],
    manufacturerParts: [
      { pk: 501, part: 12, mpn: 'RC0805FR-0710KL', manufacturer: 61, manufacturer_name: 'Yageo' },
      { pk: 502, part: 14, mpn: 'RC0805FR-0710KLX', manufacturer: 61, manufacturer_name: 'Yageo' },
    ],
    supplierParts: [
      { pk: 701, part: 12, sku: '311-10.0KCRCT-ND', supplier: 602, supplier_name: 'DigiKey' },
    ],
    stock: [
      { pk: 9001, part: 12, batch: 'B7', quantity: '500.0' },
      { pk: 9002, part: 13, batch: 'B7', quantity: '25' },
      { pk: 9003, part: 14, quantity: '0.5', tags: [NSN, 'bench'] },
    ],
    parameters: [
      { pk: 3001, model_type: 'part', model_id: 12, template: 201, data: '10k' },
      { pk: 3002, model_type: 'company', model_id: 12, template: 201, data: 'not a Part' },
    ],
    attachments: [
      { pk: 4001, model_type: 'part', model_id: 12, link: 'https://example.test/r.pdf' },
      { pk: 4002, model_type: 'stockitem', model_id: 12, attachment: '/media/attachments/s.pdf' },
    ],
    categoryParameters: [
      { pk: 311, category: 81, template: 201 },
      { pk: 312, category: 80, template: 202, default_value: '1%' },
      { pk: 313, category: 90, template: 203 },
      ...overBound,
    ],
  })
  reader = readerFor(fake.origin)
})

after(async () => {
  await fake?.close()
  await db?.dispose()
})

test('a Part and its variant sharing a batch code: only the Part stock is read', async () => {
  const result = await reader.list({
    kind: 'list_stock',
    part: '12',
    batch: 'B7',
    limit: 20,
    offset: 0,
  })
  assert.deepEqual(result, {
    kind: 'found',
    count: 1,
    rows: [
      {
        pk: '9001',
        part: '12',
        batch: 'B7',
        quantity: '500',
        part_detail: {
          pk: '12',
          name: 'Resistor 10k',
          IPN: 'R-10K',
          has_image: true,
          active: true,
        },
      },
    ],
  })
  // Control: the fake includes variants when asked, so the filter above is what excluded 9002.
  const withVariants = await fetch(`${fake.origin}/api/stock/?part=12&batch=B7&limit=20&offset=0`)
  const body = (await withVariants.json()) as { results: { pk: number }[] }
  assert.deepEqual(
    body.results.map((row) => row.pk),
    [9001, 9002],
  )
})

test('stock is found by its NSN tag alone', async () => {
  const result = await reader.list({ kind: 'list_stock', nsn_tag: NSN, limit: 20, offset: 0 })
  assert.equal(result.kind, 'found')
  assert.deepEqual(
    result.kind === 'found' ? result.rows.map((row) => [row.pk, row.batch, row.quantity]) : [],
    [['9003', null, '0.5']],
  )
})

test('Part-scoped reads return only the Part rows, not another model with the same id', async () => {
  const parameters = await reader.list({
    kind: 'list_part_parameters',
    part: '12',
    limit: 100,
    offset: 0,
  })
  assert.deepEqual(parameters, {
    kind: 'found',
    count: 1,
    rows: [{ pk: '3001', template: '201', data: '10k', model_id: '12' }],
  })
  const attachments = await reader.list({
    kind: 'list_part_attachments',
    part: '12',
    limit: 100,
    offset: 0,
  })
  assert.deepEqual(attachments, {
    kind: 'found',
    count: 1,
    rows: [
      {
        pk: '4001',
        attachment: null,
        link: 'https://example.test/r.pdf',
        comment: '',
        model_id: '12',
      },
    ],
  })
})

test('category mappings cover the category and its ancestors, or every mapping when unknown', async () => {
  const known = await reader.list({ kind: 'list_category_parameters', category: '81' })
  assert.deepEqual(known, {
    kind: 'found',
    count: 2,
    rows: [
      { pk: '311', category: '81', template: '201', default_value: '' },
      { pk: '312', category: '80', template: '202', default_value: '1%' },
    ],
  })
  const unrelated = await reader.list({ kind: 'list_category_parameters', category: '90' })
  assert.deepEqual(unrelated.kind === 'found' ? unrelated.rows.map((row) => row.pk) : [], ['313'])
  // InvenTree skips an unknown category's filter, so the caller must filter locally.
  const unknown = await fetch(
    `${fake.origin}/api/part/category/parameters/?category=999&limit=200&offset=0`,
  )
  const all = (await unknown.json()) as { count: number }
  assert.equal(all.count, 104)
  assert.deepEqual(await reader.list({ kind: 'list_category_parameters', category: '999' }), {
    kind: 'unavailable',
    reason: 'over_bound',
  })
  assert.deepEqual(
    await reader.list({ kind: 'list_category_parameters', category: String(OVER_BOUND_CATEGORY) }),
    { kind: 'unavailable', reason: 'over_bound' },
  )
})

test('Part search, manufacturer and supplier parts read through the real transport', async () => {
  const search = await reader.list({ kind: 'search_parts', search: 'r-10', limit: 1, offset: 0 })
  assert.deepEqual(search, {
    kind: 'found',
    count: 1,
    rows: [
      {
        pk: '12',
        name: 'Resistor 10k',
        IPN: 'R-10K',
        category: '81',
        has_image: true,
        active: true,
        variant_of: null,
      },
    ],
  })
  const paged = await reader.list({ kind: 'search_parts', search: 'resistor', limit: 1, offset: 1 })
  assert.deepEqual(paged.kind === 'found' ? [paged.count, paged.rows.map((row) => row.pk)] : [], [
    2,
    ['13'],
  ])
  const manufacturer = await reader.list({
    kind: 'list_manufacturer_parts',
    mpn: 'RC0805FR-0710KL',
    limit: 10,
    offset: 0,
  })
  assert.deepEqual(
    manufacturer.kind === 'found'
      ? manufacturer.rows.map((row) => [row.pk, row.manufacturer_name, row.part_detail.name])
      : [],
    [['501', 'Yageo', 'Resistor 10k']],
    'MPN is an exact filter, not a prefix match',
  )
  const supplier = await reader.list({
    kind: 'list_supplier_parts',
    supplier: '602',
    limit: 10,
    offset: 0,
  })
  assert.deepEqual(
    supplier.kind === 'found'
      ? supplier.rows.map((row) => [row.pk, row.SKU, row.supplier_name])
      : [],
    [['701', '311-10.0KCRCT-ND', 'DigiKey']],
  )
})

test('seeded single records are served, and unseeded ones keep the existing answers', async () => {
  assert.deepEqual(await reader.part('13'), {
    kind: 'found',
    value: {
      pk: '13',
      name: 'Resistor 10k tight',
      IPN: null,
      category: '81',
      has_image: false,
      active: true,
      variant_of: '12',
    },
  })
  assert.deepEqual(await reader.category('81'), {
    kind: 'found',
    value: { pk: '81', name: 'Resistors', parent: '80' },
  })
  assert.deepEqual(await reader.category('999'), { kind: 'not_found' })
  const unseeded = await fetch(`${fake.origin}/api/part/77/`)
  assert.deepEqual(await unseeded.json(), { pk: '77' })
  const probe = await fetch(`${fake.origin}/api/part/?limit=1`)
  assert.deepEqual(await probe.json(), {
    count: 1,
    next: null,
    previous: null,
    results: [{ pk: 29, name: 'Existing Part 29' }],
  })
  const recorded = (await fake.records()).map((row) => `${row.method} ${row.path}`)
  assert.ok(recorded.includes('GET /api/part/13/'))
  assert.ok(recorded.includes('GET /api/part/category/parameters/?category=81&limit=100&offset=0'))
})

test('a read fault makes Match reads unavailable, not empty', async () => {
  await fake.fault('read_unavailable')
  try {
    assert.deepEqual(await reader.list({ kind: 'list_stock', part: '12', limit: 1, offset: 0 }), {
      kind: 'unavailable',
      reason: 'status',
    })
  } finally {
    await fake.fault('none')
  }
})

test('without its Match tables, as the dev fake runs, a list answers an empty page', async () => {
  await fake.close()
  await db.pool
    .query(`DROP TABLE fake_match_part, fake_match_manufacturer_part, fake_match_supplier_part,
    fake_match_stock, fake_match_parameter, fake_match_attachment, fake_match_category,
    fake_match_category_parameter`)
  fake = await inventoryFake(db.pool, 0, true, true, true, false)
  const devReader = readerFor(fake.origin)
  assert.deepEqual(await devReader.list({ kind: 'list_stock', part: '12', limit: 20, offset: 0 }), {
    kind: 'found',
    count: 0,
    rows: [],
  })
  const created = await db.pool.query("SELECT to_regclass('fake_match_stock') AS present")
  assert.equal(created.rows[0].present, null, 'an uninitialized fake creates no tables')
})
