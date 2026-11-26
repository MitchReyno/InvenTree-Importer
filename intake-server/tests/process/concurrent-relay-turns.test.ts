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

/** A real tool-capable Claude relay with its whole process group killed afterwards. */
function startRelay(t: TestContext, root: string, port: number, holdMs: number, turns?: number) {
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
        ...(turns ? { INTAKE_VM_RELAY_TURNS: String(turns) } : {}),
        FAKE_GUEST: fakeGuest,
        FAKE_GUEST_PAIR: join(root, 'bench-guest'),
        FAKE_GUEST_LOG: root,
        FAKE_GUEST_HOLD_MS: String(holdMs),
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

/** Two queued Claude tool sessions, a coordinator and a relay with `turns` capacity. */
async function twoSessions(t: TestContext, holdMs: number, turns?: number) {
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
  startRelay(t, root, port, holdMs, turns)

  const run = (attemptId: string) =>
    runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: { 'shared-vm-agent/3': bridge.driver },
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

/** Each logged turn's start and end times, by attempt. */
async function turnLog(root: string) {
  const text = await readFile(join(root, 'turns.log'), 'utf8').catch(() => '')
  const turns = new Map<string, { start?: number; end?: number }>()
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const [event, attemptId, at] = line.split(' ')
    const turn = turns.get(attemptId) ?? {}
    turn[event as 'start' | 'end'] = Number(at)
    turns.set(attemptId, turn)
  }
  return turns
}

test(
  'two tool turns for one provider run at once through one relay',
  { timeout: 150_000 },
  async (t) => {
    const { root, fixture, sessions, run } = await twoSessions(t, HOLD_MS)
    const [first, second] = sessions
    const firstTurn = run(first)
    // The second starts while the first's guest holds its connection.
    await new Promise((settle) => setTimeout(settle, 3000))
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
    const { fixture, sessions, run } = await twoSessions(t, HOLD_MS + 15_000, 1)
    const [first, second] = sessions
    const firstTurn = run(first)
    await new Promise((settle) => setTimeout(settle, 3000))
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
