import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { randomUUID } from 'node:crypto'
import {
  interruptSession,
  runSessionTurn,
  type SessionDriver,
} from '#/agents/session/session-runner.ts'
import { claimSessionSlot } from '#/agents/session/slots.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'
import { transaction } from '#/db/database.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { singleProvider } from '../support/agent-settings.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** What a VM guest reports for a CLI that didn't accept the session's setup in time. */
function guestAdmissionTimeout() {
  return new NativeSessionError('agent_turn_failed', {
    cause: new NativeSessionError('agent_admission_timeout'),
  })
}

async function runWith(fixture: Fixture, attempt: string, driver: SessionDriver) {
  const root = await mkdtemp(join(tmpdir(), 'startup-timeouts-'))
  try {
    return await runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: { 'synthetic-session/1': driver },
      },
      attempt,
      new AbortController().signal,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function sessionRow(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{
    session_state: string
    turn_count: string
    capability: boolean
  }>(
    `SELECT session_state, turn_count::text, capability_sha256 IS NOT NULL AS capability
       FROM agent_session WHERE attempt_id=$1`,
    [attemptId],
  )
  return rows.rows[0]
}

async function failures(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ code: string; category: string; summary: string }>(
    `SELECT diagnostic->>'code' AS code, diagnostic->>'category' AS category,
            diagnostic->>'summary' AS summary
       FROM agent_session_failure WHERE attempt_id=$1 ORDER BY turn_count`,
    [attemptId],
  )
  return rows.rows
}

async function heldSlots(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id=$1', [
    attemptId,
  ])
  return rows.rowCount
}

test('an admission timeout goes back to the queue twice, then fails as a startup timeout', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { attempt } = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const turns: string[] = []

  const timesOut: SessionDriver = async (_turn, context) => {
    turns.push(context.identity.turn)
    await context.recordChild!({ kind: 'vm', command: '{}' })
    throw guestAdmissionTimeout()
  }

  for (const expectedTurns of ['1', '2']) {
    assert.equal(await runWith(fixture, attempt, timesOut), 'queued')
    // The guest journalled the turn, so it stays counted and the next one is a new turn.
    assert.deepEqual(await sessionRow(fixture, attempt), {
      session_state: 'queued',
      turn_count: expectedTurns,
      capability: false,
    })
    assert.equal(await heldSlots(fixture, attempt), 0)
    assert.deepEqual(await failures(fixture, attempt), [])
  }

  assert.equal(await runWith(fixture, attempt, timesOut), 'failed')
  assert.deepEqual(turns, ['1', '2', '3'])
  const [failure] = await failures(fixture, attempt)
  assert.equal(failure.code, 'agent_admission_timeout')
  assert.equal(failure.category, 'timeout')
  assert.match(failure.summary, /didn't start in time/)
  assert.equal(await heldSlots(fixture, attempt), 0)
})

test('a turn that runs resets the startup timeouts', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { attempt } = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })

  const timesOut: SessionDriver = async () => {
    throw guestAdmissionTimeout()
  }

  const finishes: SessionDriver = async () => {}

  assert.equal(await runWith(fixture, attempt, timesOut), 'queued')
  assert.equal(await runWith(fixture, attempt, timesOut), 'queued')
  assert.equal(await runWith(fixture, attempt, finishes), 'finished')
  // Woken again with a new item, it gets two more retries.
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='queued' WHERE attempt_id=$1",
    [attempt],
  )
  assert.equal(await runWith(fixture, attempt, timesOut), 'queued')
  assert.equal(await runWith(fixture, attempt, timesOut), 'queued')
  assert.deepEqual(await failures(fixture, attempt), [])
})

test('a session claims no slot past the VM turn capacity', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      session_concurrency: 3,
    }),
  )
  const capture = await fixture.seedCapture()
  const first = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const second = await lotSession(fixture, capture, capture.packetB, { state: 'queued' })

  const claim = (attemptId: string, capacity: number) =>
    transaction(fixture.runner.pool, (client) =>
      claimSessionSlot(client, fixture.config, attemptId, () => capacity),
    )

  assert.equal(await claim(first.attempt, 1), true)
  // Sessions at once allows three, but the VM holds one.
  assert.equal(await claim(second.attempt, 1), false)
  assert.equal(await claim(second.attempt, 2), true)
})

