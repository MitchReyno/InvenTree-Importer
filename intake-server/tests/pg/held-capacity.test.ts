import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { interruptRunningSessions, runSessionTurn } from '#/agents/session/session-runner.ts'
import { recoverHeldCapacity } from '#/agents/held-capacity.ts'
import {
  acquireAgentSupervisor,
  lockAgentSupervisor,
  type SupervisorLock,
} from '#/agents/worker.ts'
import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Child = 'none' | 'host' | 'vm' | null

const pgError = (code: string) => (error: unknown) =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === code

/** A held slot as a stopped worker leaves it, with the turn record a claim and driver wrote. */
async function heldSlot(
  fixture: Fixture,
  index: number,
  attemptId: string,
  child: Child,
  command: string | null = null,
) {
  await fixture.db.pool.query(
    `INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at,turn,turn_child,vm_command)
     VALUES($1,$2,$3,now(),$4,$5,$6)`,
    [fixture.identity.actor, index, attemptId, child === null ? null : '1', child, command],
  )
}

async function slotOf(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{
    turn: string | null
    turn_child: string | null
    vm_command: string | null
  }>('SELECT turn::text,turn_child,vm_command FROM agent_slot WHERE attempt_id=$1', [attemptId])
  return rows.rows[0]
}

async function sessionState(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ session_state: string }>(
    'SELECT session_state FROM agent_session WHERE attempt_id=$1',
    [attemptId],
  )
  return rows.rows[0]?.session_state
}

/** Runs `check` on a held supervisor lock's own connection, as a worker does. */
async function asSupervisor<T>(
  fixture: Fixture,
  check: (owner: PoolClient) => Promise<T>,
  config = fixture.config,
) {
  const { owner } = await lockAgentSupervisor(fixture.runner.pool, config)
  try {
    return await check(owner)
  } finally {
    owner.release(true)
  }
}

/** Captures the worker's log lines while `run` runs. */
async function logged<T>(run: () => Promise<T>) {
  const lines: string[] = []
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(chunk.toString())
    return true
  }) as typeof process.stderr.write
  try {
    return { result: await run().catch((error: unknown) => error), lines }
  } finally {
    process.stderr.write = write
  }
}

test('a claim records its turn, a VM driver its command, and settlement clears both', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const root = await mkdtemp(join(tmpdir(), 'held-capacity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  let recorded!: () => void
  const dispatched = new Promise<void>((resolve) => (recorded = resolve))
  let finish!: () => void
  const finished = new Promise<void>((resolve) => (finish = resolve))
  let claimedRecord: Awaited<ReturnType<typeof slotOf>> | undefined
  const turn = runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
      toolUrl: 'http://127.0.0.1:1/unused',
      drivers: {
        'synthetic-session/1': async (_turn, context) => {
          claimedRecord = await slotOf(fixture, session.attempt)
          await context.recordChild!({ kind: 'vm', command: '{"turn":"exact bytes"}' })
          recorded()
          await finished
        },
      },
    },
    session.attempt,
    new AbortController().signal,
  )
  await dispatched
  assert.deepEqual(claimedRecord, { turn: '1', turn_child: 'none', vm_command: null })
  assert.deepEqual(await slotOf(fixture, session.attempt), {
    turn: '1',
    turn_child: 'vm',
    vm_command: '{"turn":"exact bytes"}',
  })
  finish()
  assert.equal(await turn, 'finished')
  assert.equal(await slotOf(fixture, session.attempt), undefined)
  const free = await fixture.db.pool.query(
    'SELECT 1 FROM agent_slot WHERE turn IS NOT NULL OR turn_child IS NOT NULL OR vm_command IS NOT NULL',
  )
  assert.equal(free.rowCount, 0)
})

