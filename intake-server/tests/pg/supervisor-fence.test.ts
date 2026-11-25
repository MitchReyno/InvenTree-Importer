import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { strictJson } from '@invimport/contracts/json'
import { validate, type ProcessingReceiptDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { runSessionTurn, type SessionRunnerDeps } from '#/agents/session/session-runner.ts'
import { recordTurnChild } from '#/agents/session/slots.ts'
import { requireSupervisorFence } from '#/agents/supervisor-fence.ts'
import {
  acquireAgentSupervisor,
  lockAgentSupervisor,
  type SupervisorLock,
} from '#/agents/worker.ts'
import { claimProcessingCommand } from '#/processing/runner.ts'
import { startProcessing } from '#/processing/commands.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { nativeProfileId } from '#/agents/policy.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/**
 * A fixture whose deferred cleanups run newest first, before it is disposed: its pool waits for
 * every checked-out connection.
 */
async function fenceFixture(t: TestContext, options: Parameters<typeof processingFixture>[0] = {}) {
  const fixture = await processingFixture(options)
  const cleanups: (() => unknown)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    await fixture.dispose()
  })
  return { fixture, defer: (cleanup: () => unknown) => cleanups.push(cleanup) }
}

/** Ends a supervisor's lock connection from outside, as a dropped connection would. */
async function loseLock(fixture: Fixture, lock: SupervisorLock) {
  lock.owner.on('error', () => undefined)
  await fixture.db.pool.query('SELECT pg_terminate_backend($1, 5000)', [lock.fence.backendPid])
  lock.owner.release(true)
}

/** Stderr lines are the check's log; these tests read outcomes from the tables instead. */
async function quietly<T>(run: () => Promise<T>) {
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = (() => true) as typeof process.stderr.write
  try {
    return await run()
  } finally {
    process.stderr.write = write
  }
}

async function slotOf(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ turn: string; turn_child: string }>(
    'SELECT turn::text,turn_child FROM agent_slot WHERE attempt_id=$1',
    [attemptId],
  )
  return rows.rows[0]
}

async function sessionState(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ session_state: string }>(
    'SELECT session_state FROM agent_session WHERE attempt_id=$1',
    [attemptId],
  )
  return rows.rows[0]?.session_state
}

async function heldNoneSlot(fixture: Fixture, index: number, attemptId: string) {
  await fixture.db.pool.query(
    `INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at,turn,turn_child)
     VALUES($1,$2,$3,now(),1,'none')`,
    [fixture.identity.actor, index, attemptId],
  )
}

async function sessionDeps(
  fixture: Fixture,
  lock: SupervisorLock,
  driver: () => Promise<void>,
): Promise<SessionRunnerDeps> {
  const root = await mkdtemp(join(tmpdir(), 'supervisor-fence-'))
  return {
    pool: fixture.runner.pool,
    config: fixture.config,
    host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
    toolUrl: 'http://127.0.0.1:1/unused',
    fence: lock.fence,
    drivers: { 'synthetic-session/1': driver },
  }
}

/** Resolves once some connection is waiting for an advisory lock, within `boundMs`. */
async function advisoryWaiter(fixture: Fixture, boundMs = 5000) {
  const until = Date.now() + boundMs
  while (Date.now() < until) {
    const waiting = await fixture.db.pool.query(
      "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted",
    )
    if (waiting.rowCount) {
      return true
    }
    await delay(25)
  }
  return false
}

