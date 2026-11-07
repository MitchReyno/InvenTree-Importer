import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BatchAttentionDto } from '@invimport/contracts'
import { createServer } from '../src/api/server.ts'
import { devConfig } from '../src/config.ts'
import { registerAttention } from '../src/attention/routes.ts'
import { CaptureError } from '../src/capture/repository.ts'

const noSteps = {
  examine: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  research: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  images: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  inventory: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
}

const batch = '00000000-0000-4000-8000-0000000000b1'
const config = devConfig({
  INTAKE_ORIGIN: 'http://127.0.0.1:4333',
  INTAKE_CREDENTIAL_REF: 'attention-fixture',
  INTAKE_DEV_API_KEY: 'synthetic-only',
})

const empty: BatchAttentionDto = {
  batch_id: batch,
  revision: '1',
  processing: { questions: 0, failed: 0, running: 0, steps: noSteps },
  review: { to_check: 0, changed_after_review: 0, to_decide: 0, records: 0 },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [],
  items_truncated: false,
}

test('the attention read uses the host gate, validates the batch id and serializes the contract', async () => {
  const app = createServer(config)
  const reads: string[] = []
  registerAttention(app, config, async (batchId) => {
    reads.push(batchId)
    return empty
  })
  try {
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/batches/${batch}/attention`,
      headers: { host: 'foreign.invalid' },
    })
    assert.equal(foreign.statusCode, 403)
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/batches/not-an-id/attention',
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(invalid.statusCode, 400)
    assert.deepEqual(reads, [])

    const result = await app.inject({
      method: 'GET',
      url: `/api/v1/batches/${batch}/attention`,
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.json(), empty)
    assert.deepEqual(reads, [batch])
  } finally {
    await app.close()
  }
})

test('a missing batch reports its capture error without leaking details', async () => {
  const app = createServer(config)
  registerAttention(app, config, async () => {
    throw new CaptureError(404, 'batch_not_found')
  })
  try {
    const result = await app.inject({
      method: 'GET',
      url: `/api/v1/batches/${batch}/attention`,
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(result.statusCode, 404)
    assert.equal(result.json().code, 'batch_not_found')
    assert.equal(result.json().message, 'Batch attention is unavailable.')
  } finally {
    await app.close()
  }
})

test('an unconfigured setup refuses the read before touching storage', async () => {
  const unconfigured = devConfig({ INTAKE_ORIGIN: 'http://127.0.0.1:4333' })
  const app = createServer(unconfigured)
  let reads = 0
  registerAttention(app, unconfigured, async () => {
    reads += 1
    return empty
  })
  try {
    const result = await app.inject({
      method: 'GET',
      url: `/api/v1/batches/${batch}/attention`,
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(result.statusCode, 503)
    assert.equal(reads, 0)
  } finally {
    await app.close()
  }
})
