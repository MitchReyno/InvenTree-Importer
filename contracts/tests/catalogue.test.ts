import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogueClient } from '../generated/client.ts'

const batch = '10000000-0000-4000-8000-000000000001'
const context = '50000000-0000-4000-8000-000000000005'
const search = {
  model: 'location',
  target_context_id: context,
  query: 'Drawer 4',
  results: [
    {
      kind: 'location',
      pk: '9007199254740993',
      name: 'Drawer 4',
      description: '',
      path: 'Bench/Drawer 4',
      parent_pk: null,
      structural: false,
    },
  ],
  coverage: { loaded: 1, total: 2, truncated: true },
  exact_id: { status: 'not_requested' },
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

test('catalogue client sends scoped read paths and validates exact identities', async () => {
  const urls: string[] = []
  const client = catalogueClient('http://127.0.0.1:4310', 'csrf', async (input) => {
    urls.push(input instanceof Request ? input.url : String(input))
    return json(search)
  })
  assert.deepEqual(await client.search(batch, 'location', 'Drawer 4'), search)
  assert.deepEqual(urls, [
    `http://127.0.0.1:4310/api/v1/batches/${batch}/catalogue/location?q=Drawer%204`,
  ])
})

test('catalogue client fails closed on unexpected fields, numeric PKs and over-long pages', async () => {
  const invalid = [
    { ...search, results: [{ ...search.results[0], website: 'https://example.invalid' }] },
    { ...search, results: [{ ...search.results[0], pk: 9 }] },
    { ...search, results: Array.from({ length: 51 }, () => search.results[0]) },
    { ...search, exact_id: { status: 'found' } },
  ]
  for (const body of invalid) {
    const client = catalogueClient('http://127.0.0.1:4310', 'csrf', async () => json(body))
    await assert.rejects(client.search(batch, 'location', 'Drawer 4'))
  }
  const candidates = catalogueClient('http://127.0.0.1:4310', 'csrf', async () =>
    json({
      model: 'supplier',
      target_context_id: context,
      candidates: [
        { kind: 'supplier', pk: '7', name: 'Mouser', description: '', manufacturer: false },
      ],
      coverage: { loaded: 1, total: 1, truncated: false },
    }),
  )
  assert.equal((await candidates.candidates(batch, 'supplier')).candidates[0].name, 'Mouser')
})
