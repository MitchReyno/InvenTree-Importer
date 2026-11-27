import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { connect, type TLSSocket } from 'node:tls'
import { connect as netConnect, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { pairedCertificates } from './support/vm-pairing.ts'
import { freePort } from './support/manual-process.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { SessionCapacityUnavailable, type SessionTurn } from '#/agents/session/session-adapters.ts'
import type { SessionDriverContext } from '#/agents/session/session-runner.ts'
import type { TurnChild } from '#/agents/session/slots.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'

/** A tool-capable Claude guest's greeting, as the paired supervisor sends it. */
const CLAUDE_TOOL_GUEST = {
  ready: protocol,
  reapProof: true,
  terminalProbe: true,
  builtinTools: true,
  evidenceFiles: true,
  evidenceRelease: 1,
  turnPolicy: true,
  claudeSubscription: true,
  codexSubscription: false,
  providerStatus: true,
  modelCatalog: true,
}

/** Short waits, so a test needn't sit out a tool turn's 45 s. */
const TIMING = {
  toolWorkerPeerWaitMs: 1500,
  peerWaitMs: 1500,
  startupHoldMs: 5000,
  startupWaitMs: 5000,
  startedIdleMs: 1000,
}

async function bridgeFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'turn-capacity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  const port = await freePort()
  const bridge = await startSessionBridge(
    join(root, 'bench-coordinator'),
    port,
    { protectedHosts: [] },
    undefined,
    undefined,
    TIMING,
  )
  t.after(() => bridge.close())
  return { root, port, bridge }
}

/**
 * A paired guest connection that has greeted, as a relay lane's guest does: on its own
 * connection, or on `transport`, a lane offer the coordinator asked for its guest.
 */
async function guest(
  t: TestContext,
  root: string,
  port: number,
  extra: Record<string, unknown> = {},
  transport?: Socket,
) {
  const socket: TLSSocket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    ...(transport ? { socket: transport } : { port, host: '127.0.0.1' }),
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const frames = new Frames(socket)
  await frames.send({ ...CLAUDE_TOOL_GUEST, ...extra })
  return { socket, frames }
}

/** A relay lane's offer for Claude tool turns; resolves with what the coordinator wrote back. */
async function offer(t: TestContext, port: number, provider = 'claude') {
  const socket = netConnect(port, '127.0.0.1')
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  socket.write(`bench-lane/1 ${provider} tools\n`)
  let received = ''
  socket.on('data', (bytes) => {
    received += bytes.toString('latin1')
  })
  return { socket, received: () => received }
}

function claudeManifest(profile: 'shared-vm-agent/1' | 'shared-vm-agent/3', provider = 'claude') {
  return {
    profile_id: profile,
    agent: { provider, authentication: 'subscription', model: 'haiku' },
  } as unknown as SessionDriverContext['manifest']
}

const turn = {
  instructions: 'i',
  text: 't',
  tools: [],
  toolUrl: 'http://127.0.0.1:1',
  capability: 'c',
  onStarted: async () => {},
} as unknown as SessionTurn

function context(manifest: SessionDriverContext['manifest'], signal: AbortSignal) {
  const children: TurnChild[] = []
  const value: SessionDriverContext = {
    identity: {
      attemptId: '00000000-0000-4000-8000-000000000001',
      turn: '1',
      lineage: '00000000-0000-4000-8000-000000000002',
    },
    manifest,
    cwd: '/unused',
    signal,
    recordChild: async (child) => {
      children.push(child)
    },
  }
  return { value, children }
}

test('a turn whose route has only busy connections is put back in the queue', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  const peer = await guest(t, root, port)
  const firstControl = new AbortController()
  const first = context(claudeManifest('shared-vm-agent/3'), firstControl.signal)
  const running = bridge.driver(turn, first.value).catch((error: unknown) => error)
  // The first turn has the only connection once its command arrives, and its start is done.
  await peer.frames.read()
  await peer.frames.send({ provider: { providerSessionId: 'p', actualModel: 'haiku' } })

  const second = context(claudeManifest('shared-vm-agent/3'), new AbortController().signal)
  await assert.rejects(bridge.driver(turn, second.value), SessionCapacityUnavailable)
  // It sent nothing, so it recorded nothing.
  assert.deepEqual(second.children, [])
  firstControl.abort()
  bridge.close()
  await running
})

