import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Pool } from 'pg'
import { requestProviderStatus } from '#/agents/provider-status-channel.ts'

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

for (const phase of ['connect', 'refused', 'LISTEN', 'pg_notify', 'UNLISTEN'] as const) {
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