test('a slot record exists only on a held slot, and a command only for a VM turn', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await fixture.db.pool.query('INSERT INTO agent_slot(actor_id,slot_index) VALUES($1,0)', [
    fixture.identity.actor,
  ])
  await assert.rejects(
    fixture.runner.pool.query(
      "UPDATE agent_slot SET turn=1,turn_child='none' WHERE actor_id=$1 AND slot_index=0",
      [fixture.identity.actor],
    ),
    pgError('23514'),
  )
  await assert.rejects(heldSlot(fixture, 1, session.attempt, 'none', '{}'), pgError('23514'))
  await assert.rejects(heldSlot(fixture, 1, session.attempt, 'vm', null), pgError('23514'))
  // A slot claimed before turns were recorded has no record, and can't carry a stray command.
  await assert.rejects(heldSlot(fixture, 1, session.attempt, null, '{}'), pgError('23514'))
  await heldSlot(fixture, 1, session.attempt, 'vm', '{}')
  // A release that left the record behind is refused.
  await assert.rejects(
    fixture.runner.pool.query(
      'UPDATE agent_slot SET attempt_id=NULL,claimed_at=NULL WHERE attempt_id=$1',
      [session.attempt],
    ),
    pgError('23514'),
  )
})

test('a starting worker releases slots whose turn is confirmed gone, then interrupts their sessions', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const inProcess = await lotSession(fixture, capture, capture.packetA)
  const vm = await lotSession(fixture, capture, capture.packetB)
  await heldSlot(fixture, 0, inProcess.attempt, 'none')
  await heldSlot(fixture, 1, vm.attempt, 'vm', '{"command":"b"}')
  const asked: string[] = []
  const { result, lines } = await logged(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config, {
      confirmVmReaped: async (command) => {
        asked.push(command)
        return command === '{"command":"b"}'
      },
    }),
  )
  assert.ok(!(result instanceof Error), String(result))
  // Released now: the fixture's pool waits for its checked-out connections when disposed.
  ;(result as SupervisorLock).owner.release(true)
  assert.deepEqual(asked, ['{"command":"b"}'])
  assert.equal(await slotOf(fixture, inProcess.attempt), undefined)
  assert.equal(await slotOf(fixture, vm.attempt), undefined)
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [
      {
        event: 'held_capacity_released',
        holds: 'slot',
        attempt_id: inProcess.attempt,
        reason: 'no_child',
      },
      {
        event: 'held_capacity_released',
        holds: 'slot',
        attempt_id: vm.attempt,
        reason: 'vm_worker_removed',
      },
    ],
  )
  // Each released session was interrupted with its release; the start's sweep has none left.
  const interrupted = await interruptRunningSessions(fixture.runner.pool, fixture.config)
  assert.deepEqual(interrupted, [])
  for (const session of [inProcess, vm]) {
    assert.equal(await sessionState(fixture, session.attempt), 'interrupted')
    const failure = await fixture.db.pool.query<{ code: string }>(
      "SELECT diagnostic->>'code' AS code FROM agent_session_failure WHERE attempt_id=$1",
      [session.attempt],
    )
    assert.deepEqual(
      failure.rows.map((row) => row.code),
      ['agent_worker_interrupted'],
    )
    const capability = await fixture.db.pool.query(
      'SELECT 1 FROM agent_session WHERE attempt_id=$1 AND capability_sha256 IS NOT NULL',
      [session.attempt],
    )
    assert.equal(capability.rowCount, 0)
  }
})

