import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '@invimport/contracts'
import { catalogueReader, type ListOperation } from '#/capture/catalogue.ts'
import { inventoryTransport, type ReadOperation } from '#/inventory/transport.ts'

const CONTEXT = '6c1f4a2e-9b3d-4e5f-8a7b-0c1d2e3f4a5b'

function page(results: unknown[], count = results.length, next: string | null = null) {
  return new Response(JSON.stringify({ count, next, previous: null, results }), {
    headers: { 'content-type': 'application/json' },
  })
}

function location(pk: number, name: string, path = name, parent: number | null = null) {
  return { pk, name, description: null, pathstring: path, parent, structural: false, items: 3 }
}

function company(pk: number, name: string, supplier = true) {
  return {
    pk,
    name,
    description: '',
    is_supplier: supplier,
    is_manufacturer: !supplier,
    website: '',
  }
}

function reader(
  list: (operation: ListOperation) => Promise<Response>,
  read: (operation: ReadOperation) => Promise<Response> = async () =>
    new Response('{}', { status: 404 }),
) {
  return catalogueReader({ list, read, targetContextId: CONTEXT })
}

test('search sends one bounded strict query and keeps exact identity, path and coverage', async () => {
  const lists: ListOperation[] = []
  const reads: ReadOperation[] = []
  const catalogue = reader(
    async (operation) => {
      lists.push(operation)
      return page(
        [
          location(41, 'Drawer 4', 'Bench/Drawer 4', 40),
          location(42, 'Drawer 4', 'Store/Drawer 4', 39),
        ],
        73,
      )
    },
    async (operation) => {
      reads.push(operation)
      return new Response('{}', { status: 404 })
    },
  )
  const result = await catalogue.search('location', 'Drawer 4')
  validate('CatalogueSearch', result)
  assert.deepEqual(lists, [{ kind: 'list_locations', limit: 50, offset: 0, search: 'Drawer 4' }])
  assert.deepEqual(reads, [], 'non-numeric text never triggers an ID read')
  assert.deepEqual(
    result.results.map((record) => [record.pk, record.kind === 'location' ? record.path : '']),
    [
      ['41', 'Bench/Drawer 4'],
      ['42', 'Store/Drawer 4'],
    ],
    'ambiguous names stay distinct by exact PK and path',
  )
  assert.deepEqual(result.coverage, { loaded: 2, total: 73, truncated: true })
  assert.deepEqual(result.exact_id, { status: 'not_requested' })
})

test('numeric search adds an exact detail read without fuzzy substitution', async () => {
  const reads: ReadOperation[] = []
  const catalogue = reader(
    async () => page([company(19, 'Supplier 9007199254740991 Pty')]),
    async (operation) => {
      reads.push(operation)
      return new Response(JSON.stringify(company(Number.MAX_SAFE_INTEGER, 'Exact supplier')))
    },
  )
  const found = await catalogue.search('supplier', '9007199254740991')
  assert.deepEqual(reads, [{ kind: 'get_company', pk: '9007199254740991' }])
  assert.deepEqual(found.exact_id, {
    status: 'found',
    record: {
      kind: 'supplier',
      pk: '9007199254740991',
      name: 'Exact supplier',
      description: '',
      manufacturer: false,
    },
  })
  const missing = await reader(async () => page([])).search('location', '77')
  assert.deepEqual(missing.exact_id, { status: 'not_found' })
  assert.deepEqual(missing.results, [], 'no matches in the searched set is not unavailability')
  const nonSupplier = await reader(
    async () => page([]),
    async () => new Response(JSON.stringify(company(77, 'Manufacturer only', false))),
  ).search('supplier', '77')
  assert.deepEqual(
    nonSupplier.exact_id,
    { status: 'not_found' },
    'missing supplier role is not offered',
  )
})