test('a tool turn whose route has no connection fails with agent_vm_unavailable', async (t) => {
  const { bridge } = await bridgeFixture(t)
  const turnContext = context(claudeManifest('shared-vm-agent/3'), new AbortController().signal)
  await assert.rejects(
    bridge.driver(turn, turnContext.value),
    (error: unknown) =>
      error instanceof NativeSessionError && error.code === 'agent_vm_unavailable',
  )
  assert.deepEqual(turnContext.children, [])
})

test('a subscription turn without tools and no connection still needs a sign-in', async (t) => {
  const { bridge } = await bridgeFixture(t)
  const turnContext = context(claudeManifest('shared-vm-agent/1'), new AbortController().signal)
  await assert.rejects(
    bridge.driver(turn, turnContext.value),
    (error: unknown) =>
      error instanceof NativeSessionError && error.code === 'agent_login_required',
  )
})

test('the coordinator admits more than eight turn connections for one provider', async (t) => {
  const { root, port } = await bridgeFixture(t)
  const peers = []
  for (let index = 0; index < 12; index++) {
    peers.push(await guest(t, root, port))
  }
  await delay(500)
  assert.deepEqual(
    peers.map((peer) => peer.socket.destroyed),
    peers.map(() => false),
  )
})

test('the VM turn capacity follows the memory the latest guest reports', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  // Nothing reported yet: one turn at a time.
  assert.equal(bridge.turnCapacity(), 1)
  await guest(t, root, port, { memoryBytes: 4 * 1024 ** 3 })
  await delay(200)
  assert.equal(bridge.turnCapacity(), 3)
  // An older guest reports none, so the VM is again taken to hold one.
  await guest(t, root, port)
  await delay(200)
  assert.equal(bridge.turnCapacity(), 1)
})

test('a lane offer gets its guest only once a turn needs one', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  const lane = await offer(t, port)
  await delay(300)
  assert.equal(lane.received(), '')

  const control = new AbortController()
  const turnContext = context(claudeManifest('shared-vm-agent/3'), control.signal)
  const running = bridge.driver(turn, turnContext.value).catch((error: unknown) => error)
  const deadline = Date.now() + 3000
  while (lane.received() !== 'go\n') {
    assert.ok(Date.now() < deadline, lane.received())
    await delay(25)
  }
  lane.socket.removeAllListeners('data')
  // The guest the relay starts speaks TLS on the same connection and gets the turn's command.
  const started = await guest(t, root, port, {}, lane.socket)
  const command = await started.frames.read()
  assert.equal(command.attemptId, turnContext.value.identity.attemptId)
  await started.frames.send({ done: true })
  assert.equal(await running, undefined)
})

test('a second turn reaches its guest only once the first is admitted', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  const first = await guest(t, root, port)
  const second = await guest(t, root, port)
  const controls = [new AbortController(), new AbortController()]
  const runs = controls.map((control) =>
    bridge
      .driver(turn, context(claudeManifest('shared-vm-agent/3'), control.signal).value)
      .catch((error: unknown) => error),
  )
  // Either guest may get the first command; the other must wait for its admission.
  let arrived = 0
  const commands = [first, second].map((peer) =>
    peer.frames.read().then(() => {
      arrived++
      return peer
    }),
  )
  const leading = await Promise.race(commands)
  await delay(500)
  assert.equal(arrived, 1)
  await leading.frames.send({ provider: { providerSessionId: 'p', actualModel: 'haiku' } })
  await Promise.race([Promise.all(commands), delay(2000).then(() => assert.fail('late command'))])
  for (const peer of [first, second]) {
    await peer.frames.send({ done: true })
  }
  assert.deepEqual(await Promise.all(runs), [undefined, undefined])
})

