import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { lotSession } from '../support/sessions.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const relay = resolve(import.meta.dirname, '../../../tooling/deployment/bridge/relay.mjs')
const fakeGuest = resolve(import.meta.dirname, '../support/fake-vm-guest.ts')

// Stands in for Lima: a tool turn runs the fake paired guest, removing a container succeeds and
// the status and catalogue pumps fail, which the relay retries apart from its turns.
const FAKE_LIMACTL = `#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
case "$1" in
  sh) exec node --import tsx "$FAKE_GUEST" ;;
  docker) [ "$2" = rm ] && exit 0; exit 1 ;;
esac
exit 2
`

/** Longer than a tool turn's 45 s wait for a connection, so a second turn can't wait it out. */
const HOLD_MS = 50_000

/** How each fake guest behaves, and the relay's capacity. */
interface GuestOptions {
  holdMs: number
  turns?: number
  /** The VM memory the guest reports; 8 GiB unless set. */
  memoryMib?: number
  /** How long the guest's provider takes to be admitted. */
  admitMs?: number
}

/** A real tool-capable Claude relay with its whole process group killed afterwards. */
function startRelay(t: TestContext, root: string, port: number, guest: GuestOptions) {
  const child = spawn(
    process.execPath,
    [relay, 'bench-agent-test', String(port), '/guest', 'runner:test'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        PATH: join(root, 'bin') + ':' + process.env.PATH,
        INTAKE_VM_CLAUDE_SUBSCRIPTION: '1',
        INTAKE_VM_BUILTIN_TOOLS: '1',
        ...(guest.turns ? { INTAKE_VM_RELAY_TURNS: String(guest.turns) } : {}),
        FAKE_GUEST: fakeGuest,
        FAKE_GUEST_PAIR: join(root, 'bench-guest'),
        FAKE_GUEST_LOG: root,
        FAKE_GUEST_HOLD_MS: String(guest.holdMs),
        FAKE_GUEST_MEMORY_MIB: String(guest.memoryMib ?? 8192),
        FAKE_GUEST_ADMIT_MS: String(guest.admitMs ?? 0),
      },
    },
  )
  t.after(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  })
}

/** Two queued Claude tool sessions, a coordinator and a relay whose guests behave as `guest` says. */
async function twoSessions(t: TestContext, guest: GuestOptions) {
  // Short: the pairing directory sits in it.
  const root = await mkdtemp('/tmp/relay-turns-')
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin', 'limactl'), FAKE_LIMACTL)
  await chmod(join(root, 'bin', 'limactl'), 0o755)
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  const selection = { provider: 'claude', authentication: 'subscription', model: 'haiku' } as const
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({ expected_revision: '0', selection, session_concurrency: 2 }),
  )
  const capture = await fixture.seedCapture()
  const profile = { id: 'shared-vm-agent/3' as const, agent: selection, settingsRevision: '1' }
  const sessions = []
  for (const lot of [capture.packetA, capture.packetB]) {
    sessions.push((await lotSession(fixture, capture, lot, { state: 'queued', profile })).attempt)
  }
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
    protectedHosts: [],
  })
  t.after(() => bridge.close())
  startRelay(t, root, port, guest)

  const run = (attemptId: string) =>
    runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: { 'shared-vm-agent/3': bridge.driver },
        turnCapacity: bridge.turnCapacity,
      },
      attemptId,
      new AbortController().signal,
    )

  return { root, fixture, sessions, run }
}

async function sessionRow(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ session_state: string; turn_count: string }>(
    'SELECT session_state,turn_count::text FROM agent_session WHERE attempt_id=$1',
    [attemptId],
  )
  return rows.rows[0]
}

async function failureCodes(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ code: string }>(
    "SELECT diagnostic->>'code' AS code FROM agent_session_failure WHERE attempt_id=$1",
    [attemptId],
  )
  return rows.rows.map((row) => row.code)
}

async function heldSlots(fixture: Fixture) {
  const rows = await fixture.db.pool.query<{ attempt_id: string; turn_child: string | null }>(
    'SELECT attempt_id,turn_child FROM agent_slot WHERE attempt_id IS NOT NULL',
  )
  return rows.rows
}

type TurnEvent = 'start' | 'admitted' | 'end'

async function logLines(root: string) {
  const text = await readFile(join(root, 'turns.log'), 'utf8').catch(() => '')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
}

/** Each logged turn's start, admission and end times, by attempt. */
async function turnLog(root: string) {
  const turns = new Map<string, Partial<Record<TurnEvent, number>>>()
  for (const [event, attemptId, at] of await logLines(root)) {
    if (event === 'launch') {
      continue
    }
    const turn = turns.get(attemptId) ?? {}
    turn[event as TurnEvent] = Number(at)
    turns.set(attemptId, turn)
  }
  return turns
}

