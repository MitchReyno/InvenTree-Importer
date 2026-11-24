import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHmac } from 'node:crypto'
import type { Pool } from 'pg'
import {
  requestProviderStatus,
  serveProviderStatusRequests,
  STATUS_REPLY_CHANNEL,
  STATUS_REQUEST_CHANNEL,
} from '#/agents/provider-status-channel.ts'

const binding = {
  actorId: '10000000-0000-4000-8000-000000000001',
  targetId: '10000000-0000-4000-8000-000000000002',
  targetContextId: '10000000-0000-4000-8000-000000000003',
  channelSecret: 'channel-secret-for-the-status-exchange-tests',
}

/** A pool whose one client never answers the named statement, recording how it is released. */
function stallingPool(stalls: 'LISTEN' | 'pg_notify' | 'UNLISTEN' | 'connect' | 'refused') {
  const released: (boolean | undefined)[] = []
  const client = Object.assign(new EventEmitter(), {
    query: (sql: string) =>
      sql.includes(stalls) ? new Promise(() => {}) : Promise.resolve({ rows: [] }),
    release: (destroy?: boolean) => {
      released.push(destroy)
    },
  })
  const pool = {
    connect: () => {
      if (stalls === 'connect') {
        return new Promise(() => {})
      }
      if (stalls === 'refused') {
        return Promise.reject(new Error('connection refused'))
      }
      return Promise.resolve(client)
    },
  } as unknown as Pool
  return { pool, released, client }
}

for (const phase of ['connect', 'refused', 'LISTEN', 'pg_notify'] as const) {
  test(`a request whose ${phase} phase stalls or fails ends within its deadline`, async () => {
    const { pool, released } = stallingPool(phase)
    const started = Date.now()
    assert.equal(await requestProviderStatus(pool, binding, 300), undefined)
    const elapsed = Date.now() - started
    assert.ok(elapsed < 450, `took ${elapsed} ms`)
    if (phase === 'connect' || phase === 'refused') {
      assert.deepEqual(released, [])
    } else {
      // A connection left in an unknown state is closed, not reused.
      assert.deepEqual(released, [true])
    }
  })
}

test('a connection lost while waiting ends the request and is closed', async () => {
  const { pool, released, client } = stallingPool('UNLISTEN')
  const waiting = requestProviderStatus(pool, binding, 2000)
  await new Promise((resolve) => setTimeout(resolve, 50))
  client.emit('error', new Error('terminated'))
  const started = Date.now()
  assert.equal(await waiting, undefined)
  assert.ok(Date.now() - started < 300)
  assert.deepEqual(released, [true])
})

/** Signs a message as the API and worker do, from the channel secret alone. */
function signed(kind: 'request' | 'reply', body: unknown) {
  const key = createHmac('sha256', binding.channelSecret).update('bench-provider-status/1').digest()
  const text = JSON.stringify(body)
  return createHmac('sha256', key).update(`${kind}\n${text}`).digest('hex') + '.' + text
}

const signedReply = (id: string, status: unknown) => signed('reply', { id, status })

test('a reply arrives, then a stalled UNLISTEN closes the connection within the budget', async () => {
  const status = { claude: { state: 'not_saved' }, codex: { state: 'signed_in' } }
  const queries: string[] = []
  const released: (boolean | undefined)[] = []
  const client = Object.assign(new EventEmitter(), {
    query: (sql: string, params?: string[]) => {
      queries.push(sql)
      if (sql.includes('UNLISTEN')) {
        return new Promise(() => {})
      }
      if (sql.includes('pg_notify')) {
        const id = (JSON.parse(params![1].slice(65)) as { id: string }).id
        setTimeout(() => {
          client.emit('notification', {
            channel: STATUS_REPLY_CHANNEL,
            payload: signedReply(id, status),
          })
        }, 20)
      }
      return Promise.resolve({ rows: [] })
    },
    release: (destroy?: boolean) => {
      released.push(destroy)
    },
  })
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool
  const started = Date.now()
  assert.deepEqual(await requestProviderStatus(pool, binding, 1000), status)
  assert.ok(Date.now() - started < 1000)
  assert.ok(queries.some((sql) => sql.includes('UNLISTEN')))
  assert.deepEqual(released, [true])
})

test('a worker reply that stalls is dropped at the request expiry, and close waits for it', async () => {
  const released: (boolean | undefined)[] = []
  const listener = Object.assign(new EventEmitter(), {
    query: () => Promise.resolve({ rows: [] }),
    release: () => {},
  })
  const replier = Object.assign(new EventEmitter(), {
    query: (sql: string) => (sql.includes('pg_notify') ? new Promise(() => {}) : Promise.resolve()),
    release: (destroy?: boolean) => {
      released.push(destroy)
    },
  })
  let connections = 0
  const pool = {
    connect: () => Promise.resolve(connections++ === 0 ? listener : replier),
  } as unknown as Pool
  const worker = serveProviderStatusRequests(pool, binding, async () => ({
    claude: { state: 'not_saved', revision: '9f7a2b3c-1d4e-4f5a-8b6c-7d8e9f0a1b2c' },
    codex: { state: 'signed_in' },
  }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const expiresAt = Date.now() + 400
  listener.emit('notification', {
    channel: STATUS_REQUEST_CHANNEL,
    payload: signed('request', {
      id: 'request-1',
      actor_id: binding.actorId,
      target_id: binding.targetId,
      target_context_id: binding.targetContextId,
      expires_at: expiresAt,
    }),
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(released, [])
  await worker.close()
  // Closing waited for the stalled reply, which its expiry ended on a closed connection.
  assert.ok(Date.now() >= expiresAt - 5)
  assert.deepEqual(released, [true])
})
