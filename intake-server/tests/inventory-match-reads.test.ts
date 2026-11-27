import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CATEGORY_PARAMETERS_MAX,
  InventoryTransportError,
  inventoryTransport,
  type MatchListOperation,
  type ReadOperation,
} from '#/inventory/transport.ts'
import { decimalText, matchReader } from '#/inventory/match-reads.ts'

const CONTEXT = '7d2e5b3f-0c4a-4f6e-9b8c-1d2e3f4a5b6c'
const BINDING = { targetId: 'target-match', contextId: 'context-match' }
const ORIGIN = 'http://127.0.0.1:9'
const PINNED = JSON.parse(
  readFileSync(new URL('./fixtures/inventree-1.5.0-match-filters.json', import.meta.url), 'utf8'),
) as { paths: Record<string, string[]>; undeclared: Record<string, string[]> }

function json(value: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': contentType } })
}

function page(results: unknown[], count = results.length) {
  return json({ count, next: null, previous: null, results })
}

function recordingTransport() {
  const sent: { method: string; url: string }[] = []
  const transport = inventoryTransport(
    {
      kind: 'protected-read-only',
      origin: ORIGIN,
      targetId: BINDING.targetId,
      contextId: BINDING.contextId,
      protectedOrigins: [ORIGIN],
      credential: 'fake-only',
    },
    async (input, init) => {
      sent.push({ method: init?.method ?? '', url: String(input) })
      return page([])
    },
  )
  return { transport, sent }
}

/** Every kind with the exact URL it must send; literal so the builder isn't used to check itself. */
const EXPECTED: [MatchListOperation, string][] = [
  [
    { kind: 'search_parts', search: '10k 0805', limit: 20, offset: 40 },
    '/api/part/?ordering=name&search=10k+0805&limit=20&offset=40',
  ],
  [
    {
      kind: 'list_manufacturer_parts',
      mpn: 'RC0805FR-0710KL',
      manufacturer: '61',
      part: '12',
      limit: 10,
      offset: 0,
    },
    '/api/company/part/manufacturer/?manufacturer_detail=true&part_detail=true&ordering=MPN&MPN=RC0805FR-0710KL&manufacturer=61&part=12&limit=10&offset=0',
  ],
  [
    { kind: 'list_supplier_parts', sku: '311-10.0KCRCT-ND', limit: 5, offset: 0 },
    '/api/company/part/?supplier_detail=true&part_detail=true&ordering=SKU&SKU=311-10.0KCRCT-ND&limit=5&offset=0',
  ],
  [
    {
      kind: 'list_supplier_parts',
      supplier: '602',
      part: '9223372036854775807',
      limit: 100,
      offset: 10000,
    },
    '/api/company/part/?supplier_detail=true&part_detail=true&ordering=SKU&supplier=602&part=9223372036854775807&limit=100&offset=10000',
  ],
  [
    { kind: 'list_stock', part: '12', batch: 'B-2024/07', limit: 20, offset: 0 },
    '/api/stock/?include_variants=false&part_detail=true&ordering=part&part=12&batch=B-2024%2F07&limit=20&offset=0',
  ],
  [
    { kind: 'list_stock', nsn_tag: 'nsn:5961-01-123-4567', limit: 20, offset: 0 },
    '/api/stock/?include_variants=false&part_detail=true&ordering=part&tags__name=nsn%3A5961-01-123-4567&limit=20&offset=0',
  ],
  [
    { kind: 'list_part_parameters', part: '12', limit: 100, offset: 0 },
    '/api/parameter/?model_type=part&model_id=12&ordering=template&limit=100&offset=0',
  ],
  [
    { kind: 'list_part_attachments', part: '12', limit: 50, offset: 50 },
    '/api/attachment/?model_type=part&model_id=12&ordering=upload_date&limit=50&offset=50',
  ],
  [
    { kind: 'list_category_parameters', category: '81' },
    '/api/part/category/parameters/?category=81&limit=100&offset=0',
  ],
]

