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
import { workerStatusSource } from '#/agents/provider-status.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'

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
  const checkedAt = '2026-11-24T00:10:58.000Z'
  const status = {
    claude: { state: 'not_saved', checked_at: checkedAt },
    codex: { state: 'signed_in', checked_at: checkedAt, refreshing: false },
  }
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
  const checkedAt = '2026-11-24T00:10:58.000Z'
  const worker = serveProviderStatusRequests(pool, binding, async () => ({
    claude: {
      state: 'not_saved',
      revision: '9f7a2b3c-1d4e-4f5a-8b6c-7d8e9f0a1b2c',
      checked_at: checkedAt,
    },
    codex: { state: 'signed_in', checked_at: checkedAt, refreshing: false },
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

test('Check again reaches the worker as its own read, never folded into another read in flight', async () => {
  const listener = Object.assign(new EventEmitter(), {
    query: () => Promise.resolve({ rows: [] }),
    release: () => {},
  })
  const replier = Object.assign(new EventEmitter(), {
    query: () => Promise.resolve({ rows: [] }),
    release: () => {},
  })
  let connections = 0
  const pool = {
    connect: () => Promise.resolve(connections++ === 0 ? listener : replier),
  } as unknown as Pool
  const checkedAt = '2026-11-24T00:10:58.000Z'
  const reads: boolean[] = []
  let finish!: () => void
  const worker = serveProviderStatusRequests(pool, binding, async (_budgetMs, refresh) => {
    reads.push(refresh)
    if (!refresh) {
      await new Promise<void>((resolve) => (finish = resolve))
    }
    return {
      claude: { state: 'unknown', reason: 'vm_unreachable' },
      codex: { state: 'signed_in', checked_at: checkedAt, refreshing: false },
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const request = (id: string, refresh: boolean | undefined) => {
    listener.emit('notification', {
      channel: STATUS_REQUEST_CHANNEL,
      payload: signed('request', {
        id,
        actor_id: binding.actorId,
        target_id: binding.targetId,
        target_context_id: binding.targetContextId,
        expires_at: Date.now() + 1000,
        ...(refresh === undefined ? {} : { refresh }),
      }),
    })
  }
  // An API from before Check again sends no flag; a plain read is still in flight.
  request('plain', undefined)
  request('plain-2', false)
  request('forced', true)
  // A second Check again reads anew too: the first may predate a sign-in change.
  request('forced-2', true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(reads, [false, true, true])
  // A flag of the wrong type is refused unread.
  listener.emit('notification', {
    channel: STATUS_REQUEST_CHANNEL,
    payload: signed('request', {
      id: 'bad',
      actor_id: binding.actorId,
      target_id: binding.targetId,
      target_context_id: binding.targetContextId,
      expires_at: Date.now() + 1000,
      refresh: 'true',
    }),
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(reads, [false, true, true])
  finish()
  await worker.close()
})

test('the API reuses a read for its window by the monotonic clock, whatever the wall clock does', async () => {
  // A profile without agent sessions answers without the worker, dated by the wall clock.
  const config = { profileId: undefined } as unknown as ProcessingConfig
  let wall = Date.parse('2026-11-24T06:00:00.000Z')
  let monotonic = 0
  const source = workerStatusSource(
    {} as Pool,
    config,
    5000,
    () => new Date(wall),
    () => monotonic,
  )
  const first = await source(false)
  // The wall clock steps back an hour; the window still ends 5 s later by the monotonic clock.
  wall -= 3_600_000
  monotonic = 4999
  assert.equal((await source(false)).readAt, first.readAt)
  monotonic = 5000
  const next = await source(false)
  assert.notEqual(next.readAt, first.readAt)
  assert.equal(next.readAt.getTime(), wall)
})
