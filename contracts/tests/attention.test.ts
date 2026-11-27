import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'
import { attentionClient } from '../src/client.ts'

const none = {
  questions: 0,
  failed: 0,
  jobs: 0,
  ready: 0,
  running: 0,
  waiting: 0,
  queued: 0,
  ready_lots: 0,
}
const noSteps = { examine: none, research: none, images: none, inventory: none }

const batch = '00000000-0000-4000-8000-000000000001'
const question = '00000000-0000-4000-8000-000000000002'

const attention = {
  batch_id: batch,
  revision: '7',
  processing: { questions: 1, failed: 0, running: 0, lots: 0, paused: false, steps: noSteps },
  review: { to_check: 2, changed_after_review: 1, needs_answer: 1, to_decide: 1, records: 0 },
  changes: { ready: 3, failed: 0, uncertain: 1, runs: 0 },
  items: [
    {
      key: `question:${question}`,
      group: 'question',
      tab: 'processing',
      title: 'Is this 10kΩ or 100kΩ?',
      detail: 'Using 10kΩ from the label until you answer.',
      route: `${batch}/processing/examine/${question}`,
    },
  ],
  items_truncated: false,
}

test('batch attention gives tab counts and routed need-you items', () => {
  validate('BatchAttention', attention)
  validate('BatchAttention', { ...attention, items: [] })
  validate('BatchAttention', {
    ...attention,
    processing: { questions: 1, failed: 1, running: 0, lots: 0, paused: false, steps: noSteps },
    items: [
      ...attention.items,
      {
        key: `failed:${question}`,
        group: 'failed_job',
        tab: 'processing',
        title: 'An Examine attempt failed',
        detail: null,
        route: `${batch}/processing/examine`,
      },
    ],
  })
})

test('batch attention refuses unknown fields, groups and routes outside the batch', () => {
  assert.throws(() => validate('BatchAttention', { ...attention, extra: true }))
  assert.throws(() =>
    validate('BatchAttention', {
      ...attention,
      items: [{ ...attention.items[0], group: 'other' }],
    }),
  )
  assert.throws(() =>
    validate('BatchAttention', {
      ...attention,
      items: [{ ...attention.items[0], route: 'https://example.test/' }],
    }),
  )
  assert.throws(() =>
    validate('BatchAttention', { ...attention, review: { ...attention.review, to_check: -1 } }),
  )
})

test('the attention client reads the batch route', async () => {
  const requests: string[] = []
  const client = attentionClient('http://localhost', 'csrf', async (input) => {
    const request = input instanceof Request ? input : new Request(input)
    requests.push(new URL(request.url).pathname)
    return new Response(JSON.stringify(attention), {
      headers: { 'content-type': 'application/json' },
    })
  })

  assert.deepEqual(await client.read(batch), attention)
  assert.deepEqual(requests, [`/api/v1/batches/${batch}/attention`])
})

test('batch attention counts the lots needing an answer for Review › Lots', () => {
  const { needs_answer: _omitted, ...withoutNeedsAnswer } = attention.review
  assert.throws(() => validate('BatchAttention', { ...attention, review: withoutNeedsAnswer }))
})

test('batch attention says whether the batch is paused and counts its live lots and waiting work', () => {
  validate('BatchAttention', {
    ...attention,
    processing: {
      ...attention.processing,
      lots: 12,
      paused: true,
      steps: {
        ...noSteps,
        research: { ...none, jobs: 12, ready: 7, waiting: 1, queued: 2, ready_lots: 7 },
      },
    },
  })
  for (const field of ['lots', 'paused'] as const) {
    const { [field]: _omitted, ...without } = attention.processing
    assert.throws(() => validate('BatchAttention', { ...attention, processing: without }), field)
  }
  for (const field of ['waiting', 'queued', 'ready_lots'] as const) {
    const { [field]: _omitted, ...without } = none
    assert.throws(
      () =>
        validate('BatchAttention', {
          ...attention,
          processing: { ...attention.processing, steps: { ...noSteps, images: without } },
        }),
      field,
    )
  }
})
