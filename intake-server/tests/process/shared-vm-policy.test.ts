import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { connect } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { sealed } from '#/processing/model.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { serveGuestTurn } from '#/agents/shared-vm/guest-turn.ts'
import type { nativeTurn } from '#/agents/shared-vm/native-turn.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'

const protectedHosts = ['127.0.0.1', 'inventory.example.com']

/** One tool turn from a real coordinator to the real supervisor handler, with a fake provider. */
async function pairedToolTurn(
  t: TestContext,
  guest: (root: string) => { policyPath: string; runNative: typeof nativeTurn },
) {
  const root = await mkdtemp(join(tmpdir(), 'bench-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  // Apart from the host runner's own sessions directory under the same root.
  const sessionsRoot = join(root, 'guest-sessions')
  await mkdir(join(root, 'reap'))
  await mkdir(join(root, 'policy'))
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
  t.after(() => fixture.dispose())
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
    protectedHosts,
  })
  t.after(() => bridge.close())
  const capture = await fixture.seedCapture()
  const { attempt } = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'shared-vm-agent/2',
      agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      settingsRevision: '1',
    },
  })
  const session = runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: 'http://127.0.0.1:1',
      drivers: { 'shared-vm-agent/2': bridge.driver },
    },
    attempt,
    AbortSignal.timeout(30000),
  )
  const socket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const { policyPath, runNative } = guest(root)
  await serveGuestTurn(socket, {
    provider: 'claude',
    isolated: true,
    reapProof: true,
    sessionsRoot,
    reapPath: join(root, 'reap', 'turn'),
    policyPath,
    runNative,
  })
  const result = await session
  const [lineage] = await readdir(sessionsRoot)
  const [journal] = await readdir(join(sessionsRoot, lineage))
  const recorded = await readFile(join(sessionsRoot, lineage, journal), 'utf8')
  const {
    rows: [retained],
  } = await fixture.db.pool.query<{ session_state: string; slots: string }>(
    `SELECT s.session_state, (SELECT count(*) FROM agent_slot WHERE attempt_id = $1) AS slots
       FROM agent_session s WHERE s.attempt_id = $1`,
    [attempt],
  )
  return {
    outcome: recorded.split('\n')[1],
    result,
    sessionState: retained.session_state,
    slotHeld: retained.slots !== '0',
  }
}

test(
  'the supervisor publishes the coordinator’s protected hosts before the provider starts',
  { timeout: 60000 },
  async (t) => {
    const seen: unknown[] = []
    const { outcome } = await pairedToolTurn(t, (root) => {
      const policyPath = join(root, 'policy', 'policy.json')
      return {
        policyPath,
        runNative: async () => {
          seen.push(JSON.parse(await readFile(policyPath, 'utf8')))
        },
      }
    })
    assert.deepEqual(seen, [{ version: 1, public_pages: false, protected_hosts: protectedHosts }])
    assert.equal(outcome, 'done')
  },
)

test(
  'a policy the supervisor cannot write is a recorded failure and the provider never starts',
  { timeout: 60000 },
  async (t) => {
    let starts = 0
    const { outcome, result, sessionState, slotHeld } = await pairedToolTurn(t, (root) => ({
      policyPath: join(root, 'missing-directory', 'policy.json'),
      runNative: async () => {
        starts++
      },
    }))
    assert.equal(starts, 0)
    assert.equal(outcome, 'agent_turn_failed')
    // The coordinator settles the attempt as failed and gives its slot back.
    assert.equal(result, 'failed')
    assert.equal(sessionState, 'failed')
    assert.equal(slotHeld, false)
  },
)

