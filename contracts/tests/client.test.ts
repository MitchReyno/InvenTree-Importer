import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import {
  captureClient,
  intakeClient,
  manualClient,
  IntakeRequestError,
} from '../generated/client.ts'
import { compatibleTransport } from '../src/client-policy.ts'
import type { CaptureSnapshot } from '../generated/api.d.ts'

const id = '10000000-0000-4000-8000-000000000001'
const key = '20000000-0000-4000-8000-000000000002'
const snapshot: CaptureSnapshot = {
  id,
  source_id: '30000000-0000-4000-8000-000000000003',
  title: 'Synthetic exact packet',
  revision: '9007199254740993',
  archived: false,
  updated_at: '2026-11-01T13:00:00Z',
  actor_id: '40000000-0000-4000-8000-000000000004',
  target_context_id: '50000000-0000-4000-8000-000000000005',
  defaults: {
    quantity: { mode: 'set', value: '9999999999999.999999' },
    location: { mode: 'clear' },
  },
  parts: [],
  lots: [],
  observations: [],
  notes: [],
  cursor: { stream_id: '60000000-0000-4000-8000-000000000006', sequence: '9007199254740993' },
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('typed client keeps encoded root paths, exact scalars and the URL/init injection boundary', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const transport: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    return json(snapshot)
  }
  const client = captureClient('http://127.0.0.1:4310/base-path', 'csrf-fixture', transport)
  assert.deepEqual(await client.read('packet/é?x=#'), snapshot)
  assert.equal(calls[0].url, 'http://127.0.0.1:4310/api/v1/batches/packet%2F%C3%A9%3Fx%3D%23')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.body, undefined)
  assert.deepEqual(calls[0].init.headers, {})

  const change = {
    expected_revision: '9007199254740993',
    change: {
      kind: 'defaults' as const,
      quantity: { mode: 'set' as const, value: '9999999999999.999999' },
      location: { mode: 'inherit' as const },
    },
  }
  assert.deepEqual(await client.edit(id, change, key), snapshot)
  assert.equal(calls[1].url, `http://127.0.0.1:4310/api/v1/batches/${id}/edits`)
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.body, JSON.stringify(change))
  assert.deepEqual(calls[1].init.headers, {
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-intake-csrf': 'csrf-fixture',
  })
})

test('request validation refuses malformed commands before transport', async () => {
  let sends = 0
  const client = captureClient('http://127.0.0.1:4310', 'csrf-fixture', async () => {
    sends++
    return json(snapshot)
  })
  const invalid = { title: 'Retained', note: '', actor_id: id }
  await assert.rejects(client.create(invalid, key), /invalid_contract/)
  assert.equal(sends, 0)
})

test('response validation rejects private fields, scalar coercion, malformed and empty bodies', async () => {
  for (const invalid of [
    { ...snapshot, private_key: 'must-not-cross-boundary' },
    { ...snapshot, revision: 9007199254740992 },
    { ...snapshot, defaults: { ...snapshot.defaults, quantity: { mode: 'set', value: '1e3' } } },
  ]) {
    const client = captureClient('http://127.0.0.1:4310', 'csrf-fixture', async () => json(invalid))
    await assert.rejects(client.read(id), /invalid_contract/)
  }
  for (const body of ['not-json', '']) {
    const client = captureClient(
      'http://127.0.0.1:4310',
      'csrf-fixture',
      async () => new Response(body),
    )
    await assert.rejects(client.read(id), SyntaxError)
  }
})

test('typed error responses retain HTTP status/code, while malformed failures remain invalid', async () => {
  const failure = {
    code: 'revision_conflict',
    message: 'Refresh saved values.',
    recovery: 'refresh',
    correlation_id: 'owned-test',
  }
  const client = captureClient('http://127.0.0.1:4310', 'csrf-fixture', async () =>
    json(failure, 412),
  )
  await assert.rejects(
    client.read(id),
    (error) =>
      error instanceof IntakeRequestError &&
      error.status === 412 &&
      error.code === 'revision_conflict',
  )

  const invalid = captureClient('http://127.0.0.1:4310', 'csrf-fixture', async () =>
    json({ ...failure, diagnostic: 'private' }, 500),
  )
  await assert.rejects(invalid.read(id), /invalid_contract/)
  const setup = intakeClient(
    'http://127.0.0.1:4310',
    async () => new Response('unavailable', { status: 503 }),
  )
  await assert.rejects(setup.health(), /^Error: intake_request_failed$/)
})

