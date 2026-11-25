import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { lotSession } from '../support/sessions.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { serveGuestTurn } from '#/agents/shared-vm/guest-turn.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import type { nativeTurn } from '#/agents/shared-vm/native-turn.ts'

/**
 * One API-key turn from the real coordinator to the real guest turn handler. The guest runs the
 * fake Claude CLI through the shared driver unless `runNative` replaces it.
 */
async function guestTurn(t: TestContext, runNative?: typeof nativeTurn) {
  const root = await mkdtemp(join(tmpdir(), 'bench-vm-effort-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  const executable = join(root, 'provider.cjs')
  const source = await readFile(new URL('../fixtures/session-agent.cjs', import.meta.url), 'utf8')
  await writeFile(executable, '#!/usr/bin/env node\n' + source)
  await chmod(executable, 0o755)
  // The guest's driver reads its CLI and key from its own environment.
  process.env.INTAKE_CLAUDE_EXECUTABLE = executable
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/1' })
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { job, attempt } = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'shared-vm-agent/1',
      agent: {
        provider: 'claude',
        authentication: 'api_key',
        model: 'claude-opus-5-5',
        effort: 'max',
      },
      settingsRevision: '1',
    },
  })
  const sessionsRoot = join(root, 'guest-sessions')
  const log = join(root, 'events')
  await mkdir(join(sessionsRoot, job), { recursive: true, mode: 0o700 })
  await writeFile(
    join(sessionsRoot, job, 'fake-session.json'),
    JSON.stringify({ mode: 'normal', log }),
  )
  const tools = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  t.after(() => tools.close())
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port)
  t.after(() => bridge.close())
  const session = runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: tools.url,
      drivers: { 'shared-vm-agent/1': bridge.driver },
    },
    attempt,
    AbortSignal.timeout(30_000),
  )
  const socket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  // A refused guest has its connection closed, so its side may fail too.
  const [served, outcome] = await Promise.allSettled([
    serveGuestTurn(socket, {
      provider: undefined,
      isolated: false,
      reapProof: false,
      sessionsRoot,
      reapPath: join(root, 'reap'),
      policyPath: join(root, 'policy.json'),
      runNative,
    }),
    session,
  ])
  const row = await fixture.db.pool.query<{ sent_effort: string | null }>(
    'SELECT sent_effort FROM agent_session WHERE attempt_id=$1',
    [attempt],
  )
  const events = (await readFile(log, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { served, outcome, sentEffort: row.rows[0].sent_effort, events }
}

test(
  "a guest turn passes its sealed effort to the CLI, and the guest's report is recorded",
  { timeout: 60_000 },
  async (t) => {
    const run = await guestTurn(t)
    assert.equal(run.served.status, 'fulfilled')
    assert.deepEqual(
      run.outcome,
      { status: 'fulfilled', value: 'finished' },
      JSON.stringify(run.events),
    )
    const args = run.events.find((event) => event.event === 'claude-args')
    assert.deepEqual(args, { event: 'claude-args', model: 'claude-opus-5-5', effort: 'max' })
    assert.equal(run.sentEffort, 'max')
  },
)

test(
  'a guest reporting an effort its input did not seal is refused and nothing is recorded',
  { timeout: 60_000 },
  async (t) => {
    const run = await guestTurn(t, async (_context, _opening, request) => {
      await request({ provider: { providerSessionId: 'guest-session', actualModel: 'claude-x' } })
      await request({ sentEffort: 'low' })
    })
    // The coordinator closes the turn, which then waits for the guest's proof that it stopped.
    assert.equal(run.outcome.status, 'rejected')
    assert.match(String((run.outcome as PromiseRejectedResult).reason), /reap/)
    assert.equal(run.sentEffort, null)
  },
)