test('each Match list kind sends one GET to its fixed path with fixed parameters and only its filters', async () => {
  const { transport, sent } = recordingTransport()
  for (const [operation] of EXPECTED) {
    await transport.matchList(BINDING, operation)
  }
  assert.deepEqual(
    sent,
    EXPECTED.map(([, path]) => ({ method: 'GET', url: `${ORIGIN}${path}` })),
  )
  assert.equal(CATEGORY_PARAMETERS_MAX, 100)
})

test('every parameter a Match read sends is one the pinned 1.5.0 schema names for its path', async () => {
  const { transport, sent } = recordingTransport()
  for (const [operation] of EXPECTED) {
    await transport.matchList(BINDING, operation)
  }
  assert.equal(Object.keys(PINNED.paths).length, 7)
  for (const { url } of sent) {
    const parsed = new URL(url)
    const declared = PINNED.paths[parsed.pathname]
    assert.ok(declared, `${parsed.pathname} is pinned`)
    const accepted = new Set([...declared, ...(PINNED.undeclared[parsed.pathname] ?? [])])
    for (const name of parsed.searchParams.keys()) {
      assert.ok(accepted.has(name), `${parsed.pathname} accepts ${name}`)
    }
  }
})

test('stock reads always exclude variants and Part-scoped reads name the Part model', async () => {
  const { transport, sent } = recordingTransport()
  await transport.matchList(BINDING, { kind: 'list_stock', part: '12', limit: 1, offset: 0 })
  await transport.matchList(BINDING, { kind: 'list_stock', batch: 'X', limit: 1, offset: 0 })
  await transport.matchList(BINDING, {
    kind: 'list_part_parameters',
    part: '12',
    limit: 1,
    offset: 0,
  })
  await transport.matchList(BINDING, {
    kind: 'list_part_attachments',
    part: '12',
    limit: 1,
    offset: 0,
  })
  const queries = sent.map(({ url }) => new URL(url).searchParams)
  assert.equal(queries[0].get('include_variants'), 'false')
  assert.equal(queries[1].get('include_variants'), 'false')
  for (const query of queries.slice(2)) {
    assert.equal(query.get('model_type'), 'part')
    assert.equal(query.get('model_id'), '12')
  }
})

test('category mappings are read in one bounded request without a caller page', async () => {
  const { transport, sent } = recordingTransport()
  await transport.matchList(BINDING, { kind: 'list_category_parameters', category: '81' })
  assert.equal(sent.length, 1)
  const query = new URL(sent[0].url).searchParams
  assert.equal(query.get('limit'), '100')
  assert.equal(query.get('offset'), '0')
  assert.equal(query.get('ordering'), null)
})

