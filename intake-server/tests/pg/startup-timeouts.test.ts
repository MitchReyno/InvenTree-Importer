import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn, type SessionDriver } from '#/agents/session/session-runner.ts'
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

  const claim = (attemptId: string, capacity: number | undefined) =>
    transaction(fixture.runner.pool, (client) =>
      claimSessionSlot(client, fixture.config, attemptId, capacity),
    )

  assert.equal(await claim(first.attempt, 1), true)
  // Sessions at once allows three, but the VM holds one.
  assert.equal(await claim(second.attempt, 1), false)
  assert.equal(await claim(second.attempt, 2), true)
})