test('a turn that started and was interrupted resets the startup timeouts', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })

  const timesOut: SessionDriver = async () => {
    throw guestAdmissionTimeout()
  }

  assert.equal(await runWith(fixture, session.attempt, timesOut), 'queued')
  assert.equal(await runWith(fixture, session.attempt, timesOut), 'queued')
  // The next turn starts, and a restart confirms it gone and interrupts it.
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='running' WHERE attempt_id=$1",
    [session.attempt],
  )
  await transaction(fixture.runner.pool, (client) =>
    interruptSession(client, {
      attemptId: session.attempt,
      jobId: session.job,
      batchId: capture.batch.id,
      turnCount: 3n,
    }),
  )
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='queued' WHERE attempt_id=$1",
    [session.attempt],
  )
  assert.equal(await runWith(fixture, session.attempt, timesOut), 'queued')
})

test('a first turn requeued after a startup timeout still runs when its inbox was withdrawn', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  let opened = 0

  assert.equal(
    await runWith(fixture, session.attempt, async () => {
      throw guestAdmissionTimeout()
    }),
    'queued',
  )
  // Its only pending item is withdrawn before the retry.
  const item = randomUUID()
  await fixture.db.pool.query(
    "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
    [item, session.job, { evidence_id: randomUUID(), version_id: randomUUID() }, item],
  )
  await fixture.db.pool.query('INSERT INTO agent_session_inbox_withdrawal(item_id) VALUES($1)', [
    item,
  ])

  const state = await runWith(fixture, session.attempt, async () => {
    opened++
  })
  // The provider never had the opening, so the retry delivers it.
  assert.equal(opened, 1)
  assert.equal(state, 'finished')
})

test('a claim waiting for the slot lock reads the VM capacity once it has the lock', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      session_concurrency: 3,
    }),
  )
  const capture = await fixture.seedCapture()
  const first = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const second = await lotSession(fixture, capture, capture.packetB, { state: 'queued' })
  let capacity = 3
  assert.equal(
    await transaction(fixture.runner.pool, (client) =>
      claimSessionSlot(client, fixture.config, first.attempt, () => capacity),
    ),
    true,
  )

  // Another claim holds the actor's slot lock while the capacity drops.
  const holder = await fixture.db.pool.connect()
  await holder.query('BEGIN')
  await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7319))', [
    `agent-slots:${fixture.config.actorId}`,
  ])
  const waiting = transaction(fixture.runner.pool, (client) =>
    claimSessionSlot(client, fixture.config, second.attempt, () => capacity),
  )
  await new Promise((settle) => setTimeout(settle, 300))
  capacity = 1
  await holder.query('COMMIT')
  // Released before the fixture is disposed, which waits for its checked-out connections.
  holder.release()
  assert.equal(await waiting, false)
})

test('an established session whose retry lost its only wake item goes back to idle', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  let opened = 0

  assert.equal(
    await runWith(fixture, session.attempt, async () => {
      throw guestAdmissionTimeout()
    }),
    'queued',
  )
  // It already has a provider conversation, woken from finished for one item since withdrawn.
  await fixture.db.pool.query(
    "UPDATE agent_session SET native_session_id='00000000-0000-4000-8000-0000000000aa' WHERE attempt_id=$1",
    [session.attempt],
  )
  await fixture.db.pool.query(
    "INSERT INTO agent_session_resume(attempt_id,from_state) VALUES($1,'finished')",
    [session.attempt],
  )
  const item = randomUUID()
  await fixture.db.pool.query(
    "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
    [item, session.job, { evidence_id: randomUUID(), version_id: randomUUID() }, item],
  )
  await fixture.db.pool.query('INSERT INTO agent_session_inbox_withdrawal(item_id) VALUES($1)', [
    item,
  ])

  const state = await runWith(fixture, session.attempt, async () => {
    opened++
  })
  assert.equal(opened, 0)
  assert.equal(state, 'finished')
  const row = await fixture.db.pool.query<{ startup_timeouts: number }>(
    'SELECT startup_timeouts FROM agent_session WHERE attempt_id=$1',
    [session.attempt],
  )
  assert.equal(row.rows[0].startup_timeouts, 0)
})

test('a session cancelled after its CLI timed out settles as cancelled, without a timeout', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })

  const state = await runWith(fixture, session.attempt, async () => {
    // The cancellation commits after the guest reported the timeout, before settlement.
    await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
      session.attempt,
    ])
    throw guestAdmissionTimeout()
  })

  assert.equal(state, 'cancelled')
  assert.deepEqual(await failures(fixture, session.attempt), [])
  assert.equal(await heldSlots(fixture, session.attempt), 0)
})