test('unknown kinds, unnamed filters and out-of-bound values are refused before sending', async () => {
  const { transport, sent } = recordingTransport()
  const page = { limit: 10, offset: 0 }
  const refused: unknown[] = [
    undefined,
    null,
    [],
    { kind: 'list_parts', ...page },
    { kind: 'list_locations', ...page },
    { kind: 'list_supplier_parts', sku: 'A', ordering: '-SKU', ...page },
    { kind: 'list_supplier_parts', sku: 'A', query: 'SKU=A&ordering=pk', ...page },
    { kind: 'list_supplier_parts', SKU: 'A', ...page },
    { kind: 'list_supplier_parts', ...page },
    { kind: 'list_manufacturer_parts', ...page },
    { kind: 'list_stock', ...page },
    { kind: 'list_stock', include_variants: 'true', part: '12', ...page },
    { kind: 'search_parts', ...page },
    { kind: 'search_parts', search: '', ...page },
    { kind: 'search_parts', search: 'x'.repeat(101), ...page },
    { kind: 'search_parts', search: 'tab\there', ...page },
    { kind: 'search_parts', search: 'nul\u0000', ...page },
    { kind: 'search_parts', search: 'del\u007f', ...page },
    { kind: 'list_supplier_parts', sku: 'line\nbreak', ...page },
    { kind: 'list_stock', batch: 'x'.repeat(101), ...page },
    { kind: 'list_stock', part: '0', ...page },
    { kind: 'list_stock', part: '-12', ...page },
    { kind: 'list_stock', part: '012', ...page },
    { kind: 'list_stock', part: '1.5', ...page },
    { kind: 'list_stock', part: '12abc', ...page },
    { kind: 'list_stock', part: 12, ...page },
    { kind: 'list_stock', part: '9223372036854775808', ...page },
    { kind: 'list_stock', nsn_tag: 'nsn:5961011234567', ...page },
    { kind: 'list_stock', nsn_tag: 'NSN:5961-01-123-4567', ...page },
    { kind: 'list_stock', nsn_tag: 'nsn:5961-01-123-4567 ', ...page },
    { kind: 'list_stock', nsn_tag: '5961-01-123-4567', ...page },
    { kind: 'list_part_parameters', ...page },
    { kind: 'list_part_parameters', part: '12', model_type: 'company', ...page },
    { kind: 'list_part_attachments', part: '12', model_id: '13', ...page },
    { kind: 'list_part_attachments', part: '12', limit: 101, offset: 0 },
    { kind: 'list_part_attachments', part: '12', limit: 0, offset: 0 },
    { kind: 'list_part_attachments', part: '12', limit: 10, offset: 10001 },
    { kind: 'list_part_attachments', part: '12', limit: 10, offset: -1 },
    { kind: 'list_part_attachments', part: '12', limit: 10.5, offset: 0 },
    { kind: 'list_part_attachments', part: '12', limit: '10', offset: 0 },
    { kind: 'list_part_attachments', part: '12' },
    { kind: 'list_category_parameters' },
    { kind: 'list_category_parameters', category: '81', limit: 100, offset: 0 },
    { kind: 'list_category_parameters', category: '81', offset: 100 },
  ]
  for (const operation of refused) {
    await assert.rejects(
      transport.matchList(BINDING, operation as MatchListOperation),
      /list_operation_refused/,
      JSON.stringify(operation),
    )
  }
  for (const timeoutMs of [0, 5001, 1.5]) {
    await assert.rejects(
      transport.matchList(BINDING, { kind: 'list_category_parameters', category: '81' }, timeoutMs),
      /list_operation_refused/,
    )
  }
  await assert.rejects(
    transport.matchList(
      { targetId: 'other', contextId: BINDING.contextId },
      { kind: 'list_category_parameters', category: '81' },
    ),
    /target_binding_mismatch/,
  )
  assert.equal(sent.length, 0)
  await transport.matchList(BINDING, { kind: 'list_category_parameters', category: '81' }, 1)
  assert.equal(sent.length, 1, 'a nearby valid read with a shortened timeout is sent')
})

function brief(pk: number, name: string) {
  return { pk, name, IPN: null, description: '', image: null, active: true, thumbnail: '' }
}

function stubReader(
  list: (operation: MatchListOperation, timeoutMs: number) => Promise<Response>,
  read: (operation: ReadOperation) => Promise<Response> = async () => json({}, 404),
) {
  return matchReader({ matchList: list, read, targetContextId: CONTEXT })
}

