import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, type TLSSocket } from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** What a tool-worker relay's paired supervisor says when it connects. */
const TOOL_GUEST_GREETING = {
  ready: protocol,
  reapProof: true,
  terminalProbe: true,
  builtinTools: true,
  evidenceFiles: true,
  evidenceRelease: 1,
  turnPolicy: true,
  claudeSubscription: true,
  codexSubscription: false,
  providerStatus: false,
}

/** A worker process for `shared-vm-agent/3` with its bridge on `port`. */
function startWorker(
  t: TestContext,
  fixture: Fixture,
  root: string,
  port: number,
  extra: Record<string, string> = {},
) {
  const worker = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/agents/session/session-worker-main.ts'],
    {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        USER: process.env.USER,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_VM_PORT: String(port),
        INTAKE_AGENT_PROTECTED_ORIGINS: 'http://127.0.0.1:1',
        INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
        INTAKE_AGENT_STATE_ROOT: join(root, 'state'),
        INTAKE_ACTOR_ID: fixture.config.actorId,
        INTAKE_TARGET_ID: fixture.config.targetId,
        INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
        INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret!,
        INTAKE_PROCESSING_PROFILE: 'shared-vm-agent/3',
        INTAKE_CLAUDE_EXECUTABLE: '/host-provider-must-never-run',
        INTAKE_CODEX_EXECUTABLE: '/host-provider-must-never-run',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  worker.stdout.on('data', (bytes: Buffer) => (output += bytes.toString()))
  worker.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
  const exited = once(worker, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
  t.after(async () => {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGKILL')
      await exited
    }
  })
  return { worker, exited, output: () => output }
}

/** A paired guest connection, retried until the worker's bridge listens. */
async function guestPeer(t: TestContext, root: string, port: number) {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const socket: TLSSocket = connect({
        ...(await pairing(join(root, 'bench-guest'))),
        port,
        host: '127.0.0.1',
        servername: 'bench-coordinator',
      })
      t.after(() => socket.destroy())
      await once(socket, 'secureConnect')
      const frames = new Frames(socket)
      await frames.send(TOOL_GUEST_GREETING)
      return { socket, frames }
    } catch (error) {
      if (Date.now() > deadline) {
        throw error
      }
      await delay(200)
    }
  }
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 90_000
  let value = await read()
  while (!done(value) && Date.now() < deadline) {
    await delay(250)
    value = await read()
  }
  assert.ok(done(value), `${label}: ${JSON.stringify(value)}`)
  return value
}

async function heldSlot(fixture: Fixture) {
  const rows = await fixture.db.pool.query<{
    attempt_id: string
    turn_child: string | null
    vm_command: string | null
  }>('SELECT attempt_id,turn_child,vm_command FROM agent_slot WHERE attempt_id IS NOT NULL')
  return rows.rows
}

async function session(fixture: Fixture) {
  const rows = await fixture.db.pool.query<{ attempt_id: string; session_state: string }>(
    'SELECT attempt_id,session_state FROM agent_session',
  )
  return rows.rows[0]
}

async function failureCodes(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ code: string }>(
    "SELECT diagnostic->>'code' AS code FROM agent_session_failure WHERE attempt_id=$1 ORDER BY created_at",
    [attemptId],
  )
  return rows.rows.map((row) => row.code)
}

/** A fixture with one running `/3` Claude subscription turn dispatched to a paired fake guest. */
async function runningVmTurn(t: TestContext) {
  // Short: the pairing directory sits in it.
  const root = await mkdtemp('/tmp/stale-slots-')
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  await mkdir(join(root, 'state'), { mode: 0o700 })
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      session_concurrency: 1,
    }),
  )
  const capture = await fixture.seedCapture()
  const port = await freePort()
  const first = startWorker(t, fixture, root, port)
  const guest = await guestPeer(t, root, port)
  await until(
    async () => first.output(),
    (text) => text.includes('session supervisor ready'),
    'worker ready',
  )
  const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: capture.batch.revision,
    subject_ids: [capture.packetA.id],
    stages: ['research'],
  })
  assert.equal(started.status, 202, JSON.stringify(started.value))
  const command = await guest.frames.read()
  await guest.frames.send({
    provider: { providerSessionId: 'fixture-session', actualModel: 'haiku' },
  })
  assert.equal((await guest.frames.read()).ok, true)
  const held = await heldSlot(fixture)
  assert.equal(held.length, 1)
  assert.equal(held[0].turn_child, 'vm')
  // The record is the exact command the guest received, so a later probe can name it.
  assert.equal(held[0].vm_command, JSON.stringify(command))
  return { root, fixture, port, first, guest, command, attemptId: held[0].attempt_id }
}

