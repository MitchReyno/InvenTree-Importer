import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { serveGuestTurn } from '#/agents/shared-vm/guest-turn.ts'
import type { nativeTurn } from '#/agents/shared-vm/native-turn.ts'
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
  const sessionsRoot = join(root, 'sessions')
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
  // The coordinator settles the attempt either way; the turn must never be left waiting.
  await session.catch(() => undefined)
  const [lineage] = await readdir(sessionsRoot)
  const [journal] = await readdir(join(sessionsRoot, lineage))
  const recorded = await readFile(join(sessionsRoot, lineage, journal), 'utf8')
  return { outcome: recorded.split('\n')[1] }
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
    const { outcome } = await pairedToolTurn(t, (root) => ({
      policyPath: join(root, 'missing-directory', 'policy.json'),
      runNative: async () => {
        starts++
      },
    }))
    assert.equal(starts, 0)
    assert.equal(outcome, 'agent_turn_failed')
  },
)

for (const [label, misconfiguration] of [
  ['without protected origins', {}],
  [
    'with a bridge port it cannot use',
    {
      INTAKE_AGENT_PROTECTED_ORIGINS: 'http://127.0.0.1:4330,https://inventory.example.com',
      INTAKE_VM_PORT: 'not-a-port',
    },
  ],
] as const) {
  test(
    `a VM tool worker ${label} refuses before it recovers retained sessions`,
    { timeout: 60000 },
    async (t) => {
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
      t.after(() => fixture.dispose())
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
      const root = await mkdtemp(join(tmpdir(), 'bench-worker-origins-'))
      t.after(() => rm(root, { recursive: true, force: true }))
      const stateRoot = join(root, 'state')
      await mkdir(stateRoot, { mode: 0o700 })
      const worker = spawn(
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
            ...misconfiguration,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let output = ''
      worker.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
      const [code] = await once(worker, 'exit')
      assert.equal(code, 1)
      assert.match(output, /"code":"session_agent_configuration_required"/)
      assert.equal(before, 'running')
      assert.equal(await stateOf(), before)
    },
  )
}