test('candidate snapshot is independent of strict search and bounded with visible truncation', async () => {
  const lists: ListOperation[] = []
  const names = Array.from({ length: 620 }, (_, index) => `Location ${index}`)
  names[437] = 'Incoming inspection drawer'
  const catalogue = reader(async (operation) => {
    lists.push(operation)
    if (operation.search !== undefined) {
      // Strict upstream filtering omits the misspelled query entirely.
      return page([], 0)
    }
    const slice = names.slice(operation.offset, operation.offset + operation.limit)
    return page(
      slice.map((name, index) => location(operation.offset + index + 1, name)),
      names.length,
      'http://attacker.invalid/api/stock/location/?limit=100&offset=100',
    )
  })
  const strict = await catalogue.search('location', 'Incomming')
  assert.deepEqual(strict.results, [])
  const snapshot = await catalogue.candidates('location')
  validate('CatalogueCandidates', snapshot)
  assert.deepEqual(
    lists.slice(1).map((operation) => [operation.offset, operation.limit, operation.search]),
    [
      [0, 100, undefined],
      [100, 100, undefined],
      [200, 100, undefined],
      [300, 100, undefined],
      [400, 100, undefined],
    ],
    'pages are rebuilt from validated offsets; upstream next URLs are never followed',
  )
  assert.equal(snapshot.candidates.length, 500)
  assert.ok(snapshot.candidates.some((record) => record.name === 'Incoming inspection drawer'))
  assert.deepEqual(snapshot.coverage, { loaded: 500, total: 620, truncated: true })

  const small = await reader(async (operation) =>
    page(operation.offset === 0 ? [company(5, 'Mouser Electronics')] : [], 1),
  ).candidates('supplier')
  assert.deepEqual(small.coverage, { loaded: 1, total: 1, truncated: false })
})

test('HTTP 200 bodies that do not match the admitted shape are unavailable, never results', async () => {
  const invalid: Array<[string, () => Response]> = [
    ['not json', () => new Response('<html>')],
    ['bare array (unpaginated)', () => new Response(JSON.stringify([location(1, 'A')]))],
    ['missing results', () => new Response(JSON.stringify({ count: 1 }))],
    ['negative count', () => page([], -1)],
    ['count below results', () => page([location(1, 'A'), location(2, 'B')], 1)],
    ['string pk', () => page([{ ...location(1, 'A'), pk: '1' }])],
    ['unsafe pk', () => page([{ ...location(1, 'A'), pk: 9007199254740993 }])],
    ['empty name', () => page([location(1, '')])],
    ['bad parent', () => page([{ ...location(1, 'A'), parent: 'root' }])],
    [
      'duplicate key',
      () => new Response('{"count":0,"count":0,"next":null,"previous":null,"results":[]}'),
    ],
    ['oversized', () => page([{ ...location(1, 'A'), description: 'x'.repeat(600 * 1024) }])],
    ['denied', () => new Response('{"detail":"no"}', { status: 403 })],
  ]
  for (const [label, response] of invalid) {
    await assert.rejects(
      reader(async () => response()).search('location', 'A'),
      /catalogue_unavailable/,
      label,
    )
  }
  await assert.rejects(
    reader(async () => page([company(3, 'Not a supplier', false)])).search('supplier', 'Not'),
    /catalogue_unavailable/,
    'a company without the supplier role means the target ignored the filter',
  )
  await assert.rejects(
    reader(async () => {
      throw new Error('socket hang up')
    }).candidates('supplier'),
    /catalogue_unavailable/,
  )
})

test('query bounds and concurrency are enforced before any target traffic', async () => {
  let calls = 0
  const catalogue = reader(async () => {
    calls++
    return page([])
  })
  for (const query of ['', 'x'.repeat(101), 'line\nbreak', 'tab\tseparated']) {
    await assert.rejects(catalogue.search('location', query), /invalid_catalogue_query/)
  }
  assert.equal(calls, 0)

  const releases: Array<() => void> = []
  const slow = reader(
    () =>
      new Promise<Response>((resolve) => {
        releases.push(() => resolve(page([])))
      }),
  )
  const first = slow.search('location', 'a')
  const second = slow.search('location', 'b')
  await assert.rejects(slow.search('location', 'c'), /catalogue_busy/)
  releases.forEach((release) => release())
  await Promise.all([first, second])
  // Slots are released after settlement, so a later search is admitted again.
  const later = slow.search('location', 'd')
  releases.at(-1)?.()
  await later
})