test('a guest still starting when its turn gives up is stopped', async (t) => {
  const { port, bridge } = await bridgeFixture(t)
  const lane = await offer(t, port)
  const control = new AbortController()
  const turnContext = context(claudeManifest('shared-vm-agent/3'), control.signal)
  const running = bridge.driver(turn, turnContext.value).catch((error: unknown) => error)
  while (lane.received() !== 'go\n') {
    await delay(25)
  }
  // Cancelled before its guest has greeted: no other waiter needs that guest.
  const closed = once(lane.socket, 'close')
  control.abort()
  await running
  await closed
})

test('closing the bridge puts a turn waiting to start back in the queue', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  const first = await guest(t, root, port)
  const holding = bridge
    .driver(turn, context(claudeManifest('shared-vm-agent/3'), new AbortController().signal).value)
    .catch((error: unknown) => error)
  await first.frames.read()
  // The first turn's start holds the gate; the second waits for it.
  const waiting = bridge
    .driver(turn, context(claudeManifest('shared-vm-agent/3'), new AbortController().signal).value)
    .catch((error: unknown) => error)
  await delay(200)
  bridge.close()
  assert.ok((await waiting) instanceof SessionCapacityUnavailable)
  await holding
})

test('a greeting the coordinator refuses leaves the VM capacity as it was', async (t) => {
  const { root, port, bridge } = await bridgeFixture(t)
  await guest(t, root, port, { memoryBytes: 4 * 1024 ** 3 })
  await delay(200)
  assert.equal(bridge.turnCapacity(), 3)
  // An older tool supervisor without the turn policy is refused after it greets.
  const refused = await guest(t, root, port, { turnPolicy: false, memoryBytes: 2 * 1024 ** 3 })
  await once(refused.socket, 'close')
  assert.equal(bridge.turnCapacity(), 3)
})

test('a relay whose guests all fail before greeting is unavailable, not busy', async (t) => {
  const { port, bridge } = await bridgeFixture(t)
  const lane = await offer(t, port)
  const turnContext = context(claudeManifest('shared-vm-agent/3'), new AbortController().signal)
  const running = bridge.driver(turn, turnContext.value).catch((error: unknown) => error)
  while (lane.received() !== 'go\n') {
    await delay(25)
  }
  // The guest the relay starts never greets: a missing runner image, say.
  lane.socket.destroy()
  const error = await running
  assert.ok(
    error instanceof NativeSessionError && error.code === 'agent_vm_unavailable',
    String(error),
  )
})

test('a guest stopped while starting holds back the next start on the VM', async (t) => {
  const { port, bridge } = await bridgeFixture(t)
  const first = await offer(t, port)
  const control = new AbortController()
  const cancelled = bridge
    .driver(turn, context(claudeManifest('shared-vm-agent/3'), control.signal).value)
    .catch((error: unknown) => error)
  while (first.received() !== 'go\n') {
    await delay(25)
  }
  control.abort()
  await cancelled
  // Lanes are offered while the first guest may still be starting containers on the VM, which
  // the other provider's turns share too.
  for (const provider of ['claude', 'codex']) {
    const next = await offer(t, port, provider)
    const waiting = bridge
      .driver(
        turn,
        context(claudeManifest('shared-vm-agent/3', provider), new AbortController().signal).value,
      )
      .catch((error: unknown) => error)
    assert.ok((await waiting) instanceof SessionCapacityUnavailable, provider)
    assert.equal(next.received(), '', provider)
  }
})

test('a guest that never greets within the wait is unavailable, not busy', async (t) => {
  const { port, bridge } = await bridgeFixture(t)
  const lane = await offer(t, port)
  const turnContext = context(claudeManifest('shared-vm-agent/3'), new AbortController().signal)
  // The relay accepts go and keeps the connection open, but its guest never speaks.
  const error = await bridge.driver(turn, turnContext.value).catch((caught: unknown) => caught)
  assert.equal(lane.received(), 'go\n')
  assert.ok(
    error instanceof NativeSessionError && error.code === 'agent_vm_unavailable',
    String(error),
  )
})
