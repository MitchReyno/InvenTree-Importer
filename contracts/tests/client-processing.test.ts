import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { processingClient, IntakeRequestError } from '../generated/client.ts'
import { validate } from '../src/index.ts'
import type { ProcessingAnswerDto, ProcessingStartDto } from '../src/processing.ts'

const id = '10000000-0000-4000-8000-000000000001'
const revision = '9007199254740993'
const receipt = { batch_id: id, job_ids: [id], attempt_ids: [id] }
const start: ProcessingStartDto = {
  schema_version: 'bench-intake-processing/1',
  expected_capture_revision: revision,
  subject_ids: [id],
  stages: ['reading'],
}
const answer: ProcessingAnswerDto = {
  schema_version: 'bench-intake-answer/1',
  expected_question_revision: revision,
  expected_capture_revision: revision,
  attempt_id: id,
  input_sha256: 'a'.repeat(64),
  value: { kind: 'quantity', value: '9999999999999.999999', basis: 'counted' },
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('processing methods preserve exact paths, scalars, provenance, keys and headers', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const snapshot = {
    runner_status: 'fixture_only',
    batch_id: id,
    capture_revision: revision,
    jobs: [],
    cursor: { stream_id: id, sequence: revision },
  }
  const activity = {
    jobs: [
      {
        batch_id: id,
        job_id: id,
        attempt_id: id,
        state: 'running',
        input_current: false,
        occupies_lane: true,
      },
    ],
    lane_occupied: true,
    truncated: false,
  }
  const answered = {
    answer_id: id,
    question_id: id,
    attempt_id: id,
    capture_revision: revision,
    command_id: id,
  }
  const replies = [snapshot, receipt, receipt, answered, activity]
  const client = processingClient('http://127.0.0.1:4310/base', 'owned-csrf', async (url, init) => {
    calls.push({ url: String(url), init: init! })
    return json(replies[calls.length - 1], calls.length === 2 ? 202 : 200)
  })
  assert.deepEqual(await client.read('batch/é'), snapshot)
  assert.deepEqual(await client.start(id, start, id), receipt)
  const cancellation = { expected_revision: revision, attempt_id: id }
  assert.deepEqual(await client.cancel('batch/é', 'job/#', cancellation, id), receipt)
  assert.deepEqual(await client.answer(id, 'question/?', answer, id), answered)
  assert.deepEqual(await client.activity(), activity)
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).pathname),
    [
      '/api/v1/batches/batch%2F%C3%A9/processing',
      `/api/v1/batches/${id}/processing`,
      '/api/v1/batches/batch%2F%C3%A9/processing/job%2F%23/cancellation',
      `/api/v1/batches/${id}/questions/question%2F%3F/answers`,
      '/api/v1/processing-activity',
    ],
  )
  for (const [index, input] of [
    [1, start],
    [2, cancellation],
    [3, answer],
  ] as const) {
    assert.equal(calls[index].init.method, 'POST')
    assert.equal(calls[index].init.redirect, 'error')
    assert.equal(calls[index].init.body, JSON.stringify(input))
    assert.deepEqual(calls[index].init.headers, {
      'content-type': 'application/json',
      'idempotency-key': id,
      'x-intake-csrf': 'owned-csrf',
    })
  }
})

test('processing rejects malformed input and private response fields without retry', async () => {
  let sends = 0
  const client = processingClient('http://127.0.0.1:4310', '', async () => {
    sends++
    return json({ ...receipt, channel_secret: 'forbidden' })
  })
  await assert.rejects(
    client.start(
      id,
      { ...start, expected_capture_revision: 2 } as unknown as ProcessingStartDto,
      id,
    ),
    /invalid_contract/,
  )
  await assert.rejects(
    client.answer(
      id,
      id,
      { ...answer, value: { kind: 'quantity', value: '1e3', basis: 'counted' } },
      id,
    ),
    /invalid_contract/,
  )
  assert.equal(sends, 0)
  await assert.rejects(client.start(id, start, id), /invalid_contract/)
  assert.equal(sends, 1)
})