/** How many fake guests the relay has started. */
async function launches(root: string) {
  return (await logLines(root)).filter(([event]) => event === 'launch').length
}

/** Resolves once the fake guest has logged the attempt's turn as started. */
async function started(root: string, attemptId: string) {
  const deadline = Date.now() + 60_000
  while (!(await turnLog(root)).get(attemptId)?.start) {
    assert.ok(Date.now() < deadline, `turn ${attemptId} never started`)
    await new Promise((settle) => setTimeout(settle, 100))
  }
}

test(
  'two tool turns for one provider run at once through one relay',
  { timeout: 150_000 },
  async (t) => {
    const { root, fixture, sessions, run } = await twoSessions(t, { holdMs: HOLD_MS })
    const [first, second] = sessions
    const firstTurn = run(first)
    // The second starts once the first's guest has its command, so its connection is taken.
    await started(root, first)
    const secondTurn = run(second)
    const results = await Promise.all([firstTurn, secondTurn])
    const codes = await failureCodes(fixture, second)
    assert.deepEqual(results, ['finished', 'finished'], JSON.stringify(codes))
    for (const attemptId of sessions) {
      assert.deepEqual(await failureCodes(fixture, attemptId), [])
    }
    const turns = await turnLog(root)
    const a = turns.get(first)!
    const b = turns.get(second)!
    // They overlapped: the second started before the first ended.
    assert.ok(b.start! < a.end!, JSON.stringify({ a, b }))
    assert.deepEqual(await heldSlots(fixture), [])
  },
)

test(
  'a turn that finds every connection busy goes back to the queue and runs later',
  { timeout: 240_000 },
  async (t) => {
    const { root, fixture, sessions, run } = await twoSessions(t, {
      holdMs: HOLD_MS + 15_000,
      turns: 1,
    })
    const [first, second] = sessions
    const firstTurn = run(first)
    await started(root, first)
    // The relay carries one turn, so the second's wait ends with no free connection.
    assert.equal(await run(second), 'queued')
    assert.deepEqual(await sessionRow(fixture, second), {
      session_state: 'queued',
      turn_count: '0',
    })
    assert.deepEqual(await failureCodes(fixture, second), [])
    const held = await heldSlots(fixture)
    assert.ok(!held.some((slot) => slot.attempt_id === second), JSON.stringify(held))
    assert.equal(await firstTurn, 'finished')
    // Once the first has ended, the requeued session runs.
    assert.equal(await run(second), 'finished')
    assert.deepEqual(await sessionRow(fixture, second), {
      session_state: 'finished',
      turn_count: '1',
    })
  },
)

test('an idle relay starts no guest', { timeout: 60_000 }, async (t) => {
  const { root } = await twoSessions(t, { holdMs: 0 })
  // Long enough for a relay to connect and start a ready guest.
  await new Promise((settle) => setTimeout(settle, 5_000))
  assert.equal(await launches(root), 0)
})

test(
  'a turn past what the VM can hold stays queued, and runs once the first has ended',
  { timeout: 180_000 },
  async (t) => {
    // 2 GiB holds one tool turn; the session limit allows two. Longer than the 30 s slot wait.
    const { root, fixture, sessions, run } = await twoSessions(t, {
      holdMs: 40_000,
      memoryMib: 2048,
    })
    const [first, second] = sessions
    const firstTurn = run(first)
    await started(root, first)
    assert.equal(await run(second), 'queued')
    assert.deepEqual(await sessionRow(fixture, second), {
      session_state: 'queued',
      turn_count: '0',
    })
    assert.deepEqual(await failureCodes(fixture, second), [])
    assert.equal((await turnLog(root)).get(second), undefined)
    assert.equal(await firstTurn, 'finished')
    assert.equal(await run(second), 'finished')
  },
)

test(
  'turns started together start one at a time, then run at once',
  { timeout: 120_000 },
  async (t) => {
    const { root, sessions, run } = await twoSessions(t, { holdMs: 8_000, admitMs: 3_000 })
    const results = await Promise.all(sessions.map((attemptId) => run(attemptId)))
    assert.deepEqual(results, ['finished', 'finished'])
    const turns = await turnLog(root)
    const [a, b] = sessions
      .map((attemptId) => turns.get(attemptId)!)
      .sort((x, y) => x.start! - y.start!)
    // The second reached its guest only once the first's provider was admitted...
    assert.ok(b.start! >= a.admitted!, JSON.stringify({ a, b }))
    // ...and they still overlapped.
    assert.ok(b.start! < a.end!, JSON.stringify({ a, b }))
  },
)