test('a worker that lost its lock claims no slot, and the lock holder still does', async (t) => {
  const { fixture, defer } = await fenceFixture(t)
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  await loseLock(fixture, old)
  const replacement = await quietly(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config),
  )
  defer(() => replacement.owner.release(true))
  let driven = 0
  const drive = async () => {
    driven += 1
  }
  const oldDeps = await sessionDeps(fixture, old, drive)
  defer(() => rm(oldDeps.host.stateRoot, { recursive: true, force: true }))

  await assert.rejects(runSessionTurn(oldDeps, session.attempt, new AbortController().signal), {
    message: 'agent_supervisor_lock_lost',
  })
  assert.equal(driven, 0)
  assert.equal(await slotOf(fixture, session.attempt), undefined)
  assert.equal(await sessionState(fixture, session.attempt), 'queued')

  const ownDeps = { ...oldDeps, fence: replacement.fence }
  assert.equal(
    await runSessionTurn(ownDeps, session.attempt, new AbortController().signal),
    'finished',
  )
  assert.equal(driven, 1)
  assert.equal(await slotOf(fixture, session.attempt), undefined)
})

test("a worker that lost its lock records no child during a replacement's check", async (t) => {
  const { fixture } = await fenceFixture(t)
  const capture = await fixture.seedCapture()
  const recorded = await lotSession(fixture, capture, capture.packetA)
  const probed = await lotSession(fixture, capture, capture.packetB)
  await heldNoneSlot(fixture, 0, recorded.attempt)
  await fixture.db.pool.query(
    `INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at,turn,turn_child,vm_command)
     VALUES($1,1,$2,now(),1,'vm','{"command":"b"}')`,
    [fixture.identity.actor, probed.attempt],
  )
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  await loseLock(fixture, old)
  let recordOutcome: unknown = 'not attempted'
  const replacement = await quietly(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config, {
      // The old worker's driver records its VM command while the replacement asks the guest.
      confirmVmReaped: async () => {
        recordOutcome = await recordTurnChild(
          fixture.runner.pool,
          recorded.attempt,
          1n,
          { kind: 'vm', command: '{"command":"a"}' },
          old.fence,
        ).then(
          () => 'recorded',
          (error: unknown) => error,
        )
        return true
      },
    }),
  )
  replacement.owner.release(true)
  assert.ok(recordOutcome instanceof Error, String(recordOutcome))
  assert.equal(recordOutcome.message, 'agent_supervisor_lock_lost')
  assert.equal(await slotOf(fixture, recorded.attempt), undefined)
  assert.equal(await sessionState(fixture, recorded.attempt), 'interrupted')
})

function receipt(value: unknown): ProcessingReceiptDto {
  validate('ProcessingReceipt', value)
  return value as ProcessingReceiptDto
}

test('a /1 worker that lost its lock claims no lane', async (t) => {
  const { fixture, defer } = await fenceFixture(t, { profileId: nativeProfileId })
  const capture = await fixture.seedCapture()
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'codex', authentication: 'subscription', model: 'gpt-test-one' },
    }),
  )
  const queued = receipt(
    await startProcessing(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    }),
  )
  const retained = await fixture.db.pool.query(
    'SELECT workflow_id,payload_bytes FROM command WHERE id=(SELECT command_id FROM processing_attempt WHERE id=$1)',
    [queued.attempt_ids[0]],
  )
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  await loseLock(fixture, old)
  const replacement = await quietly(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config),
  )
  defer(() => replacement.owner.release(true))

  await assert.rejects(
    claimProcessingCommand(
      fixture.runner.pool,
      fixture.config,
      retained.rows[0].workflow_id,
      strictJson(retained.rows[0].payload_bytes.toString()),
      'processing/4',
      old.fence,
    ),
    { message: 'agent_supervisor_lock_lost' },
  )
  const lane = await fixture.db.pool.query(
    'SELECT attempt_id FROM processing_lane WHERE actor_id=$1 AND attempt_id IS NOT NULL',
    [fixture.identity.actor],
  )
  assert.equal(lane.rowCount, 0)
  const attempt = await fixture.db.pool.query<{ state: string }>(
    'SELECT state FROM processing_attempt WHERE id=$1',
    [queued.attempt_ids[0]],
  )
  assert.equal(attempt.rows[0].state, 'queued')

  const claimed = await claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.rows[0].workflow_id,
    strictJson(retained.rows[0].payload_bytes.toString()),
    'processing/4',
    replacement.fence,
  )
  assert.ok(claimed)
})