test('reader projects each kind to its typed rows', async () => {
  const responses: Record<string, Response> = {
    search_parts: page(
      [
        {
          pk: 12,
          name: 'R 10k',
          IPN: '',
          description: 'ignored',
          category: 81,
          image: '/media/part_images/r.png',
          active: true,
          variant_of: null,
          starred: false,
        },
        {
          pk: 13,
          name: 'R 10k variant',
          IPN: 'R-10K-V',
          category: null,
          image: null,
          variant_of: 12,
        },
      ],
      41,
    ),
    list_manufacturer_parts: page([
      {
        pk: 501,
        part: 12,
        MPN: 'RC0805FR-0710KL',
        manufacturer: 61,
        manufacturer_detail: { pk: 61, name: 'Yageo', image: '' },
        part_detail: brief(12, 'R 10k'),
        link: '',
      },
    ]),
    list_supplier_parts: page([
      {
        pk: 701,
        part: 12,
        SKU: '311-10.0KCRCT-ND',
        supplier: 602,
        supplier_detail: { pk: 602, name: 'DigiKey' },
        part_detail: brief(12, 'R 10k'),
      },
    ]),
    list_stock: page([{ pk: 9001, part: 12, batch: '', quantity: 500.0, part_detail: null }]),
    list_part_parameters: page([
      { pk: 3001, template: 201, model_type: 'part.part', model_id: 12, data: '' },
    ]),
    list_part_attachments: page([
      {
        pk: 4001,
        model_type: 'part',
        model_id: 12,
        attachment: null,
        link: 'https://example.test/d.pdf',
        comment: '',
      },
    ]),
    list_category_parameters: page([{ pk: 311, category: 81, template: 201, default_value: '' }]),
  }
  const reader = stubReader(async (operation) => responses[operation.kind])
  assert.deepEqual(await reader.list({ kind: 'search_parts', search: 'R', limit: 20, offset: 0 }), {
    kind: 'found',
    count: 41,
    rows: [
      {
        pk: '12',
        name: 'R 10k',
        IPN: null,
        category: '81',
        has_image: true,
        active: true,
        variant_of: null,
      },
      {
        pk: '13',
        name: 'R 10k variant',
        IPN: 'R-10K-V',
        category: null,
        has_image: false,
        active: true,
        variant_of: '12',
      },
    ],
  })
  const part = { pk: '12', name: 'R 10k', IPN: null, has_image: false, active: true }
  assert.deepEqual(
    await reader.list({ kind: 'list_manufacturer_parts', part: '12', limit: 1, offset: 0 }),
    {
      kind: 'found',
      count: 1,
      rows: [
        {
          pk: '501',
          part: '12',
          MPN: 'RC0805FR-0710KL',
          manufacturer: '61',
          manufacturer_name: 'Yageo',
          part_detail: part,
        },
      ],
    },
  )
  assert.deepEqual(
    await reader.list({ kind: 'list_supplier_parts', part: '12', limit: 1, offset: 0 }),
    {
      kind: 'found',
      count: 1,
      rows: [
        {
          pk: '701',
          part: '12',
          SKU: '311-10.0KCRCT-ND',
          supplier: '602',
          supplier_name: 'DigiKey',
          part_detail: part,
        },
      ],
    },
  )
  assert.deepEqual(await reader.list({ kind: 'list_stock', part: '12', limit: 1, offset: 0 }), {
    kind: 'found',
    count: 1,
    rows: [{ pk: '9001', part: '12', batch: null, quantity: '500' }],
  })
  assert.deepEqual(
    await reader.list({ kind: 'list_part_parameters', part: '12', limit: 1, offset: 0 }),
    {
      kind: 'found',
      count: 1,
      rows: [{ pk: '3001', template: '201', data: '', model_id: '12' }],
    },
  )
  assert.deepEqual(
    await reader.list({ kind: 'list_part_attachments', part: '12', limit: 1, offset: 0 }),
    {
      kind: 'found',
      count: 1,
      rows: [
        {
          pk: '4001',
          attachment: null,
          link: 'https://example.test/d.pdf',
          comment: '',
          model_id: '12',
        },
      ],
    },
  )
  assert.deepEqual(await reader.list({ kind: 'list_category_parameters', category: '81' }), {
    kind: 'found',
    count: 1,
    rows: [{ pk: '311', category: '81', template: '201', default_value: '' }],
  })
  assert.equal(reader.targetContextId, CONTEXT)
})

test('stock quantities keep their decimal value as text', async () => {
  const bodies = ['500.0', '0.5', '0.000001', '9999999999.99999', '1e-7', '12']
  const rendered: string[] = []
  for (const quantity of bodies) {
    const reader = stubReader(
      async () =>
        new Response(
          `{"count":1,"next":null,"previous":null,"results":[{"pk":1,"part":2,"batch":null,"quantity":${quantity}}]}`,
          { headers: { 'content-type': 'application/json; charset=utf-8' } },
        ),
    )
    const result = await reader.list({ kind: 'list_stock', part: '2', limit: 1, offset: 0 })
    assert.equal(result.kind, 'found')
    rendered.push(result.kind === 'found' ? result.rows[0].quantity : '')
  }
  assert.deepEqual(rendered, ['500', '0.5', '0.000001', '9999999999.99999', '0.0000001', '12'])
  assert.equal(decimalText(-0), '0')
  assert.equal(decimalText(1.5e-10), '0.00000000015')
  assert.throws(() => decimalText(Number.NaN), /decimal_not_finite/)
  const stringQuantity = stubReader(async () =>
    page([{ pk: 1, part: 2, batch: null, quantity: '500' }]),
  )
  assert.deepEqual(
    await stringQuantity.list({ kind: 'list_stock', part: '2', limit: 1, offset: 0 }),
    { kind: 'unavailable', reason: 'malformed' },
  )
})