test('transport list builds fixed paginated paths and refuses unbounded or foreign requests', async () => {
  const urls: string[] = []
  const transport = inventoryTransport(
    {
      kind: 'protected-read-only',
      origin: 'http://127.0.0.1:9',
      targetId: 'target',
      contextId: 'context',
      protectedOrigins: ['http://127.0.0.1:9'],
      credential: 'fake-only',
    },
    async (input) => {
      urls.push(String(input))
      return page([])
    },
  )
  const binding = { targetId: 'target', contextId: 'context' }
  await transport.list(binding, {
    kind: 'list_locations',
    limit: 100,
    offset: 200,
    search: 'a&b=c',
  })
  await transport.list(binding, { kind: 'list_supplier_companies', limit: 50, offset: 0 })
  assert.deepEqual(urls, [
    'http://127.0.0.1:9/api/stock/location/?limit=100&offset=200&ordering=name&search=a%26b%3Dc',
    'http://127.0.0.1:9/api/company/?is_supplier=true&limit=50&offset=0&ordering=name',
  ])
  for (const operation of [
    { kind: 'list_locations', limit: 0, offset: 0 },
    { kind: 'list_locations', limit: 101, offset: 0 },
    { kind: 'list_locations', limit: 10, offset: 10001 },
    { kind: 'list_locations', limit: 10, offset: -1 },
    { kind: 'list_locations', limit: 10.5, offset: 0 },
    { kind: 'list_parts', limit: 10, offset: 0 },
    { kind: 'list_locations', limit: 10, offset: 0, search: 'x'.repeat(101) },
  ]) {
    await assert.rejects(
      transport.list(binding, operation as ListOperation),
      /list_operation_refused/,
    )
  }
  for (const timeoutMs of [0, 5001, 1.5]) {
    await assert.rejects(
      transport.list(binding, { kind: 'list_locations', limit: 1, offset: 0 }, timeoutMs),
      /list_operation_refused/,
    )
  }
  await assert.rejects(
    transport.list(
      { targetId: 'other', contextId: 'context' },
      { kind: 'list_locations', limit: 1, offset: 0 },
    ),
    /target_binding_mismatch/,
  )
  assert.equal(urls.length, 2)
})

test('bounded body reader cancels a stalled or oversized target body', async () => {
  const { readBoundedBody, BoundedBodyError } = await import('#/capture/bounded-body.ts')
  let cancelled = 0
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"count":'))
    },
    cancel() {
      cancelled++
    },
  })
  await assert.rejects(readBoundedBody(stalled, 1024, 25), (error: unknown) => {
    return error instanceof BoundedBodyError && error.reason === 'timeout'
  })
  assert.equal(cancelled, 1)
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(4096))
    },
    cancel() {
      cancelled++
    },
  })
  await assert.rejects(readBoundedBody(endless, 10000, 1000), (error: unknown) => {
    return error instanceof BoundedBodyError && error.reason === 'too_large'
  })
  assert.equal(cancelled, 2)
})

test('valid pages up to the page limit parse; the snapshot budget covers every page read', async () => {
  const large = Array.from({ length: 100 }, (_, index) => ({
    ...location(index + 1, `Location ${index}`),
    description: 'é'.repeat(2000),
  }))
  const big = await reader(async () => page(large, 100)).candidates('location')
  assert.equal(
    big.candidates.length,
    100,
    'a ~400 KB page between the 256 KiB default and the 512 KiB limit is valid',
  )

  let clock = 0
  const timeouts: number[] = []
  const slow = catalogueReader({
    targetContextId: CONTEXT,
    now: () => clock,
    read: async () => new Response('{}', { status: 404 }),
    list: async (operation, timeoutMs) => {
      timeouts.push(timeoutMs)
      // A slow target uses almost all of whatever request deadline it is given.
      clock += Math.min(4999, timeoutMs)
      const rows = Array.from({ length: operation.limit }, (_, index) =>
        location(operation.offset + index + 1, `Location ${operation.offset + index}`),
      )
      return page(rows, 500)
    },
  })
  await assert.rejects(slow.candidates('location'), /catalogue_unavailable/)
  assert.ok(clock <= 15000, `snapshot work stops within its 15 s budget (stopped at ${clock} ms)`)
  assert.deepEqual(
    timeouts,
    [5000, 5000, 5000, 3],
    'later requests receive only the remaining budget',
  )
})
