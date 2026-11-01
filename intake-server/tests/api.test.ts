import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { schemas } from '@invimport/contracts'
import { intakeClient } from '@invimport/contracts/client'
import { createServer, installContracts } from '../src/api/server.ts'
import { devConfig } from '../src/config.ts'

const id = '00000000-0000-4000-8000-000000000001'
const secondId = '00000000-0000-4000-8000-000000000002'
const thirdId = '00000000-0000-4000-8000-000000000003'
const examples = {
  BatchCreate: { title: 'Two packets', note: 'human-entered, no inference' },
  LotCreate: { expected_batch_revision: '1', label: 'packet A', note: 'physical lot', part_subject_id: id },
  PartSelection: { expected_revision: '7', choice: { target_context_id: secondId, model: 'part', pk: '9007199254740993', observation_id: thirdId } },
  LotSelection: { expected_revision: '1', quantity: { mode: 'set', value: '9999999999999.999999' }, location: { mode: 'inherit' } },
  Preparation: { expected_batch_revision: '1', selected_lot_ids: [id] },
  Approval: { preparation_id: secondId, expected_plan_sha256: 'a'.repeat(64), expected_review_fingerprint: 'b'.repeat(64), selected_lot_ids: [id, thirdId], expected_target_revision: '11' },
  Cancellation: { expected_run_revision: '9007199254740993' },
  RunSnapshot: { run_id: id, revision: '1', state: 'recovery_required', effect_certainty: 'unknown', confirmed_stock_ids: [], cursor: { stream_id: id, sequence: '9007199254740993' } },
  WorkerEnvelope: { schema_version: 'bench-intake-worker/1', command_id: secondId, attempt_id: thirdId, input_sha256: 'a'.repeat(64), handler_version: 'v1', sequence: '13', kind: 'terminal', payload: { state: 'interrupted' } },
} as const

async function echoFixture() {
  const app = Fastify()
  installContracts(app)
  for (const name of Object.keys(examples) as (keyof typeof examples)[]) app.post(`/${name}`, { schema: { body: schemas[name], response: { 200: schemas[name] } } }, async req => req.body)
  app.get('/leak', { schema: { response: { 200: schemas.Health } } }, async () => ({ status: 'ok', api_version: 'bench-intake-app/1', secret: 'must-not-leak' }))
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  return { app, base }
}
test('first-slice examples traverse actual strict HTTP parser/serializer (fixture routes only)', async () => {
  const { app, base } = await echoFixture()
  try {
    for (const [name, example] of Object.entries(examples)) {
      const response = await fetch(`${base}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(example) })
      assert.equal(response.status, 200, await response.clone().text())
      assert.deepEqual(await response.json(), example)
    }
    for (const body of ['{"expected_run_revision":1}', '{"expected_run_revision":"1","actor":"injected"}', '{"expected_run_revision":"1","expected_run_revision":"2"}', '{"expected_run_revision":1e999}', '{"expected_run_revision":"9223372036854775808"}']) {
      assert.equal((await fetch(`${base}/Cancellation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 400)
    }
    const leak = await fetch(`${base}/leak`)
    assert.equal(leak.status, 500)
    assert(!((await leak.text()).includes('must-not-leak')))
  } finally { await app.close() }
})
test('HTTP adversarial parsing rejects equal duplicates, nested fields, wrong-model refs, bytes/depth and contradictory envelopes', async () => {
  const { app, base } = await echoFixture()
  const send = (name: string, body: string | Buffer) => fetch(`${base}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : new Uint8Array(body) })
  try {
    const cases: [string, string | Buffer][] = [
      ['Cancellation', '{"expected_run_revision":"1","expected_run_revision":"1"}'],
      ['Cancellation', '{"expected_run_revision":"1","\\u0065xpected_run_revision":"1"}'],
      ['Cancellation', Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])],
      ['Cancellation', '['.repeat(65) + 'null' + ']'.repeat(65)],
      ['PartSelection', JSON.stringify({ ...examples.PartSelection, choice: { ...examples.PartSelection.choice, model: 'location' } })],
      ['PartSelection', JSON.stringify({ ...examples.PartSelection, choice: { ...examples.PartSelection.choice, raw_url: 'http://untrusted.invalid' } })],
      ['Approval', JSON.stringify({ ...examples.Approval, selected_lot_ids: [id, id] })],
      ['WorkerEnvelope', JSON.stringify({ ...examples.WorkerEnvelope, payload: { state: 'running' } })],
      ['LotSelection', JSON.stringify({ expected_revision: '1', quantity: { mode: 'set', value: '1.0000001' } })],
    ]
    for (const [name, body] of cases) assert.equal((await send(name, body)).status, 400, `${name}: invalid boundary input accepted`)
    assert.equal((await send('BatchCreate', JSON.stringify({ title: 'bounded', note: 'x'.repeat(262145) }))).status, 413)
    // Nearby valid controls: whitespace in human text, missing vs clear vs inherit and smallest quantity.
    for (const quantity of [undefined, { mode: 'clear' }, { mode: 'inherit' }, { mode: 'set', value: '0.000001' }]) {
      const selection = { expected_revision: '9223372036854775807', ...(quantity ? { quantity } : {}) }
      const response = await send('LotSelection', JSON.stringify(selection))
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), selection)
    }
  } finally { await app.close() }
})
test('bootstrap stable attribution, safe missing-key state, redaction, Host/Origin and mutation refusal', async () => {
  const config = devConfig({ INTAKE_DEV_API_KEY: 'fake-test-key-only', INTAKE_CREDENTIAL_REF: 'fixture-v1', INTAKE_ACTOR_ID: thirdId, INTAKE_TARGET_ID: secondId, INTAKE_TARGET_CONTEXT_ID: id })
  const app = createServer(config)
  app.post('/fixture', { schema: { body: schemas.BatchCreate, response: { 200: schemas.BatchCreate } } }, async req => req.body)
  try {
    const headers = { host: '127.0.0.1:4310' }
    const response = await app.inject({ url: '/api/v1/bootstrap', headers })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().status, 'configured')
    assert.equal(response.json().actor_id, thirdId)
    assert.equal(response.json().target_id, secondId)
    assert.equal(response.json().target_context_id, id)
    assert(!response.body.includes('fake-test-key-only'))
    for (const hostile of [{ host: 'evil.example' }, { ...headers, origin: 'http://evil.example' }]) assert.equal((await app.inject({ url: '/api/v1/bootstrap', headers: hostile })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/approvals', headers })).statusCode, 403)
    const commandHeaders = { ...headers, origin: config.origin, 'x-intake-csrf': response.json().csrf_token }
    assert.equal((await app.inject({ method: 'POST', url: '/fixture', headers: commandHeaders, payload: examples.BatchCreate })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/fixture', headers: { ...commandHeaders, 'x-intake-csrf': '0'.repeat(64) }, payload: examples.BatchCreate })).statusCode, 403)
  } finally { await app.close() }
  const missing = createServer(devConfig({}))
  try {
    assert.equal((await missing.inject({ url: '/api/v1/bootstrap', headers: { host: '127.0.0.1:4310' } })).json().status, 'setup_required')
  } finally { await missing.close() }
})
test('generated typed client consumes actual loopback bootstrap API', async () => {
  const app = createServer(devConfig({ INTAKE_ORIGIN: 'http://127.0.0.1:4319' }))
  try {
    await app.listen({ host: '127.0.0.1', port: 4319 })
    const response = await intakeClient('http://127.0.0.1:4319').bootstrap()
    assert.equal(response.status, 'setup_required')
    assert.equal(response.mutation_enabled, false)
  } finally { await app.close() }
})