test('held capacity that cannot be confirmed keeps refusing, naming each attempt', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  for (const label of ['Packet C', 'Packet D', 'Packet E', 'Packet F']) {
    await capture.edit({ kind: 'add_lot', label, note: label, part_subject_id: null })
  }
  const lot = (label: string) => capture.batch.lots.find((item) => item.label === label)!
  const unconfirmed = await lotSession(fixture, capture, capture.packetA)
  const host = await lotSession(fixture, capture, capture.packetB)
  const unrecorded = await lotSession(fixture, capture, lot('Packet C'))
  const noBridge = await lotSession(fixture, capture, lot('Packet D'))
  const gone = await lotSession(fixture, capture, lot('Packet E'))
  const lane = await lotSession(fixture, capture, lot('Packet F'))
  await heldSlot(fixture, 0, unconfirmed.attempt, 'vm', '{"command":"a"}')
  await heldSlot(fixture, 1, host.attempt, 'host')
  await heldSlot(fixture, 2, unrecorded.attempt, null)
  await heldSlot(fixture, 3, gone.attempt, 'none')
  await fixture.db.pool.query('INSERT INTO processing_lane(actor_id,attempt_id) VALUES($1,$2)', [
    fixture.identity.actor,
    lane.attempt,
  ])
  const { result, lines } = await logged(() =>
    acquireAgentSupervisor(fixture.runner.pool, fixture.config, {
      confirmVmReaped: async () => false,
    }),
  )
  assert.ok(result instanceof Error)
  assert.equal(result.message, 'agent_reap_confirmation_required')
  const kept = lines
    .map((line) => JSON.parse(line))
    .filter((line) => line.event === 'agent_reap_unconfirmed')
  assert.deepEqual(kept, [
    {
      event: 'agent_reap_unconfirmed',
      holds: 'slot',
      attempt_id: unconfirmed.attempt,
      reason: 'vm_reap_unconfirmed',
    },
    {
      event: 'agent_reap_unconfirmed',
      holds: 'slot',
      attempt_id: host.attempt,
      reason: 'host_child_unverifiable',
    },
    {
      event: 'agent_reap_unconfirmed',
      holds: 'slot',
      attempt_id: unrecorded.attempt,
      reason: 'turn_child_unrecorded',
    },
    {
      event: 'agent_reap_unconfirmed',
      holds: 'lane',
      attempt_id: lane.attempt,
      reason: 'lane_child_unverifiable',
    },
  ])
  // What could be confirmed was released anyway; the rest stays held with its session as it was.
  assert.equal(await slotOf(fixture, gone.attempt), undefined)
  for (const session of [unconfirmed, host, unrecorded]) {
    assert.ok(await slotOf(fixture, session.attempt))
    assert.equal(await sessionState(fixture, session.attempt), 'running')
  }
  const laneRow = await fixture.db.pool.query('SELECT 1 FROM processing_lane WHERE attempt_id=$1', [
    lane.attempt,
  ])
  assert.equal(laneRow.rowCount, 1)

  // A worker without the VM bridge cannot ask the guest at all.
  await fixture.db.pool.query(
    'UPDATE agent_slot SET attempt_id=NULL,claimed_at=NULL,turn=NULL,turn_child=NULL WHERE attempt_id=$1',
    [host.attempt],
  )
  await heldSlot(fixture, 4, noBridge.attempt, 'vm', '{"command":"d"}')
  const withoutBridge = await asSupervisor(fixture, (owner) =>
    recoverHeldCapacity(owner, fixture.config),
  )
  assert.equal(
    withoutBridge.find((outcome) => outcome.attemptId === noBridge.attempt)?.reason,
    'vm_bridge_unavailable',
  )
  // A guest that never answers within the bound confirms nothing.
  const timedOut = await asSupervisor(fixture, (owner) =>
    recoverHeldCapacity(owner, fixture.config, {
      reapCheckMs: 50,
      confirmVmReaped: (_command, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          void delay(5000).then(() => resolve(true))
        }),
    }),
  )
  assert.ok(
    timedOut
      .filter((outcome) => outcome.attemptId === noBridge.attempt)
      .every((outcome) => !outcome.released && outcome.reason === 'vm_reap_unconfirmed'),
  )
  assert.ok(await slotOf(fixture, noBridge.attempt))
})

