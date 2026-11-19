import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { validate, type ProcessingInputV6Dto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { turnPolicy } from '#/agents/shared-vm/turn-policy.ts'

test(
  'a tool turn command carries the protected hosts and a manifest the supervisor turns into a policy',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-policy-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
    t.after(() => fixture.dispose())
    const port = await freePort()
    const protectedHosts = ['127.0.0.1', 'inventory.example.com']
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
    const frames = new Frames(socket)
    await frames.send({
      ready: protocol,
      reapProof: true,
      terminalProbe: true,
      builtinTools: true,
      evidenceFiles: true,
      claudeSubscription: true,
    })
    const command = await frames.read()
    assert.deepEqual(command.protected_hosts, protectedHosts)
    // The supervisor's own checks, on the bytes the coordinator actually sent.
    validate('ProcessingInputV6', command.manifest)
    const manifest = command.manifest as ProcessingInputV6Dto
    assert.equal(manifest.web, undefined)
    assert.deepEqual(turnPolicy(manifest, command.protected_hosts), {
      version: 1,
      public_pages: false,
      protected_hosts: protectedHosts,
    })
    const sealedWeb = { ...manifest, web: { public_pages: true, prefer_datasheets: true } }
    validate('ProcessingInputV6', sealedWeb)
    assert.equal(turnPolicy(sealedWeb, command.protected_hosts).public_pages, false)
    await frames.send({ failure: 'agent_turn_failed' })
    socket.end()
    await session.catch(() => undefined)
  },
)