test('processing surfaces validated 409 and 412 failures and bounded operation deadlines', async (context) => {
  const deadlines: number[] = []
  context.mock.method(AbortSignal, 'timeout', (ms: number) => {
    deadlines.push(ms)
    return new AbortController().signal
  })
  for (const status of [409, 412]) {
    let sends = 0
    const client = processingClient('http://127.0.0.1:4310', '', async () => {
      sends++
      return json(
        {
          code: 'stale_question',
          message: 'Refresh.',
          recovery: 'refresh',
          correlation_id: 'owned',
        },
        status,
      )
    })
    await assert.rejects(
      client.answer(id, id, answer, id),
      (error) =>
        error instanceof IntakeRequestError &&
        error.status === status &&
        error.code === 'stale_question',
    )
    assert.equal(sends, 1)
  }
  const client = processingClient('http://127.0.0.1:4310', '', async () => json(receipt))
  await client.cancel(id, id, { expected_revision: revision, attempt_id: id }, id)
  assert.deepEqual(deadlines, [45000, 45000, 10000])
})

test('actual HTTP start returns a 202 receipt once with exact payload and provenance', async () => {
  const requests: { path: string; body: string; key: string | string[] | undefined }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        path: request.url!,
        body: Buffer.concat(chunks).toString('utf8'),
        key: request.headers['idempotency-key'],
      })
      response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify(receipt))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const client = processingClient(`http://127.0.0.1:${address.port}`, 'owned-csrf')
    assert.deepEqual(await client.start(id, start, id), receipt)
    assert.deepEqual(requests, [
      { path: `/api/v1/batches/${id}/processing`, body: JSON.stringify(start), key: id },
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('Activity rejects missing occupancy flags and private cross-context facts', async () => {
  for (const payload of [
    { jobs: [{ batch_id: id, job_id: id, state: 'running' }], truncated: false },
    { jobs: [], lane_occupied: true, truncated: false, other_context_job_id: id },
  ]) {
    const client = processingClient('http://127.0.0.1:4310', '', async () => json(payload))
    await assert.rejects(client.activity(), /invalid_contract/)
  }
})

test('research receipts require the additive proposal and exact runner profile', () => {
  const source = { kind: 'research_receipt', receipt_id: id, sha256: 'b'.repeat(64) }
  const proposal = {
    schema_version: 'bench-intake-proposal/3',
    subject_id: id,
    summary: 'Synthetic retained source receipt; no actual inference.',
    sources: [source],
  }
  validate('ProcessingProposal', proposal)
  assert.throws(() =>
    validate('ProcessingProposalV2', {
      ...proposal,
      schema_version: 'bench-intake-proposal/2',
    }),
  )
  const envelope = {
    schema_version: 'bench-intake-runner/3',
    profile_id: 'restricted-research-stub/1',
    handler_version: 'processing/3',
    job_id: id,
    attempt_id: id,
    command_id: id,
    input_sha256: 'a'.repeat(64),
    sequence: '1',
    kind: 'proposal',
    payload: proposal,
  }
  validate('ProcessingEnvelope', envelope)
  for (const changedBinding of [
    { profile_id: 'synthetic-research/2' },
    { handler_version: 'processing/2' },
    { schema_version: 'bench-intake-runner/2' },
  ]) {
    assert.throws(() => validate('ProcessingEnvelope', { ...envelope, ...changedBinding }))
  }
  for (const extra of [{ source_url: 'https://example.com/private' }, { bytes: 'private' }]) {
    assert.throws(() => validate('ResearchReceiptSource', { ...source, ...extra }))
  }
})

test('validated Processing reads expose receipt identity without private broker content', async () => {
  const proposal = {
    schema_version: 'bench-intake-proposal/3',
    subject_id: id,
    summary: 'Synthetic source-bound result.',
    sources: [{ kind: 'research_receipt', receipt_id: id, sha256: 'b'.repeat(64) }],
  }
  const job = {
    id,
    subject_id: id,
    stage: 'research',
    revision,
    state: 'ready',
    attempt_id: id,
    input_sha256: 'a'.repeat(64),
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [{ id, message_id: id, value: proposal }],
    questions: [],
  }
  const snapshot = {
    runner_status: 'fixture_only',
    batch_id: id,
    capture_revision: revision,
    jobs: [job],
    cursor: { stream_id: id, sequence: revision },
  }
  const client = processingClient('http://127.0.0.1:4310', 'owned-csrf', async () => json(snapshot))
  assert.deepEqual(await client.read(id), snapshot)
  for (const privateField of [{ raw_body: 'private' }, { provider_thread_id: 'native-handle' }]) {
    const invalid = {
      ...snapshot,
      jobs: [
        { ...job, proposals: [{ id, message_id: id, value: { ...proposal, ...privateField } }] },
      ],
    }
    const invalidClient = processingClient('http://127.0.0.1:4310', 'owned-csrf', async () =>
      json(invalid),
    )
    await assert.rejects(() => invalidClient.read(id))
  }
})