test('a slot that changes after its check is not released', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await heldSlot(fixture, 0, session.attempt, 'vm', '{"command":"a"}')
  const outcomes = await asSupervisor(fixture, (owner) =>
    recoverHeldCapacity(owner, fixture.config, {
      confirmVmReaped: async () => {
        await fixture.db.pool.query('UPDATE agent_slot SET turn=2 WHERE attempt_id=$1', [
          session.attempt,
        ])
        return true
      },
    }),
  )
  assert.deepEqual(outcomes, [
    { holds: 'slot', attemptId: session.attempt, released: false, reason: 'held_capacity_changed' },
  ])
  assert.equal((await slotOf(fixture, session.attempt))?.turn, '2')
})

test('a second worker is refused before it checks or releases anything', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await heldSlot(fixture, 0, session.attempt, 'vm', '{"command":"a"}')
  const { owner } = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  let asked = 0
  try {
    await assert.rejects(
      acquireAgentSupervisor(fixture.runner.pool, fixture.config, {
        confirmVmReaped: async () => {
          asked++
          return true
        },
      }),
      /agent_supervisor_already_running/,
    )
  } finally {
    owner.release(true)
  }
  assert.equal(asked, 0)
  assert.ok(await slotOf(fixture, session.attempt))
})

test('a driver record committed while the release waits keeps the slot', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await heldSlot(fixture, 0, session.attempt, 'vm', '{"command":"a"}')
  const recorder = await fixture.db.pool.connect()
  let committed: Promise<unknown> = Promise.resolve()
  try {
    const outcomes = await asSupervisor(fixture, (owner) =>
      recoverHeldCapacity(owner, fixture.config, {
        confirmVmReaped: async () => {
          // A turn's record, written but not committed when the release runs, and committed after.
          await recorder.query('BEGIN')
          await recorder.query(
            'UPDATE agent_slot SET vm_command=\'{"command":"b"}\' WHERE attempt_id=$1',
            [session.attempt],
          )
          committed = delay(500).then(() => recorder.query('COMMIT'))
          return true
        },
      }),
    )
    assert.deepEqual(outcomes, [
      {
        holds: 'slot',
        attemptId: session.attempt,
        released: false,
        reason: 'held_capacity_changed',
      },
    ])
  } finally {
    await committed
    recorder.release()
  }
  assert.equal((await slotOf(fixture, session.attempt))?.vm_command, '{"command":"b"}')
})

test('a worker that loses its supervisor lock mid-check releases nothing', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await heldSlot(fixture, 0, session.attempt, 'vm', '{"command":"a"}')
  const { owner } = await lockAgentSupervisor(fixture.runner.pool, fixture.config)
  owner.on('error', () => undefined)
  try {
    const backend = await owner.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    await assert.rejects(
      recoverHeldCapacity(owner, fixture.config, {
        confirmVmReaped: async () => {
          // The lock's connection ends while the worker's other connections stay up.
          await fixture.db.pool.query('SELECT pg_terminate_backend($1)', [backend.rows[0].pid])
          return true
        },
      }),
    )
  } finally {
    owner.release(true)
  }
  assert.ok(await slotOf(fixture, session.attempt))
})

test('a slot held by another target context is left for its own worker', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  const vm = await lotSession(fixture, capture, capture.packetB)
  await heldSlot(fixture, 0, session.attempt, 'none')
  await heldSlot(fixture, 1, vm.attempt, 'vm', '{"command":"another scope"}')
  const otherContext = { ...fixture.config, targetContextId: randomUUID() }
  let asked = 0
  const outcomes = await asSupervisor(
    fixture,
    (owner) =>
      recoverHeldCapacity(owner, otherContext, {
        confirmVmReaped: async () => {
          asked++
          return true
        },
      }),
    otherContext,
  )
  assert.deepEqual(outcomes, [
    { holds: 'slot', attemptId: session.attempt, released: false, reason: 'held_by_other_scope' },
    { holds: 'slot', attemptId: vm.attempt, released: false, reason: 'held_by_other_scope' },
  ])
  // Its command never reaches this worker's guest.
  assert.equal(asked, 0)
  assert.ok(await slotOf(fixture, session.attempt))
})

