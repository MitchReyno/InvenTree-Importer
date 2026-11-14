import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { journalTurn, recordedOutcome } from '#/agents/shared-vm/journal.ts'

test(
  'a replacement paired peer resolves a lost terminal ACK without a second provider start',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-probe-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: root, stdio: 'ignore' })
    ssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=Test CA',
      '-days',
      '1',
      '-keyout',
      'ca.key',
      '-out',
      'ca.pem',
    )
    for (const name of ['bench-coordinator', 'bench-guest']) {
      await mkdir(join(root, name))
      ssl(
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=' + name,
        '-keyout',
        name + '/key.pem',
        '-out',
        name + '.csr',
      )
      ssl(
        'x509',
        '-req',
        '-in',
        name + '.csr',
        '-CA',
        'ca.pem',
        '-CAkey',
        'ca.key',
        '-CAcreateserial',
        '-days',
        '1',
        '-out',
        name + '/cert.pem',
      )
      await copyFile(join(root, 'ca.pem'), join(root, name, 'ca.pem'))
    }
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
    const peer = async (terminalProbe = true) => {
      const socket = connect({
        ...(await pairing(join(root, 'bench-guest'))),
        port,
        host: '127.0.0.1',
        servername: 'bench-coordinator',
      })
      await once(socket, 'secureConnect')
      const frames = new Frames(socket)
      await frames.send({ ready: protocol, claudeSubscription: true, terminalProbe })
      return { socket, frames }
    }
    const first = await peer()
    const command = await first.frames.read()
    let starts = 0
    const path = join(root, 'journal')
    await journalTurn(path, command, async () => {
      starts++
      await first.frames.send({
        provider: { providerSessionId: 'fixture-session', actualModel: 'haiku' },
      })
      assert.equal((await first.frames.read()).ok, true)
      return 'done'
    })
    const legacy = await peer(false)
    t.after(() => legacy.socket.destroy())
    first.socket.destroy()
    const next = await peer()
    const probe = await next.frames.read()
    assert.deepEqual(probe, { inspectTerminal: command })
    await next.frames.send({ terminalOutcome: await recordedOutcome(path, command) })
    assert.equal(await session, 'finished')
    assert.equal(starts, 1)
    next.socket.destroy()
  },
)
