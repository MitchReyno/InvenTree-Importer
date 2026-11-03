import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.ts'
import { headerClient } from '../src/client.ts'

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
