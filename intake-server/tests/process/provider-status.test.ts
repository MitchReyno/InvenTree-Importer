import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connect } from 'node:tls'
import { connect as connectNet } from 'node:net'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProviderStatusDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { CodexAccount } from '#/agents/shared-vm/codex-login.ts'
import { credentialStore } from '#/agents/shared-vm/claude-credential.ts'
import {
  claudeStatusReader,
  codexStatusReader,
  startStatusService,
} from '#/agents/shared-vm/credential-status.ts'
import { serveProviderStatusRequests } from '#/agents/provider-status-channel.ts'
import { lastSignInFailures } from '#/agents/sign-in-failures.ts'

const relay = resolve(import.meta.dirname, '../../../tooling/deployment/bridge/relay.mjs')

// Stands in for Lima and the guest engine: `docker exec` into a management container runs the
// relay's pump here against that container's test socket; a turn container just waits.
const FAKE_LIMACTL = `#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
[ "$1" = docker ] || exit 2
if [ "$2" = exec ]; then
  container=$4
  pump=$7
  exec node -e "$pump" "$STATUS_SOCKETS/$container.sock"
fi
exec sleep 600
`

/** Starts a real relay for one provider and kills its whole process group afterwards. */
function startRelay(
  t: TestContext,
  bin: string,
  sockets: string,
  port: number,
  flag: string,
  coordinatorContainer?: string,
) {
  const child = spawn(
    process.execPath,
    [
      relay,
      'bench-agent-test',
      String(port),
      '/guest',
      'runner:test',
      ...(coordinatorContainer ? [coordinatorContainer] : []),
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { PATH: bin + ':' + process.env.PATH, STATUS_SOCKETS: sockets, [flag]: '1' },
    },
  )
  t.after(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  })
  return child
}

test(
  'the deployed two-provider topology reads both statuses before any turn',
  { timeout: 120000 },
  async (t) => {
    // Short: a Unix socket path is limited to about 100 bytes.
    const root = await mkdtemp('/tmp/status-topology-')
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const bin = join(root, 'bin')
    const sockets = join(root, 'sockets')
    await mkdir(bin)
    await mkdir(sockets)
    await writeFile(join(bin, 'limactl'), FAKE_LIMACTL)
    await chmod(join(bin, 'limactl'), 0o755)

    // The two credential services, as the provisioning scripts start them.
    const store = join(root, 'claude-store')
    await mkdir(store)
    const claude = credentialStore(store, () => new Date('2026-11-23T22:00:00.000Z'))
    t.after(() => claude.close())
    claude.change(claude.status().revision, 'sk-ant-oat01-topology-sentinel-token')
    const account = new CodexAccount(join(root, 'codex-state'), () => ({
      initialize: async () => {},
      close: async () => {},
      connected: async () => false,
      request: async () => ({
        type: 'chatgptDeviceCode',
        loginId: 'be8d5568-670e-4618-a98a-557c7c7862d0',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
      }),
    }))
    await account.action('start')
    // Ends the pending login and its expiry timer.
    t.after(() => account.action('cancel', 'be8d5568-670e-4618-a98a-557c7c7862d0'))
    const guestPair = join(root, 'bench-guest')
    for (const [provider, read] of [
      ['claude', claudeStatusReader(store)],
      ['codex', codexStatusReader(account)],
    ] as const) {
      const server = await startStatusService(
        provider,
        read,
        guestPair,
        join(sockets, `bench-${provider}-management.sock`),
      )
      assert.ok(server)
      t.after(() => server.close())
    }

    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const port = await freePort()
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port)
    t.after(() => bridge.close())
    const worker = serveProviderStatusRequests(
      fixture.runner.pool,
      fixture.config,
      bridge.providerStatus,
    )
    // Before the fixture's own cleanup, which waits for the worker's connection.
    await using _worker = { [Symbol.asyncDispose]: () => worker.close() }
    startRelay(t, bin, sockets, port, 'INTAKE_VM_CLAUDE_SUBSCRIPTION')
    startRelay(t, bin, sockets, port, 'INTAKE_VM_CODEX_SUBSCRIPTION')

    let status: ProviderStatusDto | undefined
    for (let i = 0; i < 60; i++) {
      const response = await fixture.http('/agents/provider-status')
      status = response.value as ProviderStatusDto
      if (status.claude.state !== 'unknown' && status.codex.state !== 'unknown') {
        break
      }
      // The route reuses a read for 5 s; the relays connect within a few seconds.
      await delay(1000)
    }
    assert.deepEqual(status?.claude, {
      state: 'saved',
      saved_at: '2026-11-23T22:00:00.000Z',
      last_sign_in_failure: null,
    })
    assert.deepEqual(status?.codex, { state: 'signing_in', last_sign_in_failure: null })
    assert.ok(!JSON.stringify(status).includes('sentinel'))
  },
)

