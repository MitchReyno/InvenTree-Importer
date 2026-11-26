import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { connect, type TLSSocket } from 'node:tls'
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
const TIMING = { toolWorkerPeerWaitMs: 1500, peerWaitMs: 1500 }

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

/** A paired guest connection that has greeted, as a relay lane's guest does. */
async function guest(t: TestContext, root: string, port: number) {
  const socket: TLSSocket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const frames = new Frames(socket)
  await frames.send(CLAUDE_TOOL_GUEST)
  return { socket, frames }
}

function claudeManifest(profile: 'shared-vm-agent/1' | 'shared-vm-agent/3') {
  return {
    profile_id: profile,
    agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
  } as unknown as SessionDriverContext['manifest']
}

const turn = {
  instructions: 'i',
  text: 't',
  tools: [],
  toolUrl: 'http://127.0.0.1:1',
  capability: 'c',
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
  // The first turn has the only connection once its command arrives.
  await peer.frames.read()

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