test('a new supervisor waits for a claim already past its fence, then checks it', async (t) => {
  const { fixture, defer } = await fenceFixture(t)
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  const claim = await fixture.runner.pool.connect()
  defer(() => claim.release())
  await claim.query('BEGIN')
  await requireSupervisorFence(claim, old.fence, 'ownership')
  await claim.query(
    `INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at,turn,turn_child)
     VALUES($1,0,$2,now(),1,'none')`,
    [fixture.identity.actor, session.attempt],
  )
  await loseLock(fixture, old)

  let checked = false
  const replacement = quietly(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config),
  ).finally(() => {
    checked = true
  })
  const waited = await advisoryWaiter(fixture)
  const checkedBeforeCommit = checked
  await claim.query('COMMIT')
  const lock = await replacement
  lock.owner.release(true)

  assert.equal(checkedBeforeCommit, false)
  assert.ok(waited)
  assert.equal(await slotOf(fixture, session.attempt), undefined)
  assert.equal(await sessionState(fixture, session.attempt), 'interrupted')
})

test('a new supervisor refuses when a fenced write stays open past the bound', async (t) => {
  const { fixture, defer } = await fenceFixture(t)
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  const open = await fixture.runner.pool.connect()
  defer(() => open.release())
  await open.query('BEGIN')
  await requireSupervisorFence(open, old.fence, 'ownership')
  await loseLock(fixture, old)

  const refused = await lockAgentSupervisor(fixture.runner.pool, fixture.config, {
    fenceWaitMs: 200,
  }).then(
    (lock) => {
      lock.owner.release(true)
      return lock
    },
    (error: unknown) => error,
  )
  assert.ok(refused instanceof Error, 'the new supervisor started')
  assert.equal(refused.message, 'agent_supervisor_writes_in_flight')
  await open.query('ROLLBACK')
  const next = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  next.owner.release(true)
})

test('a worker that lost its lock settles nothing while another worker holds it', async (t) => {
  const { fixture, defer } = await fenceFixture(t)
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  let reached!: () => void
  const running = new Promise<void>((resolve) => (reached = resolve))
  let proceed!: () => void
  const ended = new Promise<void>((resolve) => (proceed = resolve))
  const deps = await sessionDeps(fixture, old, async () => {
    reached()
    await ended
  })
  defer(() => rm(deps.host.stateRoot, { recursive: true, force: true }))
  const turn = runSessionTurn(deps, session.attempt, new AbortController().signal)
  await running
  await loseLock(fixture, old)
  // The replacement holds the lock, its check not yet run (it is still asking the guest).
  const replacement = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  defer(() => replacement.owner.release(true))
  proceed()

  await assert.rejects(turn, { message: 'agent_supervisor_lock_lost' })
  assert.deepEqual(await slotOf(fixture, session.attempt), { turn: '1', turn_child: 'none' })
  assert.equal(await sessionState(fixture, session.attempt), 'running')
})

test('a worker that lost its lock still settles while no worker holds it', async (t) => {
  const { fixture, defer } = await fenceFixture(t)
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const old = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  let reached!: () => void
  const running = new Promise<void>((resolve) => (reached = resolve))
  let proceed!: () => void
  const ended = new Promise<void>((resolve) => (proceed = resolve))
  const deps = await sessionDeps(fixture, old, async () => {
    reached()
    await ended
  })
  defer(() => rm(deps.host.stateRoot, { recursive: true, force: true }))
  const turn = runSessionTurn(deps, session.attempt, new AbortController().signal)
  await running
  await loseLock(fixture, old)
  proceed()

  assert.equal(await turn, 'finished')
  assert.equal(await slotOf(fixture, session.attempt), undefined)
})
