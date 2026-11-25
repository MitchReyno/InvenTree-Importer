import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { database } from '#/db/database.ts'
import { requireHeaderContext, scopedConnectionStatus } from '#/header/binding.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

test('the scheduler recovers without a browser and scoped snapshots survive a saturated ordinary pool', async (t) => {
  const db = await isolatedDatabase()
  const health = database(db.url, 1)
  const ordinary = database(db.url, 3)
  const identity = await seedAuthority(db.pool)
  const held = await Promise.all(Array.from({ length: 3 }, () => ordinary.pool.connect()))
  let reachable = false
  let probes = 0
  const status = scopedConnectionStatus(
    health.pool,
    {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    },
    'https://inventory.example.invalid',
    async () => {
      probes += 1
      if (!reachable) {
        throw new Error('synthetic offline')
      }
      return Response.json({})
    },
  )
  try {
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const blockedAt = performance.now()
    await assert.rejects(requireHeaderContext(ordinary.pool, binding), /timeout/i)
    t.diagnostic(
      `ordinary pool checkout under saturation: ${Math.round(performance.now() - blockedAt)} ms`,
    )
    status.start()
    const start = performance.now()
    while (probes === 0 && performance.now() - start < 2000) {
      await delay(20)
    }
    assert.equal(probes, 1, 'startup probes without a browser request')
    const readAt = performance.now()
    const snapshots = await Promise.all(Array.from({ length: 8 }, () => status()))
    t.diagnostic(`eight scoped snapshots: ${Math.round(performance.now() - readAt)} ms`)
    assert.ok(snapshots.every((snapshot) => snapshot.target.state === 'unavailable'))
    assert.equal(probes, 1)
    reachable = true
    const deadline = performance.now() + 5000
    while (performance.now() < deadline && probes < 2) {
      await delay(20)
    }
    assert.equal((await status()).target.state, 'reachable')
    assert.equal(probes, 2)
  } finally {
    status.stop()
    for (const client of held) {
      client.release()
    }
    await Promise.all([health.close(), ordinary.close()])
    await db.dispose()
  }
})

test('stopping during the scope fence prevents a late outgoing check', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const health = database(db.url, 1)
  const held = await health.pool.connect()
  let probes = 0
  const status = scopedConnectionStatus(
    health.pool,
    {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    },
    'https://inventory.example.invalid',
    async () => {
      probes += 1
      return Response.json({})
    },
  )
  try {
    const pending = status.check()
    status.stop()
    held.release()
    assert.equal((await pending).target.state, 'unknown')
    assert.equal(probes, 0)
  } finally {
    await health.close()
    await db.dispose()
  }
})

test('manual recovery restores the healthy cadence and a cached check cannot postpone it', async (t) => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  let reachable = false
  let probes = 0
  let finished!: () => void
  const first = new Promise<void>((resolve) => {
    finished = resolve
  })
  const status = scopedConnectionStatus(
    db.pool,
    {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    },
    'https://inventory.example.invalid',
    async () => {
      probes += 1
      if (!reachable) throw new Error('synthetic offline')
      return Response.json({})
    },
    undefined,
    undefined,
    () => finished(),
  )
  try {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    status.start()
    t.mock.timers.tick(0)
    await first
    reachable = true
    t.mock.timers.tick(1000)
    assert.equal((await status.check()).target.state, 'reachable')
    t.mock.timers.tick(3500)
    assert.equal((await status.check()).target.state, 'reachable')
    assert.equal(probes, 2)
    t.mock.timers.tick(26_499)
    await status()
    assert.equal(probes, 2)
    const next = new Promise<void>((resolve) => {
      finished = resolve
    })
    t.mock.timers.tick(1)
    await next
    assert.equal(probes, 3)
  } finally {
    status.stop()
    t.mock.timers.reset()
    await db.dispose()
  }
})