test(
  'a VM turn the provider refused sign-in for, through the real session runner, is the last-session line',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'status-refusal-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/1' })
    t.after(() => fixture.dispose())
    const port = await freePort()
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port)
    t.after(() => bridge.close())
    const capture = await fixture.seedCapture()
    const { attempt } = await lotSession(fixture, capture, capture.packetA, {
      state: 'queued',
      profile: {
        id: 'shared-vm-agent/1',
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
        drivers: { 'shared-vm-agent/1': bridge.driver },
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
    const frames = new Frames(socket)
    await frames.send({ ready: protocol, claudeSubscription: true, providerStatus: true })
    await frames.read()
    await frames.send({ provider: { providerSessionId: 'fixture-session', actualModel: 'haiku' } })
    assert.equal((await frames.read()).ok, true)
    await frames.send({
      failure: 'agent_login_required',
      provider_error: { kind: 'authentication_failed', result: null, http_status: 401 },
    })
    // Login required waits for the operator; its diagnostic keeps the provider's refusal.
    assert.equal(await session, 'waiting_for_login')
    const lines = await lastSignInFailures(fixture.api.pool, fixture.config)
    assert.equal(lines.claude?.attempt_id, attempt)
    assert.equal(lines.codex, null)
  },
)

// The first pump exits right after reporting ready, the second never reports it; later ones work.
const FLAKY_LIMACTL = `#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
[ "$1" = docker ] || exit 2
if [ "$2" = exec ]; then
  count=$(cat "$STATUS_SOCKETS/count" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$STATUS_SOCKETS/count"
  if [ "$count" = 1 ]; then
    echo ready >&2
    exit 0
  fi
  [ "$count" = 2 ] && exec sleep 600
  exec node -e "$7" "$STATUS_SOCKETS/$4.sock"
fi
exec sleep 600
`

test(
  'a status pump that fails after starting, or never starts, is retried while the relay runs',
  { timeout: 120000 },
  async (t) => {
    const root = await mkdtemp('/tmp/status-retry-')
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const bin = join(root, 'bin')
    const sockets = join(root, 'sockets')
    await mkdir(bin)
    await mkdir(sockets)
    await writeFile(join(bin, 'limactl'), FLAKY_LIMACTL)
    await chmod(join(bin, 'limactl'), 0o755)
    const store = join(root, 'claude-store')
    await mkdir(store)
    const claude = credentialStore(store)
    t.after(() => claude.close())
    const server = await startStatusService(
      'claude',
      claudeStatusReader(store),
      join(root, 'bench-guest'),
      join(sockets, 'bench-claude-management.sock'),
    )
    assert.ok(server)
    t.after(() => server.close())
    const port = await freePort()
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port)
    t.after(() => bridge.close())
    const relayed = startRelay(t, bin, sockets, port, 'INTAKE_VM_CLAUDE_SUBSCRIPTION')
    let exited = false
    relayed.once('exit', () => {
      exited = true
    })
    let state = 'unknown'
    for (let i = 0; i < 90 && state === 'unknown'; i++) {
      state = (await bridge.providerStatus()).claude.state
      if (state === 'unknown') {
        await delay(1000)
      }
    }
    assert.equal(state, 'not_saved')
    assert.equal(exited, false)
  },
)

// A containerized coordinator whose pump never reports ready: each attempt records its pid.
const STUCK_DOCKER = `#!/bin/sh
echo $$ > "$STATUS_SOCKETS/coordinator-pump.$$"
exec sleep 600
`

