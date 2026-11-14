import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'
import { headerClient } from '../generated/client.ts'

const id = '00000000-0000-4000-8000-000000000001'
const work = {
  actor_id: id,
  target_id: id,
  target_context_id: id,
  observed_at: '2026-11-03T00:00:00Z',
  work: [],
  active_sessions: [],
  work_truncated: false,
  sessions_truncated: false,
  lane_occupied: false,
}

test('bounded header contracts refuse private session fields and unknown coverage', () => {
  validate('HeaderWork', work)
  const session = {
    attempt_id: id,
    batch_id: id,
    job_id: id,
    stage: 'reading',
    state: 'cancelled',
    selection: { provider: 'codex', authentication: 'subscription', model: 'synthetic-only' },
    actual_model: null,
    progress: 'responding',
    occupies_lane: true,
    session_state: null,
    latest_status: null,
  }
  validate('HeaderWork', { ...work, active_sessions: [session] })
  assert.throws(() =>
    validate('HeaderWork', {
      ...work,
      active_sessions: [{ ...session, native_session_id: 'private' }],
    }),
  )
  assert.throws(() =>
    validate('HeaderWork', { ...work, active_sessions: Array.from({ length: 51 }, () => session) }),
  )
  assert.throws(() => validate('HeaderWork', { ...work, sessions_truncated: undefined }))
  assert.throws(() => validate('HeaderWorkQuery', { batch_id: id, target: 'browser-selected' }))
})

test('generated header client uses scoped read routes and validated response contracts', async () => {
  const calls: string[] = []
  const client = headerClient('https://app.example.invalid/', 'a'.repeat(64), async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify(work), { headers: { 'content-type': 'application/json' } })
  })
  assert.deepEqual(await client.work({ batch_id: id }), work)
  assert.equal(new URL(calls[0]).pathname, '/api/v1/header-work')
  assert.equal(new URL(calls[0]).searchParams.get('batch_id'), id)
})

test('the connection target may name its kind, and only the two known kinds', () => {
  const status = {
    actor_id: id,
    target_id: id,
    target_context_id: id,
    target: {
      state: 'reachable',
      freshness: 'fresh',
      observed_at: '2026-11-03T00:00:00Z',
      failure_code: null,
      navigation_url: 'http://127.0.0.1:4999/',
      label: '127.0.0.1:4999',
    },
  }
  validate('ConnectionStatus', status)
  validate('ConnectionStatus', { ...status, target: { ...status.target, kind: 'owned_test' } })
  validate('ConnectionStatus', { ...status, target: { ...status.target, kind: 'configured' } })
  assert.throws(() =>
    validate('ConnectionStatus', { ...status, target: { ...status.target, kind: 'production' } }),
  )
})

test('the connection target may carry the InvenTree version, and older reads without it stay valid', () => {
  const target = {
    state: 'reachable',
    freshness: 'fresh',
    observed_at: '2026-11-03T00:00:00Z',
    failure_code: null,
    navigation_url: 'http://127.0.0.1:4999/',
    label: '127.0.0.1:4999',
  }
  const status = { actor_id: id, target_id: id, target_context_id: id, target }
  validate('ConnectionStatus', status)
  validate('ConnectionStatus', { ...status, target: { ...target, version: '0.17.10' } })
  validate('ConnectionStatus', { ...status, target: { ...target, version: null } })
  for (const version of ['', 'x'.repeat(65), 'line\nbreak']) {
    assert.throws(() => validate('ConnectionStatus', { ...status, target: { ...target, version } }))
  }
})

test('the header may count each step of a batch, and reads without counts stay valid', () => {
  validate('HeaderWork', work)
  const step = { jobs: 5, ready: 3, running: 1 }
  const steps = { examine: step, research: step, images: step, inventory: step }
  validate('HeaderWork', { ...work, batch_steps: [{ batch_id: id, steps }] })
  validate('HeaderWork', { ...work, batch_steps: [] })
  assert.throws(() =>
    validate('HeaderWork', { ...work, batch_steps: [{ batch_id: id, steps: { examine: step } }] }),
  )
  assert.throws(() =>
    validate('HeaderWork', {
      ...work,
      batch_steps: [{ batch_id: id, steps: { ...steps, research: { ...step, ready: -1 } } }],
    }),
  )
  assert.throws(() =>
    validate('HeaderWork', {
      ...work,
      batch_steps: Array.from({ length: 6 }, () => ({ batch_id: id, steps })),
    }),
  )
})
