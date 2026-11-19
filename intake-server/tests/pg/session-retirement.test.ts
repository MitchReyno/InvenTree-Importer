import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionFailureDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { queueSessionResume, runSessionTurn } from '#/agents/session/session-runner.ts'
import { pendingSessionInbox, submitSessionInbox } from '#/agents/tools/inbox.ts'
import { latestSessionFailures } from '#/agents/failures.ts'
import { transaction } from '#/db/database.ts'

const retiredProfile = {
  id: 'shared-vm-agent/2' as const,
  agent: { provider: 'claude' as const, authentication: 'subscription' as const, model: 'haiku' },
  settingsRevision: '1',
}

/** A `shared-vm-agent/3` worker whose provider must never start for a retired attempt. */
async function retiringWorker(
  t: TestContext,
  profileId: 'shared-vm-agent/1' | 'shared-vm-agent/3' = 'shared-vm-agent/3',
) {
  const fixture = await processingFixture({ profileId })
  t.after(() => fixture.dispose())
  const root = await mkdtemp(join(tmpdir(), 'session-retirement-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const started: string[] = []
  const deps = {
    pool: fixture.runner.pool,
    config: fixture.config,
    host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
    toolUrl: 'http://127.0.0.1:1/unused',
    drivers: {
      [profileId]: async () => {
        started.push(profileId)
      },
    },
  }
  return { fixture, deps, started }
}

async function settledSession(
  fixture: Awaited<ReturnType<typeof processingFixture>>,
  attempt: string,
) {
  const session = await fixture.db.pool.query<{ session_state: string }>(
    'SELECT session_state FROM agent_session WHERE attempt_id=$1',
    [attempt],
  )
  const failures = await fixture.db.pool.query<{ diagnostic: SessionFailureDto }>(
    'SELECT diagnostic FROM agent_session_failure WHERE attempt_id=$1 ORDER BY turn_count',
    [attempt],
  )
  const slots = await fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id=$1', [
    attempt,
  ])
  // What the Agents list and session timeline show for the attempt.
  const shown = (await latestSessionFailures(fixture.db.pool, [attempt])).get(attempt)
  return {
    state: session.rows[0].session_state,
    failures: failures.rows.map((row) => row.diagnostic),
    shown,
    slotHeld: slots.rowCount !== 0,
  }
}

test('a shared-vm-agent/2 attempt queued before the upgrade fails as retired without starting', async (t) => {
  const { fixture, deps, started } = await retiringWorker(t)
  const capture = await fixture.seedCapture()
  const queued = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: retiredProfile,
  })
  assert.equal(await runSessionTurn(deps, queued.attempt, new AbortController().signal), 'failed')
  const settled = await settledSession(fixture, queued.attempt)
  assert.deepEqual(started, [])
  assert.equal(settled.state, 'failed')
  assert.equal(settled.slotHeld, false)
  assert.equal(settled.failures.length, 1)
  assert.equal(settled.failures[0].code, 'agent_profile_retired')
  assert.match(settled.shown?.recovery ?? '', /Run the step again/)
})

test('a message to a finished shared-vm-agent/2 session fails the requeued attempt as retired', async (t) => {
  const { fixture, deps, started } = await retiringWorker(t)
  const capture = await fixture.seedCapture()
  const finished = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: retiredProfile,
  })
  // A session that finished under shared-vm-agent/2 before the upgrade.
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='finished', turn_count=1 WHERE attempt_id=$1",
    [finished.attempt],
  )
  await submitSessionInbox(fixture.api.pool, {
    binding: fixture.config,
    lineageId: finished.job,
    actorId: fixture.identity.actor,
    idempotencyKey: 'after-upgrade',
    kind: 'chat',
    payload: { text: 'Check the back label.' },
  })
  const requeued = await transaction(fixture.runner.pool, (client) =>
    queueSessionResume(client, finished.job),
  )
  assert.equal(requeued, finished.attempt)
  assert.equal(await runSessionTurn(deps, finished.attempt, new AbortController().signal), 'failed')
  const settled = await settledSession(fixture, finished.attempt)
  assert.deepEqual(started, [])
  assert.equal(settled.state, 'failed')
  assert.deepEqual(
    settled.failures.map((failure) => [failure.code, failure.turn]),
    [['agent_profile_retired', '2']],
  )
  assert.match(settled.shown?.recovery ?? '', /Run the step again/)
  // The message stays for a new attempt, and the session's own record is kept.
  const pending = await transaction(fixture.runner.pool, (client) =>
    pendingSessionInbox(client, finished.job),
  )
  assert.equal(pending, 1)
  const kept = await fixture.db.pool.query('SELECT 1 FROM agent_session WHERE attempt_id=$1', [
    finished.attempt,
  ])
  assert.equal(kept.rowCount, 1)
})

test('a worker without VM tools also settles a retired attempt instead of leaving it waiting', async (t) => {
  const { fixture, deps, started } = await retiringWorker(t, 'shared-vm-agent/1')
  const capture = await fixture.seedCapture()
  const queued = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: retiredProfile,
  })
  assert.equal(await runSessionTurn(deps, queued.attempt, new AbortController().signal), 'failed')
  const settled = await settledSession(fixture, queued.attempt)
  assert.deepEqual(started, [])
  assert.equal(settled.state, 'failed')
  assert.match(settled.shown?.recovery ?? '', /Run the step again/)
})
