import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { transaction } from '../../src/db/database.ts'
import { claimSessionSlot, releaseSessionSlot } from '../../src/agents/session/slots.ts'
import { acquireAgentSupervisor } from '../../src/agents/worker.ts'
import { saveAgentSettings } from '../../src/agents/settings.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function fourQueuedSessions(fixture: Fixture) {
  const capture = await fixture.seedCapture()
  await capture.edit({
    kind: 'add_lot',
    label: 'Packet C',
    note: 'Third packet.',
    part_subject_id: null,
  })
  await capture.edit({
    kind: 'add_lot',
    label: 'Packet D',
    note: 'Fourth packet.',
    part_subject_id: null,
  })
  const lots = ['Packet A', 'Packet B', 'Packet C', 'Packet D'].map((label) =>
    capture.batch.lots.find((lot) => lot.label === label)!,
  )
  const sessions = []
  for (const lot of lots) {
    // Sequential so queue order follows the lots.
    sessions.push(await lotSession(fixture, capture, lot, { state: 'queued' }))
  }
  return sessions
}

const claim = (fixture: Fixture, attemptId: string) =>
  transaction(fixture.runner.pool, (client) => claimSessionSlot(client, fixture.config, attemptId))
/** Settlement frees the slot and the session leaves the queue. */
const release = (fixture: Fixture, attemptId: string) =>
  transaction(fixture.runner.pool, async (client) => {
    await releaseSessionSlot(client, attemptId)
    await client.query("UPDATE agent_session SET session_state='finished' WHERE attempt_id=$1", [
      attemptId,
    ])
  })
const occupied = async (fixture: Fixture) =>
  (
    await fixture.db.pool.query<{ attempt_id: string }>(
      'SELECT attempt_id FROM agent_slot WHERE attempt_id IS NOT NULL ORDER BY slot_index',
    )
  ).rows.map((row) => row.attempt_id)

async function limit(fixture: Fixture, value: number) {
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(fixture.api.pool, fixture.config, {
    expected_revision: (current.value as { revision: string }).revision,
    selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
    session_concurrency: value,
  })
}

test('with a limit of 3 the fourth session waits, then starts when a slot frees', async () => {
  const fixture = await processingFixture()
  try {
    const [a, b, c, d] = await fourQueuedSessions(fixture)
    assert.equal(await claim(fixture, a.attempt), true)
    assert.equal(await claim(fixture, b.attempt), true)
    assert.equal(await claim(fixture, c.attempt), true)
    assert.equal(await claim(fixture, d.attempt), false)
    assert.deepEqual(await occupied(fixture), [a.attempt, b.attempt, c.attempt])
    // A claim already held is kept, not doubled.
    assert.equal(await claim(fixture, a.attempt), true)
    assert.equal((await occupied(fixture)).length, 3)
    await release(fixture, b.attempt)
    assert.equal(await claim(fixture, d.attempt), true)
    assert.deepEqual((await occupied(fixture)).sort(), [a.attempt, c.attempt, d.attempt].sort())
  } finally {
    await fixture.dispose()
  }
})

test('queued sessions start oldest first', async () => {
  const fixture = await processingFixture()
  try {
    const [a, b, c, d] = await fourQueuedSessions(fixture)
    await limit(fixture, 2)
    assert.equal(await claim(fixture, a.attempt), true)
    // One slot left: the newest queued session cannot take it ahead of the older ones.
    assert.equal(await claim(fixture, d.attempt), false)
    assert.equal(await claim(fixture, b.attempt), true)
    await release(fixture, a.attempt)
    assert.equal(await claim(fixture, d.attempt), false)
    assert.equal(await claim(fixture, c.attempt), true)
  } finally {
    await fixture.dispose()
  }
})

test('lowering the limit leaves running sessions alone and only stops new claims', async () => {
  const fixture = await processingFixture()
  try {
    const [a, b, c, d] = await fourQueuedSessions(fixture)
    for (const session of [a, b, c]) {
      assert.equal(await claim(fixture, session.attempt), true)
    }
    await limit(fixture, 1)
    assert.deepEqual(await occupied(fixture), [a.attempt, b.attempt, c.attempt])
    assert.equal(await claim(fixture, d.attempt), false)
    await release(fixture, a.attempt)
    await release(fixture, b.attempt)
    assert.equal(await claim(fixture, d.attempt), false)
    await release(fixture, c.attempt)
    assert.equal(await claim(fixture, d.attempt), true)
  } finally {
    await fixture.dispose()
  }
})

test('a /1 lane holder counts as one slot, and an occupied slot blocks a new supervisor', async () => {
  const fixture = await processingFixture()
  try {
    const [a, b, c, d] = await fourQueuedSessions(fixture)
    await fixture.db.pool.query('INSERT INTO processing_lane(actor_id,attempt_id) VALUES($1,$2)', [
      fixture.identity.actor,
      d.attempt,
    ])
    assert.equal(await claim(fixture, a.attempt), true)
    assert.equal(await claim(fixture, b.attempt), true)
    assert.equal(await claim(fixture, c.attempt), false)
    await fixture.db.pool.query('UPDATE processing_lane SET attempt_id=NULL WHERE actor_id=$1', [
      fixture.identity.actor,
    ])
    assert.equal(await claim(fixture, c.attempt), true)
    await assert.rejects(
      acquireAgentSupervisor(fixture.runner.pool, fixture.config),
      /agent_reap_confirmation_required/,
    )
    for (const session of [a, b, c]) {
      await release(fixture, session.attempt)
    }
    const owner = await acquireAgentSupervisor(fixture.runner.pool, fixture.config)
    owner.release(true)
  } finally {
    await fixture.dispose()
  }
})

test('the settings API saves and returns the running-session limit', async () => {
  const fixture = await processingFixture()
  try {
    const initial = await fixture.http('/agent-settings')
    assert.equal((initial.value as { session_concurrency: number }).session_concurrency, 3)
    await limit(fixture, 5)
    const saved = await fixture.http('/agent-settings')
    assert.equal((saved.value as { session_concurrency: number }).session_concurrency, 5)
  } finally {
    await fixture.dispose()
  }
})

test('concurrent claims cannot both take the last slot', async () => {
  const fixture = await processingFixture()
  try {
    const [a, b] = await fourQueuedSessions(fixture)
    await limit(fixture, 1)
    const results = await Promise.all([claim(fixture, a.attempt), claim(fixture, b.attempt)])
    assert.deepEqual(results, [true, false])
    assert.deepEqual(await occupied(fixture), [a.attempt])
  } finally {
    await fixture.dispose()
  }
})
