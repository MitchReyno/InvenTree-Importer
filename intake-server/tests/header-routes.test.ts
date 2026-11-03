import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/api/server.ts'
import { devConfig } from '../src/config.ts'
import { registerHeader } from '../src/header/routes.ts'

const config = devConfig({
  INTAKE_ORIGIN: 'http://127.0.0.1:4333',
  INTAKE_CREDENTIAL_REF: 'header-fixture',
  INTAKE_DEV_API_KEY: 'synthetic-only',
})

test('header reads use the existing host/origin gate and serialize only scoped contracts', async () => {
  const app = createServer(config)
  let calls = 0
  registerHeader(
    app,
    config,
    async () => {
      calls += 1
      return {
        actor_id: config.actorId,
        target_id: config.targetId,
        target_context_id: config.targetContextId,
        target: {
          state: 'unconfigured',
          freshness: 'unobserved',
          observed_at: null,
          navigation_url: null,
          label: null,
          failure_code: null,
        },
      }
    },
    async () => ({
      actor_id: config.actorId,
      target_id: config.targetId,
      target_context_id: config.targetContextId,
      observed_at: '2026-11-03T00:00:00Z',
      work: [],
      active_sessions: [],
      work_truncated: false,
      sessions_truncated: false,
      lane_occupied: false,
    }),
  )
  try {
    const refused = await app.inject({
      method: 'GET',
      url: '/api/v1/connection-status',
      headers: { host: 'foreign.invalid' },
    })
    assert.equal(refused.statusCode, 403)
    assert.equal(calls, 0)
    const result = await app.inject({
      method: 'GET',
      url: '/api/v1/connection-status',
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(result.statusCode, 200)
    assert.equal(result.json().target.navigation_url, null)
    assert.equal(calls, 1)
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/header-work?origin=https://foreign.invalid',
      headers: { host: '127.0.0.1:4333' },
    })
    assert.equal(unknown.statusCode, 400)
  } finally {
    await app.close()
  }
})