test(
  'a stopping worker waits for its VM turn’s removal proof and releases the slot',
  { timeout: 240_000 },
  async (t) => {
    const { root, fixture, port, first, command, attemptId } = await runningVmTurn(t)
    first.worker.kill('SIGTERM')
    // The relay's next connection carries the removal check for the exact command.
    const prober = await guestPeer(t, root, port)
    assert.deepEqual(await prober.frames.read(), { inspectTerminal: command, requireReap: true })
    // Longer than the scheduler's own 10 s shutdown wait.
    await delay(12_000)
    await prober.frames.send({ terminalOutcome: 'worker_removed' })
    const [code] = await first.exited
    assert.equal(code, 0, first.output())
    assert.deepEqual(await heldSlot(fixture), [])
    assert.deepEqual(await session(fixture), {
      attempt_id: attemptId,
      session_state: 'interrupted',
    })
    assert.deepEqual(await failureCodes(fixture, attemptId), ['agent_worker_interrupted'])
    const capability = await fixture.db.pool.query(
      'SELECT 1 FROM agent_session WHERE attempt_id=$1 AND capability_sha256 IS NOT NULL',
      [attemptId],
    )
    assert.equal(capability.rowCount, 0)
  },
)

test(
  'a slot shutdown could not confirm is released by the next start once the guest confirms it',
  { timeout: 300_000 },
  async (t) => {
    const { root, fixture, port, first, command, attemptId } = await runningVmTurn(t)
    first.worker.kill('SIGTERM')
    // No relay reconnects, so no proof arrives; the worker gives up after its bound.
    const [code] = await first.exited
    assert.equal(code, 0, first.output())
    const kept = await heldSlot(fixture)
    assert.equal(kept.length, 1)
    assert.equal(kept[0].attempt_id, attemptId)
    assert.equal((await session(fixture)).session_state, 'running')

    // `pnpm agents:reap`'s mode: the check alone, through a guest that confirms the removal.
    const check = startWorker(t, fixture, root, port, { INTAKE_AGENT_RECOVER_ONLY: '1' })
    const prober = await guestPeer(t, root, port)
    assert.deepEqual(await prober.frames.read(), { inspectTerminal: command, requireReap: true })
    await prober.frames.send({ terminalOutcome: 'worker_removed' })
    const [checked] = await check.exited
    assert.equal(checked, 0, check.output())
    assert.match(
      check.output(),
      new RegExp(
        `"event":"held_capacity_released","holds":"slot","attempt_id":"${attemptId}","reason":"vm_worker_removed"`,
      ),
    )
    assert.match(check.output(), /"event":"held_capacity_checked","released":1/)
    assert.deepEqual(await heldSlot(fixture), [])
    // The check alone leaves the session for the next start to interrupt.
    assert.equal((await session(fixture)).session_state, 'running')

    const next = startWorker(t, fixture, root, port)
    await until(
      async () => next.output(),
      (text) => text.includes('session supervisor ready'),
      'next start ready',
    )
    assert.deepEqual(await session(fixture), {
      attempt_id: attemptId,
      session_state: 'interrupted',
    })
    // One diagnostic per turn: the stopped worker's unconfirmed reap if it got to record it,
    // otherwise the interruption the next start records.
    const codes = await failureCodes(fixture, attemptId)
    assert.equal(codes.length, 1, JSON.stringify(codes))
    assert.ok(['agent_reap_pending', 'agent_worker_interrupted'].includes(codes[0]), codes[0])
    next.worker.kill('SIGTERM')
    assert.equal((await next.exited)[0], 0, next.output())
  },
)

test(
  'a turn cancelled while its VM command is being recorded sends nothing and frees its slot',
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp('/tmp/stale-record-')
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const capture = await fixture.seedCapture()
    const { attempt } = await lotSession(fixture, capture, capture.packetA, {
      state: 'queued',
      profile: {
        id: 'shared-vm-agent/3',
        agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
        settingsRevision: '1',
      },
    })
    const port = await freePort()
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
      protectedHosts: [],
    })
    t.after(() => bridge.close())
    const guest = await guestPeer(t, root, port)
    let received = false
    void guest.frames.read().then(
      () => {
        received = true
      },
      () => undefined,
    )
    const control = new AbortController()
    const turn = runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: {
          'shared-vm-agent/3': (sessionTurn, context) =>
            bridge.driver(sessionTurn, {
              ...context,
              // The worker is stopped while the record is being written.
              recordChild: async (child) => {
                await context.recordChild!(child)
                control.abort()
                await delay(200)
              },
            }),
        },
      },
      attempt,
      control.signal,
    )
    // Before the fix this waited 45 s for a proof of a command that was never sent.
    const started = Date.now()
    assert.equal(await turn, 'interrupted')
    assert.ok(Date.now() - started < 30_000)
    await delay(500)
    assert.equal(received, false)
    assert.deepEqual(await heldSlot(fixture), [])
  },
)
