import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mediaClient, IntakeRequestError } from '../generated/client.ts'
import {
  MEDIA_SOURCE_MAX_BYTES,
  type MediaReceiptDto,
  type MediaSnapshotDto,
} from '../src/media.ts'

const id = '10000000-0000-4000-8000-000000000001'
const revision = '9007199254740993'
const bytes = new Uint8Array([0, 255, 128, 195, 40, 1])
const snapshot: MediaSnapshotDto = {
  batch_id: id,
  revision,
  evidence: [],
  attachments: [],
  groups: [],
  derivations: [],
}
const receipt: MediaReceiptDto = {
  status: 'retained',
  batch_id: id,
  evidence_id: id,
  version: {
    id,
    evidence_id: id,
    kind: 'original',
    digest: 'a'.repeat(64),
    byte_size: '6',
    media_type: 'application/octet-stream',
    state: 'queued',
    decoder_build: null,
    recipe: null,
    pages: [],
  },
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('media facade preserves injected raw bytes, exact revision, UTF-8 label and command headers', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const client = mediaClient('http://127.0.0.1:4310/base', 'owned-csrf', async (url, init) => {
    calls.push({ url: String(url), init: init! })
    return json(calls.length === 3 ? receipt : snapshot)
  })
  assert.deepEqual(await client.snapshot('batch/é'), snapshot)
  const input = {
    expected_revision: revision,
    change: { kind: 'group' as const, label: 'Packet é' },
  }
  assert.deepEqual(await client.edit(id, input, id), snapshot)
  assert.deepEqual(
    await client.upload('batch/é', revision, 'é label #%?', new Blob([bytes]), id),
    receipt,
  )
  assert.equal(calls[0].url, 'http://127.0.0.1:4310/api/v1/batches/batch%2F%C3%A9/media')
  assert.equal(calls[1].init.body, JSON.stringify(input))
  assert.equal(calls[2].url, 'http://127.0.0.1:4310/api/v1/batches/batch%2F%C3%A9/media/originals')
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(calls[2].init.redirect, 'error')
  assert.ok(calls[2].init.body instanceof ArrayBuffer)
  assert.deepEqual(new Uint8Array(calls[2].init.body), bytes)
  assert.deepEqual(calls[2].init.headers, {
    'content-type': 'application/octet-stream',
    'idempotency-key': id,
    'x-intake-csrf': 'owned-csrf',
    'x-intake-media-revision': revision,
    'x-intake-media-label': '%C3%A9%20label%20%23%25%3F',
  })
})

test('media refuses empty/oversized sources and invalid metadata before any transport', async () => {
  let sends = 0
  const client = mediaClient('http://127.0.0.1:4310', '', async () => {
    sends++
    return json(receipt)
  })
  for (const blob of [new Blob([]), new Blob([new Uint8Array(MEDIA_SOURCE_MAX_BYTES + 1)])]) {
    await assert.rejects(client.upload(id, revision, 'label', blob, id), /invalid_upload_size/)
  }
  for (const value of ['01', '1e3', '9223372036854775808']) {
    await assert.rejects(
      client.upload(id, value, 'label', new Blob([bytes]), id),
      /invalid_contract/,
    )
  }
  for (const label of ['', '  ', 'bad\nlabel', 'a'.repeat(257)]) {
    await assert.rejects(
      client.upload(id, revision, label, new Blob([bytes]), id),
      /invalid_upload_label/,
    )
  }
  assert.equal(sends, 0)
})

test('media commands/JSON receipts are runtime validated and 409/412 retain typed errors', async () => {
  let sends = 0
  const invalid = mediaClient('http://127.0.0.1:4310', '', async () => {
    sends++
    return json({ ...receipt, private_path: 'forbidden' })
  })
  await assert.rejects(
    invalid.edit(id, { expected_revision: '1e3', change: { kind: 'group', label: 'packet' } }, id),
    /invalid_contract/,
  )
  assert.equal(sends, 0)
  await assert.rejects(
    invalid.upload(id, revision, 'packet', new Blob([bytes]), id),
    /invalid_contract/,
  )
  assert.equal(sends, 1)
  for (const status of [409, 412]) {
    const client = mediaClient('http://127.0.0.1:4310', '', async () =>
      json(
        {
          code: 'revision_conflict',
          message: 'Refresh.',
          recovery: 'refresh',
          correlation_id: 'owned',
        },
        status,
      ),
    )
    await assert.rejects(
      client.upload(id, revision, 'packet', new Blob([bytes]), id),
      (error) =>
        error instanceof IntakeRequestError &&
        error.status === status &&
        error.code === 'revision_conflict',
    )
  }
})

test('actual HTTP receives one literal binary upload and a JSON receipt', async () => {
  const requests: {
    path: string
    body: Buffer
    headers: Record<string, string | string[] | undefined>
  }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({ path: request.url!, body: Buffer.concat(chunks), headers: request.headers })
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(receipt))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const client = mediaClient(`http://127.0.0.1:${address.port}`, 'owned-csrf')
    assert.deepEqual(await client.upload(id, revision, 'é #%?', new Blob([bytes]), id), receipt)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].path, `/api/v1/batches/${id}/media/originals`)
    assert.deepEqual(new Uint8Array(requests[0].body), bytes)
    assert.equal(requests[0].headers['x-intake-media-revision'], revision)
    assert.equal(requests[0].headers['x-intake-media-label'], '%C3%A9%20%23%25%3F')
    assert.equal(requests[0].headers['x-intake-csrf'], 'owned-csrf')
    assert.equal(requests[0].headers['idempotency-key'], id)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('media uses bounded 45-second deadlines and never retries an uncertain upload', async (context) => {
  const deadlines: number[] = []
  context.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadlines.push(ms)
    return new AbortController().signal
  })
  let sends = 0
  const failure = new Error('owned_acknowledgement_lost')
  const client = mediaClient('http://127.0.0.1:4310', '', async () => {
    sends++
    throw failure
  })
  await assert.rejects(
    client.upload(id, revision, 'packet', new Blob([bytes]), id),
    (error) => error === failure,
  )
  assert.equal(sends, 1)
  assert.deepEqual(deadlines, [45000])
})