test('a row outside its projection or filter makes the whole read malformed', async () => {
  const cases: [MatchListOperation, unknown[]][] = [
    [
      { kind: 'search_parts', search: 'R', limit: 5, offset: 0 },
      [{ pk: '12', name: 'R', IPN: '', image: null }],
    ],
    [
      { kind: 'search_parts', search: 'R', limit: 5, offset: 0 },
      [{ pk: 12, name: '', IPN: '', image: null }],
    ],
    [{ kind: 'search_parts', search: 'R', limit: 5, offset: 0 }, [{ pk: 12, name: 'R', IPN: '' }]],
    [
      { kind: 'search_parts', search: 'R', limit: 5, offset: 0 },
      [{ pk: 12, name: 'R\u0000', IPN: '', image: null }],
    ],
    [
      { kind: 'search_parts', search: 'R', limit: 5, offset: 0 },
      [{ pk: 12, name: 'R', IPN: '', image: null, active: 'yes' }],
    ],
    [
      { kind: 'list_manufacturer_parts', mpn: 'M', limit: 5, offset: 0 },
      [{ pk: 1, part: 12, MPN: 'M', manufacturer: 61, part_detail: brief(12, 'R') }],
    ],
    [
      { kind: 'list_supplier_parts', sku: 'S', limit: 5, offset: 0 },
      [
        {
          pk: 1,
          part: 12,
          SKU: 'S',
          supplier: 6,
          supplier_detail: { name: 'D' },
          part_detail: brief(13, 'Other'),
        },
      ],
    ],
    [
      { kind: 'list_stock', part: '12', limit: 5, offset: 0 },
      [{ pk: 1, part: 13, batch: 'B', quantity: 1 }],
    ],
    [
      { kind: 'list_part_parameters', part: '12', limit: 5, offset: 0 },
      [
        { pk: 1, template: 201, model_id: 12, data: '10k' },
        { pk: 2, template: 201, model_id: 13, data: '10k' },
      ],
    ],
    [{ kind: 'list_part_attachments', part: '12', limit: 5, offset: 0 }, [{ pk: 1, model_id: 12 }]],
    [{ kind: 'list_category_parameters', category: '81' }, [{ pk: 1, category: 81 }]],
  ]
  for (const [operation, results] of cases) {
    const reader = stubReader(async () => page(results))
    assert.deepEqual(
      await reader.list(operation),
      { kind: 'unavailable', reason: 'malformed' },
      JSON.stringify(results),
    )
  }
  const envelopes = [
    new Response('[]', { headers: { 'content-type': 'application/json' } }),
    json({ count: 1, results: [], next: null, previous: null }, 200, 'text/html'),
    json({ count: '1', next: null, previous: null, results: [] }),
    json({ count: 0, next: null, previous: null, results: [brief(12, 'R')] }),
    json({ count: 1, next: 7, previous: null, results: [] }),
    new Response('{"count":1,"count":1,"next":null,"previous":null,"results":[]}', {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{"count":', { headers: { 'content-type': 'application/json' } }),
  ]
  for (const response of envelopes) {
    const reader = stubReader(async () => response)
    assert.deepEqual(
      await reader.list({ kind: 'search_parts', search: 'R', limit: 5, offset: 0 }),
      {
        kind: 'unavailable',
        reason: 'malformed',
      },
    )
  }
})

test('reader reports status, redirect, transport and oversized answers as unavailable', async () => {
  const operation = { kind: 'search_parts', search: 'R', limit: 5, offset: 0 } as const
  const outcomes: [() => Promise<Response>, string][] = [
    [async () => json({}, 503), 'status'],
    [async () => json(page([]), 201), 'status'],
    [async () => json({ detail: 'Not found.' }, 404), 'status'],
    [
      async () => new Response(null, { status: 302, headers: { location: '/elsewhere' } }),
      'redirect',
    ],
    [
      async () => {
        throw new InventoryTransportError()
      },
      'redirect',
    ],
    [
      async () => {
        throw new Error('socket hang up')
      },
      'transport',
    ],
    [
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024).fill(0x20))
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      'over_bound',
    ],
  ]
  for (const [respond, reason] of outcomes) {
    const reader = stubReader(respond)
    assert.deepEqual(await reader.list(operation), { kind: 'unavailable', reason }, reason)
  }
})

test('category mappings over the bound or incomplete are over_bound, never merged', async () => {
  const mapping = (pk: number) => ({ pk, category: 81, template: 200 + pk, default_value: '' })
  const sent: MatchListOperation[] = []
  const incomplete = stubReader(async (operation) => {
    sent.push(operation)
    return page([mapping(1), mapping(2)], 3)
  })
  assert.deepEqual(await incomplete.list({ kind: 'list_category_parameters', category: '81' }), {
    kind: 'unavailable',
    reason: 'over_bound',
  })
  const full = Array.from({ length: CATEGORY_PARAMETERS_MAX }, (_, index) => mapping(index + 1))
  const over = stubReader(async (operation) => {
    sent.push(operation)
    return page(full, CATEGORY_PARAMETERS_MAX + 1)
  })
  assert.deepEqual(await over.list({ kind: 'list_category_parameters', category: '81' }), {
    kind: 'unavailable',
    reason: 'over_bound',
  })
  assert.equal(sent.length, 2, 'one request each; no further page is read')
  const exact = stubReader(async () => page(full, CATEGORY_PARAMETERS_MAX))
  const result = await exact.list({ kind: 'list_category_parameters', category: '81' })
  assert.equal(result.kind, 'found')
  assert.equal(result.kind === 'found' ? result.rows.length : 0, CATEGORY_PARAMETERS_MAX)
})

test('single reads return found, not_found or unavailable, and refuse an invalid PK unsent', async () => {
  const reads: ReadOperation[] = []
  const answers: Record<string, Response> = {
    '81': json({ pk: 81, name: 'Resistors', parent: 80, pathstring: 'Passives/Resistors' }),
    '82': json({}, 404),
    '83': json({ pk: 84, name: 'Other', parent: null }),
    '84': json({}, 500),
  }
  const reader = stubReader(
    async () => page([]),
    async (operation) => {
      reads.push(operation)
      return (
        answers[operation.pk] ??
        json({
          pk: Number(operation.pk),
          name: 'Part',
          IPN: 'P-1',
          category: 81,
          image: '',
          variant_of: null,
        })
      )
    },
  )
  assert.deepEqual(await reader.category('81'), {
    kind: 'found',
    value: { pk: '81', name: 'Resistors', parent: '80' },
  })
  assert.deepEqual(await reader.category('82'), { kind: 'not_found' })
  assert.deepEqual(await reader.category('83'), { kind: 'unavailable', reason: 'malformed' })
  assert.deepEqual(await reader.category('84'), { kind: 'unavailable', reason: 'status' })
  assert.deepEqual(await reader.part('12'), {
    kind: 'found',
    value: {
      pk: '12',
      name: 'Part',
      IPN: 'P-1',
      category: '81',
      has_image: false,
      active: true,
      variant_of: null,
    },
  })
  assert.deepEqual(await reader.stock('9001'), { kind: 'unavailable', reason: 'malformed' })
  assert.deepEqual(reads, [
    { kind: 'get_category', pk: '81' },
    { kind: 'get_category', pk: '82' },
    { kind: 'get_category', pk: '83' },
    { kind: 'get_category', pk: '84' },
    { kind: 'get_part', pk: '12' },
    { kind: 'get_stock', pk: '9001' },
  ])
  for (const pk of ['0', '-1', '01', '1.0', '9223372036854775808', '']) {
    await assert.rejects(reader.part(pk), /read_operation_refused/)
  }
  await assert.rejects(
    reader.list({ kind: 'list_stock', limit: 1, offset: 0 }),
    /list_operation_refused/,
  )
  assert.equal(reads.length, 6)
})