test(
  'a coordinator pump that never starts is stopped each time the status loop gives up on it',
  { timeout: 150000 },
  async (t) => {
    const root = await mkdtemp('/tmp/status-stuck-')
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const bin = join(root, 'bin')
    const sockets = join(root, 'sockets')
    await mkdir(bin)
    await mkdir(sockets)
    await writeFile(join(bin, 'limactl'), FAKE_LIMACTL)
    await writeFile(join(bin, 'docker'), STUCK_DOCKER)
    await chmod(join(bin, 'limactl'), 0o755)
    await chmod(join(bin, 'docker'), 0o755)
    const store = join(root, 'claude-store')
    await mkdir(store)
    const claude = credentialStore(store)
    t.after(() => claude.close())
    const server = await startStatusService(
      'claude',
      claudeStatusReader(store),
      join(root, 'bench-guest'),
      join(sockets, 'bench-claude-management.sock'),
    )
    assert.ok(server)
    t.after(() => server.close())
    startRelay(t, bin, sockets, await freePort(), 'INTAKE_VM_CLAUDE_SUBSCRIPTION', 'coordinator')

    const pumps = async () => {
      const { readdir } = await import('node:fs/promises')
      const names = (await readdir(sockets)).filter((name) => name.startsWith('coordinator-pump.'))
      return names.map((name) => Number(name.slice('coordinator-pump.'.length)))
    }
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    // The turn loop's attempt and two status attempts.
    let started: number[] = []
    for (let i = 0; i < 120 && started.length < 3; i++) {
      await delay(1000)
      started = await pumps()
    }
    assert.ok(started.length >= 3, 'the status loop retried')
    // Only the turn loop's attempt, which waits as before, and the current status one remain.
    await delay(500)
    assert.ok(started.filter(alive).length <= 2, `${started.filter(alive).length} pumps alive`)
  },
)

const docker = (args: string[], input?: string) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))
    child.once('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input ?? '')
  })

// Listens where the credential service does, and echoes what it is sent.
const ECHO_SERVICE = `
  const { mkdirSync } = require('node:fs')
  mkdirSync('/tmp/bench-status', { recursive: true, mode: 0o700 })
  require('node:net')
    .createServer((socket) => socket.on('data', (data) => socket.end('echo:' + data)))
    .listen('/tmp/bench-status/status.sock', () => console.log('listening'))
`
const PROBE = `
  require('node:net')
    .connect(process.argv[1])
    .on('connect', () => console.log('connected'))
    .on('error', (error) => console.log('refused ' + error.code))
`

test(
  "the status socket is reachable through the relay's docker exec only, not from another container or the host",
  {
    timeout: 120000,
    // Any Node image works; the process tier already builds this one.
    skip: process.env.INTAKE_MEDIA_DECODER_IMAGE
      ? false
      : 'Set INTAKE_MEDIA_DECODER_IMAGE to the explicitly built owned image',
  },
  async (t) => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE!
    const source = await readFile(relay, 'utf8')
    const pump = /const statusPump = `([\s\S]*?)`/.exec(source)![1].replaceAll('\\\\', '\\')
    const socketPath = /const statusSocket = '([^']+)'/.exec(source)![1]
    const name = 'bench-status-isolation-' + randomUUID()
    const container = [
      '--network=none',
      '--read-only',
      '--tmpfs=/tmp',
      '--cap-drop=ALL',
      '--user=1000:1000',
    ]
    const started = await docker([
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      ...container,
      '--entrypoint',
      'node',
      image,
      '-e',
      ECHO_SERVICE,
    ])
    assert.equal(started.code, 0, started.stderr)
    t.after(() => docker(['rm', '-f', name]))
    for (let i = 0; i < 50; i++) {
      if ((await docker(['logs', name])).stdout.includes('listening')) {
        break
      }
      await delay(100)
    }

    // The relay's pump, run in the service's container, reaches it.
    const relayed = await docker(['exec', '-i', name, 'node', '-e', pump, socketPath], 'ping')
    assert.equal(relayed.stderr.trim(), 'ready')
    assert.equal(relayed.stdout, 'echo:ping')

    // Another container on the same engine, and this host, have no such socket.
    const other = await docker([
      'run',
      '--rm',
      ...container,
      '--entrypoint',
      'node',
      image,
      '-e',
      PROBE,
      socketPath,
    ])
    assert.equal(other.stdout.trim(), 'refused ENOENT')
    const host = await new Promise<string>((resolve) => {
      const socket = connectNet(socketPath)
      socket.once('connect', () => {
        socket.destroy()
        resolve('connected')
      })
      socket.once('error', (error: NodeJS.ErrnoException) => resolve('refused ' + error.code))
    })
    assert.equal(host, 'refused ENOENT')
  },
)