test(
  'a malformed protected-host list is refused before the supervisor writes anything',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-bad-hosts-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    // Apart from the host runner's own sessions directory under the same root.
    const sessionsRoot = join(root, 'guest-sessions')
    await mkdir(join(root, 'reap'))
    await mkdir(join(root, 'policy'))
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
    t.after(() => fixture.dispose())
    const port = await freePort()
    // The coordinator passes its list through; the supervisor is the one that must refuse it.
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
      protectedHosts: ['Not A Host'],
    })
    t.after(() => bridge.close())
    const capture = await fixture.seedCapture()
    const { attempt } = await lotSession(fixture, capture, capture.packetA, {
      state: 'queued',
      profile: {
        id: 'shared-vm-agent/2',
        agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
        settingsRevision: '1',
      },
    })
    const stop = new AbortController()
    const session = runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: { 'shared-vm-agent/2': bridge.driver },
      },
      attempt,
      AbortSignal.any([stop.signal, AbortSignal.timeout(30000)]),
    )
    const socket = connect({
      ...(await pairing(join(root, 'bench-guest'))),
      port,
      host: '127.0.0.1',
      servername: 'bench-coordinator',
    })
    t.after(() => socket.destroy())
    await once(socket, 'secureConnect')
    let starts = 0
    await assert.rejects(
      serveGuestTurn(socket, {
        provider: 'claude',
        isolated: true,
        reapProof: true,
        sessionsRoot,
        reapPath: join(root, 'reap', 'turn'),
        policyPath: join(root, 'policy', 'policy.json'),
        runNative: async () => {
          starts++
        },
      }),
      /invalid_turn/,
    )
    assert.equal(starts, 0)
    assert.deepEqual(await readdir(join(root, 'policy')), [])
    assert.deepEqual(await readdir(join(root, 'reap')), [])
    assert.equal(await readdir(sessionsRoot).catch(() => 'absent'), 'absent')
    // The guest side is what this test checks; stop the coordinator's wait for a reconnect.
    stop.abort()
    await session.catch(() => undefined)
  },
)

test(
  'a tool-worker peer that cannot publish turn policy is dropped before any command',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-old-peer-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const port = await freePort()
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
      protectedHosts,
    })
    t.after(() => bridge.close())
    const socket = connect({
      ...(await pairing(join(root, 'bench-guest'))),
      port,
      host: '127.0.0.1',
      servername: 'bench-coordinator',
    })
    t.after(() => socket.destroy())
    await once(socket, 'secureConnect')
    const received: Buffer[] = []
    socket.on('data', (bytes: Buffer) => received.push(bytes))
    const frames = new Frames(socket)
    // The greeting of a supervisor from before turn policies existed.
    await frames.send({
      ready: protocol,
      reapProof: true,
      terminalProbe: true,
      builtinTools: true,
      evidenceFiles: true,
      claudeSubscription: true,
    })
    await once(socket, 'close')
    assert.deepEqual(received, [])
  },
)

/** A worker that refuses its configuration exits within seconds; longer means it hung. */
const WORKER_EXIT_TIMEOUT_MS = 20000

const validOrigins = 'http://127.0.0.1:4330,https://inventory.example.com'

interface Misconfiguration {
  label: string
  /** The refusal code the worker reports. */
  code: string
  /** Environment overrides, after any files or listeners the case needs. */
  prepare: (root: string, t: TestContext) => Promise<Record<string, string>>
}

const misconfigurations: Misconfiguration[] = [
  {
    label: 'without protected origins',
    code: 'session_agent_configuration_required',
    prepare: async () => ({}),
  },
  {
    label: 'with a bridge port it cannot use',
    code: 'session_agent_configuration_required',
    prepare: async () => ({ INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins, INTAKE_VM_PORT: 'x' }),
  },
  {
    label: 'without its pairing files',
    code: 'session_agent_startup_refused',
    prepare: async () => ({ INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins }),
  },
  {
    label: 'whose bridge port is already in use',
    code: 'session_agent_startup_refused',
    prepare: async (root, t) => {
      await pairedCertificates(root)
      const port = await freePort()
      const holder = createServer()
      holder.listen(port, '127.0.0.1')
      await once(holder, 'listening')
      t.after(() => holder.close())
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_VM_PORT: String(port),
      }
    },
  },
  {
    label: 'without a scheduler database',
    code: 'agent_database_required',
    // Everything else is valid, so the worker would otherwise go on to recover sessions.
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: '',
      }
    },
  },
  {
    label: 'whose scheduler database names another host',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: 'postgres://127.0.0.1:5432/dbos?host=192.0.2.10',
      }
    },
  },
  {
    label: 'whose scheduler database the driver cannot parse',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: 'postgres://127.0.0.1:5432/%C3',
      }
    },
  },
]

