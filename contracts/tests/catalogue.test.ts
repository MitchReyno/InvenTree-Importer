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

/** Sends one search and aborts `abort`'s controller once the request reaches the transport. */
async function abortOpenSearch(abort: AbortController, signal?: AbortSignal) {
  const reason = new Error('request_ended')
  let sends = 0
  const client = catalogueClient('http://127.0.0.1:4310', 'csrf', async (_input, init) => {
    sends++
    const sent = init!.signal!
    return new Promise<Response>((_resolve, reject) => {
      sent.addEventListener('abort', () => reject(sent.reason), { once: true })
      abort.abort(reason)
      // Abort propagates synchronously, so a request still open here never heard the abort.
      if (!sent.aborted) {
        reject(new Error('abort_not_propagated'))
      }
    })
  })
  await assert.rejects(
    client.search(batch, 'location', 'Drawer 4', signal),
    (error) => error === reason,
  )
  assert.equal(sends, 1)
}

/** Runs `body` as a browser without `AbortSignal.any` would, then restores it. */
async function withoutAbortSignalAny(body: () => Promise<void>) {
  const native = Object.getOwnPropertyDescriptor(AbortSignal, 'any')
  Reflect.deleteProperty(AbortSignal, 'any')
  try {
    await body()
  } finally {
    if (native) {
      Object.defineProperty(AbortSignal, 'any', native)
    }
  }
}

test('aborting a catalogue search ends its request with the caller’s reason, once', async () => {
  const caller = new AbortController()
  await abortOpenSearch(caller, caller.signal)
})

test('without AbortSignal.any a caller’s abort still ends the request', async () => {
  await withoutAbortSignalAny(async () => {
    assert.equal(typeof AbortSignal.any, 'undefined')
    const caller = new AbortController()
    await abortOpenSearch(caller, caller.signal)
  })
})

test('without AbortSignal.any the operation deadline still ends the request', async (context) => {
  const deadline = new AbortController()
  context.mock.method(AbortSignal, 'timeout', () => deadline.signal)
  await withoutAbortSignalAny(() => abortOpenSearch(deadline, new AbortController().signal))
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