test('a start interrupts each released session even when another slot keeps it from starting', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const gone = await lotSession(fixture, capture, capture.packetA)
  const host = await lotSession(fixture, capture, capture.packetB)
  await heldSlot(fixture, 0, gone.attempt, 'none')
  await heldSlot(fixture, 1, host.attempt, 'host')
  await fixture.db.pool.query(
    "UPDATE agent_session SET capability_sha256=decode(repeat('ab',32),'hex') WHERE attempt_id=ANY($1::uuid[])",
    [[gone.attempt, host.attempt]],
  )
  const { result } = await logged(() => acquireAgentSupervisor(fixture.runner.pool, fixture.config))
  assert.ok(result instanceof Error && result.message === 'agent_reap_confirmation_required')
  assert.equal(await slotOf(fixture, gone.attempt), undefined)
  assert.equal(await sessionState(fixture, gone.attempt), 'interrupted')
  assert.ok(await slotOf(fixture, host.attempt))
  assert.equal(await sessionState(fixture, host.attempt), 'running')
  const capabilities = await fixture.db.pool.query<{ attempt_id: string }>(
    'SELECT attempt_id FROM agent_session WHERE capability_sha256 IS NOT NULL',
  )
  assert.deepEqual(
    capabilities.rows.map((row) => row.attempt_id),
    [host.attempt],
  )
})

test('a settlement from a worker that lost the actor leaves the next turn alone', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const root = await mkdtemp(join(tmpdir(), 'held-capacity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, { state: 'queued' })
  const state = await runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
      toolUrl: 'http://127.0.0.1:1/unused',
      drivers: {
        'synthetic-session/1': async () => {
          // Meanwhile a replacement worker recovered this turn and claimed the next one.
          await fixture.db.pool.query(
            'UPDATE agent_session SET turn_count=turn_count+1 WHERE attempt_id=$1',
            [session.attempt],
          )
          await fixture.db.pool.query(
            "UPDATE agent_slot SET turn=turn+1,turn_child='none' WHERE attempt_id=$1",
            [session.attempt],
          )
        },
      },
    },
    session.attempt,
    new AbortController().signal,
  )
  assert.equal(state, 'running')
  assert.deepEqual(await slotOf(fixture, session.attempt), {
    turn: '2',
    turn_child: 'none',
    vm_command: null,
  })
  const capability = await fixture.db.pool.query(
    'SELECT 1 FROM agent_session WHERE attempt_id=$1 AND capability_sha256 IS NOT NULL',
    [session.attempt],
  )
  assert.equal(capability.rowCount, 1)
})

test('the start sweep leaves a session that still holds a slot', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA)
  await heldSlot(fixture, 0, session.attempt, 'host')
  assert.deepEqual(await interruptRunningSessions(fixture.runner.pool, fixture.config), [])
  assert.equal(await sessionState(fixture, session.attempt), 'running')
})

test('a starting worker asks about one held VM turn at a time', async (t) => {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const a = await lotSession(fixture, capture, capture.packetA)
  const b = await lotSession(fixture, capture, capture.packetB)
  await heldSlot(fixture, 0, a.attempt, 'vm', '{"command":"a"}')
  await heldSlot(fixture, 1, b.attempt, 'vm', '{"command":"b"}')
  let asking = 0
  let most = 0
  const outcomes = await asSupervisor(fixture, (owner) =>
    recoverHeldCapacity(owner, fixture.config, {
      // Each proof starts a guest on demand, so two at once would start two guests.
      confirmVmReaped: async () => {
        asking++
        most = Math.max(most, asking)
        await delay(100)
        asking--
        return true
      },
    }),
  )
  assert.equal(most, 1)
  assert.deepEqual(
    outcomes.map((outcome) => outcome.released),
    [true, true],
  )
})