for (const misconfiguration of misconfigurations) {
  test(
    `a VM tool worker ${misconfiguration.label} refuses before it recovers retained sessions`,
    { timeout: 60000 },
    async (t) => {
      let worker: ChildProcess | undefined
      let root: string | undefined
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
      // One ordered teardown: the worker is reaped before its database is dropped.
      t.after(async () => {
        if (worker && worker.exitCode === null && worker.signalCode === null) {
          const reaped = once(worker, 'exit')
          worker.kill('SIGKILL')
          await reaped
        }
        await fixture.dispose()
        if (root) {
          await rm(root, { recursive: true, force: true })
        }
      })
      const capture = await fixture.seedCapture()
      const { attempt } = await lotSession(fixture, capture, capture.packetA, {
        state: 'running',
        profile: {
          id: 'shared-vm-agent/2',
          agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
          settingsRevision: '1',
        },
      })
      const stateOf = async () =>
        (
          await fixture.db.pool.query<{ session_state: string }>(
            'SELECT session_state FROM agent_session WHERE attempt_id=$1',
            [attempt],
          )
        ).rows[0]?.session_state
      const before = await stateOf()
      root = await mkdtemp(join(tmpdir(), 'bench-worker-origins-'))
      const stateRoot = join(root, 'state')
      await mkdir(stateRoot, { mode: 0o700 })
      const overrides = await misconfiguration.prepare(root, t)
      const spawned = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(
            new URL('../../src/agents/session/session-worker-main.ts', import.meta.url),
          ),
        ],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          env: {
            PATH: process.env.PATH,
            HOME: root,
            USER: process.env.USER,
            INTAKE_VM_PAIR: join(root, 'pair'),
            INTAKE_VM_PORT: String(await freePort()),
            INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
            INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
            INTAKE_AGENT_STATE_ROOT: stateRoot,
            INTAKE_ACTOR_ID: fixture.config.actorId,
            INTAKE_TARGET_ID: fixture.config.targetId,
            INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
            INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
            INTAKE_PROCESSING_PROFILE: 'shared-vm-agent/2',
            ...overrides,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      worker = spawned
      let output = ''
      spawned.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
      const exited = once(spawned, 'exit')
      const outcome = await Promise.race([
        exited,
        delay(WORKER_EXIT_TIMEOUT_MS).then(() => 'still running' as const),
      ])
      assert.notEqual(outcome, 'still running', 'the worker did not refuse within its deadline')
      const [code] = outcome as [number | null]
      assert.equal(code, 1)
      assert.match(output, new RegExp(`"code":"${misconfiguration.code}"`))
      assert.equal(before, 'running')
      assert.equal(await stateOf(), before)
    },
  )
}

test('retained session inputs decode with and without sealed web settings', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { attempt } = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'shared-vm-agent/2',
      agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      settingsRevision: '1',
    },
  })
  const {
    rows: [retained],
  } = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    `SELECT i.manifest_bytes, i.manifest_digest
       FROM processing_attempt a JOIN processing_input i ON i.id = a.input_id
      WHERE a.id = $1`,
    [attempt],
  )
  const manifest = decodeSessionInput(retained.manifest_bytes, retained.manifest_digest)
  assert.equal(manifest.web, undefined)
  const web = { public_pages: true, prefer_datasheets: false }
  const withWeb = sealed({ ...manifest, web })
  assert.deepEqual(decodeSessionInput(withWeb.bytes, withWeb.digest).web, web)
  for (const malformed of [
    { public_pages: 'yes', prefer_datasheets: false },
    { public_pages: true },
    { public_pages: true, prefer_datasheets: false, extra: 'x' },
  ]) {
    const input = sealed({ ...manifest, web: malformed })
    assert.throws(() => decodeSessionInput(input.bytes, input.digest), JSON.stringify(malformed))
  }
})
