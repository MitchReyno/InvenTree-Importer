import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { connect } from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { startSessionBridge, type BridgeCatalogAnswer } from '#/agents/shared-vm/coordinator.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { credentialStore } from '#/agents/shared-vm/claude-credential.ts'
import { claudeStatusReader, startStatusService } from '#/agents/shared-vm/credential-status.ts'
import { claudeCatalogReader, startCatalogService } from '#/agents/shared-vm/credential-catalog.ts'
import { CATALOG_PROTOCOL, type GuestCatalogReader } from '#/agents/shared-vm/model-catalog.ts'
import { claudeCliModels } from '#/agents/model-catalog/normalise.ts'

const relay = resolve(import.meta.dirname, '../../../tooling/deployment/bridge/relay.mjs')
const fakeCli = resolve(import.meta.dirname, '../fixtures/model-catalog-cli.cjs')

// Stands in for Lima and the guest engine, as in the provider status test: each `docker exec`
// pump runs here against the named container's test socket for the status or catalogue socket.
const FAKE_LIMACTL = `#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
[ "$1" = docker ] || exit 2
if [ "$2" = exec ]; then
  case "$8" in *catalog.sock) exec node -e "$7" "$SOCKETS/$4.catalog.sock" ;; esac
  exec node -e "$7" "$SOCKETS/$4.sock"
fi
exec sleep 600
`

const CATALOG_TIMING = { readMs: 6000, generationMs: 3000, peerWaitMs: 500 }

interface Topology {
  root: string
  sockets: string
  store: string
  log: string
  bin: string
  port: number
  bridge: Awaited<ReturnType<typeof startSessionBridge>>
  claude: ReturnType<typeof credentialStore>
}

/** A Claude credential service with its status and catalogue endpoints, a bridge and a relay. */
async function topology(t: TestContext, mode: 'answer' | 'hang', delayMs = 0): Promise<Topology> {
  // Short: a Unix socket path is limited to about 100 bytes.
  const root = await mkdtemp('/tmp/catalog-')
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  const bin = join(root, 'bin')
  const sockets = join(root, 'sockets')
  const scratch = join(root, 'scratch')
  await Promise.all([mkdir(bin), mkdir(sockets), mkdir(scratch)])
  await writeFile(join(bin, 'limactl'), FAKE_LIMACTL)
  await chmod(join(bin, 'limactl'), 0o755)
  const log = join(root, 'cli.log')
  // The reader passes the CLI only an allowlisted environment, so the wrapper sets the fake's.
  const claudeCli = join(bin, 'claude-fixture')
  await writeFile(
    claudeCli,
    `#!/bin/sh\nMODEL_CATALOG_LOG='${log}' MODEL_CATALOG_MODE=${mode} MODEL_CATALOG_DELAY_MS=${delayMs} exec node '${fakeCli}' "$@"\n`,
  )
  await chmod(claudeCli, 0o755)

  const store = join(root, 'claude-store')
  await mkdir(store)
  const claude = credentialStore(store)
  t.after(() => claude.close())
  claude.change(claude.status().revision, 'sk-ant-oat01-catalog-sentinel-token')
  const guestPair = join(root, 'bench-guest')
  const status = await startStatusService(
    'claude',
    claudeStatusReader(store),
    guestPair,
    join(sockets, 'bench-claude-management.sock'),
  )
  const catalog = await startCatalogService(
    'claude',
    claudeCatalogReader(store, claudeCli, scratch),
    guestPair,
    join(sockets, 'bench-claude-catalog.catalog.sock'),
  )
  assert.ok(status && catalog)
  t.after(() => status.close())
  t.after(() => catalog.close())

  const port = await freePort()
  const bridge = await startSessionBridge(
    join(root, 'bench-coordinator'),
    port,
    undefined,
    undefined,
    CATALOG_TIMING,
  )
  t.after(() => bridge.close())
  startRelay(t, bin, sockets, port)
  // The relay's catalogue connection comes up within a few seconds.
  let answer: BridgeCatalogAnswer | undefined
  for (let i = 0; i < 60; i++) {
    answer = await bridge.modelCatalog('claude', 'generation')
    if (answer.kind === 'generation') {
      break
    }
    await delay(500)
  }
  assert.equal(answer?.kind, 'generation')
  return { root, sockets, store, log, bin, port, bridge, claude }
}