test('manual facade derives its approval path/body and preserves selected recovery keys', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const accepted = { run_id: id, approval_id: id, preparation_id: id }
  const client = manualClient('http://127.0.0.1:4310', 'csrf-fixture', async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    return json(accepted)
  })
  const approval = {
    preparation_id: id,
    selected_lot_ids: [id],
    expected_plan_sha256: 'a'.repeat(64),
    expected_review_fingerprint: 'b'.repeat(64),
    expected_target_revision: '9007199254740993',
  }
  assert.deepEqual(await client.approve(approval, key), accepted)
  assert.equal(calls[0].url, `http://127.0.0.1:4310/api/v1/preparations/${id}/approvals`)
  assert.equal(calls[0].init.body, JSON.stringify(approval))
  const recovery = { expected_run_revision: '9007199254740993', operation_keys: [id] }
  assert.deepEqual(await client.recover(id, recovery, key), accepted)
  assert.equal(calls[1].url, `http://127.0.0.1:4310/api/v1/runs/${id}/recover`)
  assert.equal(calls[1].init.body, JSON.stringify(recovery))
  assert.equal(new Headers(calls[1].init.headers).get('idempotency-key'), key)
})

test('operation deadlines remain distinct and aborts propagate without retry', async (context) => {
  const deadlines: number[] = []
  let controller = new AbortController()
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds)
    return controller.signal
  })
  await intakeClient('http://127.0.0.1:4310', async () =>
    json({ status: 'ok', api_version: 'bench-intake-app/1' }),
  ).health()
  await captureClient('http://127.0.0.1:4310', '', async () =>
    json({ batches: [], truncated: false }),
  ).list()
  await manualClient('http://127.0.0.1:4310', '', async () =>
    json({ runs: [], truncated: false }),
  ).activity()
  assert.deepEqual(deadlines, [5000, 10000, 45000])

  controller = new AbortController()
  const abort = new Error('owned_abort')
  let sends = 0
  const client = captureClient('http://127.0.0.1:4310', '', async (_input, init) => {
    sends++
    const signal = init!.signal!
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      controller.abort(abort)
    })
  })
  await assert.rejects(
    client.create({ title: 'Packet', note: '' }, key),
    (error) => error === abort,
  )
  assert.equal(sends, 1)
})

test('original transport failures are not wrapped or retried', async () => {
  const failure = new Error('owned_connection_lost')
  let sends = 0
  const client = captureClient('http://127.0.0.1:4310', '', async () => {
    sends++
    throw failure
  })
  await assert.rejects(
    client.create({ title: 'Packet', note: '' }, key),
    (error) => error === failure,
  )
  assert.equal(sends, 1)
})

test('actual HTTP preserves command bytes and redirect refusal never reaches the sink', async () => {
  const requests: {
    method: string
    path: string
    headers: Record<string, string | string[] | undefined>
    body: string
  }[] = []
  let redirect = false
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      if (redirect) {
        response.writeHead(302, { location: '/forbidden-sink' }).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const client = captureClient(`http://127.0.0.1:${address.port}`, 'owned-csrf')
    const input = {
      expected_revision: '9007199254740993',
      change: { kind: 'batch' as const, title: 'é exact human title' },
    }
    assert.deepEqual(await client.edit(id, input, key), snapshot)
    assert.equal(
      requests[0].body,
      '{"expected_revision":"9007199254740993","change":{"kind":"batch","title":"é exact human title"}}',
    )
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].headers['x-intake-csrf'], 'owned-csrf')
    assert.equal(requests[0].headers['idempotency-key'], key)

    redirect = true
    await assert.rejects(client.read(id), TypeError)
    assert.deepEqual(
      requests.map((request) => request.path),
      [`/api/v1/batches/${id}/edits`, `/api/v1/batches/${id}`],
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('transport compatibility preserves non-JSON bytes rather than decoding them as text', async () => {
  const original = new Uint8Array([0, 255, 128, 195, 40, 1])
  let retained: RequestInit['body']
  const transport = compatibleTransport(async (_url, init) => {
    retained = init?.body
    return new Response(null, { status: 204 })
  })
  await transport(
    new Request('http://127.0.0.1:4310/owned-binary-fixture', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: original,
    }),
  )
  assert.ok(retained instanceof ArrayBuffer)
  assert.deepEqual(new Uint8Array(retained), original)
})