function startRelay(t: TestContext, bin: string, sockets: string, port: number) {
  const child = spawn(
    process.execPath,
    [relay, 'bench-agent-test', String(port), '/guest', 'runner:test'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        PATH: bin + ':' + process.env.PATH,
        SOCKETS: sockets,
        INTAKE_VM_CLAUDE_SUBSCRIPTION: '1',
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

async function cliLog(log: string) {
  const text = await readFile(log, 'utf8').catch(() => '')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test(
  'a catalogue read through the real relay answers while status reads keep their deadline',
  { timeout: 120000 },
  async (t) => {
    const world = await topology(t, 'answer', 2000)
    // A generation-only answer is the store revision and starts no CLI.
    const generation = await world.bridge.modelCatalog('claude', 'generation')
    assert.deepEqual(generation, { kind: 'generation', generation: world.claude.status().revision })
    assert.deepEqual(await cliLog(world.log), [])

    // Both of the relay's catalogue connections start together; give the second a moment.
    await delay(1000)
    const reading = world.bridge.modelCatalog('claude', 'read')
    await delay(300)
    // The relay's second catalogue connection answers a generation check while the read runs.
    const generationStarted = performance.now()
    const during = await world.bridge.modelCatalog('claude', 'generation')
    assert.equal(during.kind, 'generation')
    assert.ok(performance.now() - generationStarted < 1000)
    const statusStarted = performance.now()
    const status = await world.bridge.providerStatus()
    assert.ok(performance.now() - statusStarted < 1800)
    assert.equal(status.claude.state, 'saved')
    const answer = await reading
    assert.equal(answer.kind, 'read')
    assert.ok(answer.kind === 'read')
    assert.equal(answer.read.generation, world.claude.status().revision)
    assert.equal(answer.read.cliVersion, '2.1.319')
    assert.equal(claudeCliModels(answer.read.raw).length, 13)
    // The CLI got the token and only `initialize`: no user message.
    const frames = await cliLog(world.log)
    const received = frames.filter((frame) => 'received' in frame)
    assert.equal(received.length, 1)
    assert.deepEqual((received[0].received as { request: unknown }).request, {
      subtype: 'initialize',
    })
    assert.ok(!JSON.stringify(answer).includes('sentinel'))
  },
)

test('a Claude token replaced during a read discards it', { timeout: 120000 }, async (t) => {
  const world = await topology(t, 'answer', 1500)
  const reading = world.bridge.modelCatalog('claude', 'read')
  await delay(500)
  world.claude.change(world.claude.status().revision, 'sk-ant-oat01-replacement-sentinel')
  assert.deepEqual(await reading, { kind: 'failure', failure: 'unavailable' })
})

test(
  'a read that runs out of time answers timeout once its CLI is reaped',
  { timeout: 120000 },
  async (t) => {
    const world = await topology(t, 'hang')
    const started = performance.now()
    const answer = await world.bridge.modelCatalog('claude', 'read')
    assert.deepEqual(answer, { kind: 'failure', failure: 'timeout' })
    assert.ok(performance.now() - started < CATALOG_TIMING.readMs + 500)
    const launched = (await cliLog(world.log)).find((frame) => 'started' in frame)
    assert.ok(launched)
    // The CLI ignored SIGTERM; the reader's SIGKILL and reap ended it before the answer.
    assert.throws(() => process.kill(launched.pid as number, 0), { code: 'ESRCH' })
    // The connection was kept: the next generation read answers.
    assert.equal((await world.bridge.modelCatalog('claude', 'generation')).kind, 'generation')
  },
)

test(
  'an oversized answer, an outdated guest and an absent VM are refused with fixed codes',
  { timeout: 120000 },
  async (t) => {
    const root = await mkdtemp('/tmp/catalog-limits-')
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const port = await freePort()
    const bridge = await startSessionBridge(
      join(root, 'bench-coordinator'),
      port,
      undefined,
      undefined,
      CATALOG_TIMING,
    )
    t.after(() => bridge.close())
    // Nothing paired is connected.
    assert.deepEqual(await bridge.modelCatalog('codex', 'read'), {
      kind: 'failure',
      failure: 'vm_unreachable',
    })

    // A turn guest from before this change greets without the catalogue capability.
    const turn = connect({
      ...(await pairing(join(root, 'bench-guest'))),
      port,
      host: '127.0.0.1',
      servername: 'bench-coordinator',
    })
    t.after(() => turn.destroy())
    await once(turn, 'secureConnect')
    await new Frames(turn).send({ ready: protocol, codexSubscription: true, providerStatus: true })
    await delay(200)
    assert.deepEqual(await bridge.modelCatalog('codex', 'read'), {
      kind: 'failure',
      failure: 'guest_outdated',
    })

    // A catalogue peer that never answers: an already-ended request sends it nothing, and a
    // live one gives up at its deadline and closes the connection.
    const silent = connect({
      ...(await pairing(join(root, 'bench-guest'))),
      port,
      host: '127.0.0.1',
      servername: 'bench-coordinator',
    })
    t.after(() => silent.destroy())
    await once(silent, 'secureConnect')
    await new Frames(silent).send({ ready: CATALOG_PROTOCOL, provider: 'claude' })
    let received = 0
    silent.on('data', () => received++)
    await delay(200)
    assert.deepEqual(await bridge.modelCatalog('claude', 'read', AbortSignal.abort()), {
      kind: 'failure',
      failure: 'timeout',
    })
    await delay(100)
    assert.equal(received, 0)
    const asked = performance.now()
    assert.deepEqual(await bridge.modelCatalog('claude', 'generation'), {
      kind: 'failure',
      failure: 'timeout',
    })
    assert.ok(performance.now() - asked < CATALOG_TIMING.generationMs + 500)
    await delay(100)
    assert.ok(received > 0)
    assert.ok(silent.destroyed || silent.readableEnded)

    // A guest reader whose list exceeds the frame: the guest answers malformed, never a cut list.
    const huge: GuestCatalogReader = {
      generation: async () => 'generation-1',
      read: async () => ({
        generation: 'generation-1',
        cliVersion: '0.166.0',
        raw: [
          {
            data: Array.from({ length: 2000 }, (_unused, i) => ({
              id: `m-${i}-${'x'.repeat(30)}`,
            })),
          },
        ],
      }),
    }
    const socket = join(root, 'catalog.sock')
    const server = await startCatalogService('codex', huge, join(root, 'bench-guest'), socket)
    assert.ok(server)
    t.after(() => server.close())
    const { connect: connectNet } = await import('node:net')
    const pump = connectNet(socket)
    const coordinator = connectNet(port, '127.0.0.1')
    t.after(() => {
      pump.destroy()
      coordinator.destroy()
    })
    pump.pipe(coordinator).pipe(pump)
    let answer: BridgeCatalogAnswer | undefined
    for (let i = 0; i < 40; i++) {
      answer = await bridge.modelCatalog('codex', 'read')
      if (answer.kind !== 'failure' || answer.failure !== 'guest_outdated') {
        break
      }
      await delay(100)
    }
    assert.deepEqual(answer, { kind: 'failure', failure: 'malformed' })
  },
)
