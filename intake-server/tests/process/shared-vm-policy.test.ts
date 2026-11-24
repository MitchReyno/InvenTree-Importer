import { createServer as httpServer } from 'node:http'
import { evidenceFormatHeader } from '#/agents/shared-vm/evidence-release.ts'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as netConnect, createServer, type AddressInfo, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { connect, type TLSSocket } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { processingFixture } from '../support/processing.ts'
import { freePort } from '../support/manual-process.ts'
import { pairedCertificates } from '../support/vm-pairing.ts'
import sharp from 'sharp'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { transaction } from '#/db/database.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { startMcpProxy } from '#/agents/shared-vm/mcp-proxy.ts'
import { lotSession, seedPhoto } from '../support/sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { sealed } from '#/processing/model.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { serveGuestTurn } from '#/agents/shared-vm/guest-turn.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'
import type { nativeTurn } from '#/agents/shared-vm/native-turn.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'

const protectedHosts = ['127.0.0.1', 'inventory.example.com']

/** One tool turn from a real coordinator to the real supervisor handler, with a fake provider. */
async function pairedToolTurn(
  t: TestContext,
  guest: (root: string) => { policyPath: string; runNative: typeof nativeTurn },
  setup?: (
    fixture: Awaited<ReturnType<typeof processingFixture>>,
    capture: Awaited<ReturnType<Awaited<ReturnType<typeof processingFixture>>['seedCapture']>>,
    job: string,
    root: string,
  ) => Promise<Awaited<ReturnType<typeof startSessionToolServer>>>,
) {
  const root = await mkdtemp(join(tmpdir(), 'bench-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  // Apart from the host runner's own sessions directory under the same root.
  const sessionsRoot = join(root, 'guest-sessions')
  await mkdir(join(root, 'reap'))
  await mkdir(join(root, 'policy'))
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  const { job, attempt } = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'shared-vm-agent/3',
      agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
      settingsRevision: '1',
    },
  })
  const toolServer = await setup?.(fixture, capture, job, root)
  if (toolServer) t.after(() => toolServer.close())
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
    protectedHosts,
    confirmEvidence: toolServer?.confirmEvidence,
  })
  t.after(() => bridge.close())
  const session = runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: toolServer?.url ?? 'http://127.0.0.1:1',
      drivers: { 'shared-vm-agent/3': bridge.driver },
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
  const failures = await fixture.db.pool.query<{ code: string }>(
    "SELECT diagnostic->>'code' AS code FROM agent_session_failure WHERE attempt_id=$1",
    [attempt],
  )
  return {
    outcome: recorded.split('\n')[1],
    result,
    sessionState: retained.session_state,
    slotHeld: retained.slots !== '0',
    failureCodes: failures.rows.map((row) => row.code),
  }
}

test(
  'only a released VM fetch permits a subsequent proposal through the coordinator',
  { timeout: 60000 },
  async (t) => {
    let evidence: { evidence_id: string; version_id: string }
    let subject: string
    const original = await sharp({
      create: { width: 24, height: 12, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
    const preview = await sharp(original).png({ compressionLevel: 9 }).toBuffer()
    const { outcome } = await pairedToolTurn(
      t,
      (root) => ({
        policyPath: join(root, 'policy', 'policy.json'),
        runNative: async (_context, _opening, request) => {
          await request({ provider: { providerSessionId: randomUUID(), actualModel: 'haiku' } })
          let id = 0
          const provider = new EventEmitter()
          const prepared = once(provider, 'prepared')
          const disconnected = once(provider, 'disconnected')
          let loseResponse = true
          let proxy = await startMcpProxy(
            async (operation) => {
              const reply = await request(operation)
              if (loseResponse && operation.mcp) {
                loseResponse = false
                provider.emit('prepared')
                await disconnected
              }
              return reply
            },
            true,
            'file',
          )
          const call = async (name: string, args: unknown) => {
            const response = await fetch(proxy.toolUrl, {
              method: 'POST',
              headers: { authorization: 'Bearer ' + proxy.capability },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: ++id,
                method: 'tools/call',
                params: { name, arguments: args },
              }),
            })
            assert.equal(response.status, 200)
            return (await response.json()).result
          }
          const source = {
            kind: 'media_version',
            ...evidence,
            sha256: createHash('sha256').update(original).digest('hex'),
          }
          const propose = async () =>
            (
              await call('propose', {
                proposal: {
                  schema_version: 'bench-intake-proposal/5',
                  subject_id: subject,
                  summary: 'Observed quantity',
                  sources: [source],
                  quantity: { value: '20', status: 'estimated' },
                  relies_on: { fields: ['quantity'], sources: [source] },
                },
              })
            ).structuredContent
          try {
            const failed = assert.rejects(call('fetch_evidence', evidence))
            await prepared
            await proxy.close()
            await failed
            proxy = await startMcpProxy(request, true, 'file')
            provider.emit('disconnected')
            assert.equal((await propose()).error, 'source_not_delivered')
            const result = await call('fetch_evidence', evidence)
            assert.deepEqual(await readFile(result.structuredContent.local_file.path), original)
            assert.equal((await propose()).ok, true)
          } finally {
            provider.emit('disconnected')
            await proxy.close()
          }
        },
      }),
      async (fixture, capture, job, root) => {
        const store = await BlobStore.initialize(
          join(await realpath(root), 'blobs'),
          await readMediaStoreIdentity(fixture.db.pool),
        )
        await transaction(fixture.db.pool, async (client) => {
          await store.publish(client, original)
          await store.publish(client, preview)
        })
        const photo = await seedPhoto(
          fixture,
          capture.batch.id,
          { width: 24, height: 12 },
          'Test photo',
          0,
          { original, preview },
        )
        subject = capture.packetA.id
        evidence = { evidence_id: photo.evidence, version_id: photo.version }
        await fixture.db.pool.query(
          "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
          [randomUUID(), job, evidence, photo.version],
        )
        return startSessionToolServer({
          pool: fixture.runner.pool,
          config: fixture.config,
          store,
          evidenceImage: 'original',
        })
      },
    )
    assert.equal(outcome, 'done')
  },
)

test(
  'only explicitly legacy preview bytes can omit a rendition digest across a paired bridge',
  { timeout: 60000 },
  async (t) => {
    let format = 'current'
    let grants = 0
    const bytes = Buffer.from('preview')
    const version = randomUUID()
    const { outcome } = await pairedToolTurn(
      t,
      (root) => ({
        policyPath: join(root, 'policy', 'policy.json'),
        runNative: async (_context, _opening, request) => {
          const proxy = await startMcpProxy(request, true, 'file')
          try {
            const fetchPhoto = () =>
              fetch(proxy.toolUrl, {
                method: 'POST',
                headers: { authorization: 'Bearer ' + proxy.capability },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'tools/call',
                  params: { name: 'fetch_evidence', arguments: {} },
                }),
              })
            assert.equal((await fetchPhoto()).status, 502)
            assert.equal(grants, 0)
            format = 'legacy'
            const response = await fetchPhoto()
            assert.equal(response.status, 200)
            const result = (await response.json()).result
            assert.deepEqual(await readFile(result.structuredContent.local_file.path), bytes)
            await proxy.flush()
          } finally {
            await proxy.close()
          }
        },
      }),
      async () => {
        const encoder = httpServer((req, res) => {
          req.resume()
          res
            .writeHead(200, { 'content-type': 'application/json', [evidenceFormatHeader]: format })
            .end(
              JSON.stringify({
                id: 1,
                result: {
                  structuredContent: {
                    ok: true,
                    source: { kind: 'media_version', version_id: version, sha256: '0'.repeat(64) },
                    pages: [{ page: 1, width: 1, height: 1 }],
                  },
                  content: [
                    { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') },
                  ],
                },
              }),
            )
        })
        encoder.listen(0, '127.0.0.1')
        await once(encoder, 'listening')
        return {
          url: 'http://127.0.0.1:' + (encoder.address() as AddressInfo).port + '/mcp',
          confirmEvidence: (_job, v) => {
            assert.equal(v, version)
            grants++
          },
          close: async () => {
            encoder.close()
          },
        }
      },
    )
    assert.equal(outcome, 'done')
    assert.equal(grants, 1)
  },
)

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
  'a tool-policy refusal in the VM keeps its code through the journal and the coordinator',
  { timeout: 60000 },
  async (t) => {
    for (const code of ['agent_tool_refused', 'agent_policy_refused']) {
      await t.test(code, async (t) => {
        const { outcome, result, failureCodes } = await pairedToolTurn(t, (root) => ({
          policyPath: join(root, 'policy', 'policy.json'),
          runNative: async () => {
            throw new NativeSessionError(code)
          },
        }))
        assert.equal(outcome, code)
        assert.equal(result, 'failed')
        assert.deepEqual(failureCodes, [code])
      })
    }
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
  'a bridge started without protected hosts refuses tool turns',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-no-hosts-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await pairedCertificates(root)
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const bridge = await startSessionBridge(join(root, 'bench-coordinator'), await freePort())
    t.after(() => bridge.close())
    const capture = await fixture.seedCapture()
    const { attempt } = await lotSession(fixture, capture, capture.packetA, {
      state: 'queued',
      profile: {
        id: 'shared-vm-agent/3',
        agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
        settingsRevision: '1',
      },
    })
    const result = await runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
        toolUrl: 'http://127.0.0.1:1',
        drivers: { 'shared-vm-agent/3': bridge.driver },
      },
      attempt,
      AbortSignal.timeout(30000),
    )
    const {
      rows: [retained],
    } = await fixture.db.pool.query<{ session_state: string; slots: string }>(
      `SELECT s.session_state, (SELECT count(*) FROM agent_slot WHERE attempt_id = $1) AS slots
         FROM agent_session s WHERE s.attempt_id = $1`,
      [attempt],
    )
    assert.equal(result, 'failed')
    assert.equal(retained.session_state, 'failed')
    assert.equal(retained.slots, '0')
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
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
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
        id: 'shared-vm-agent/3',
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
        drivers: { 'shared-vm-agent/3': bridge.driver },
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
  'a malformed opening is refused before the supervisor writes anything',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bench-bad-opening-'))
    t.after(() => rm(root, { recursive: true, force: true }))
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
    const {
      rows: [retained],
    } = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
      `SELECT i.manifest_bytes, i.manifest_digest
         FROM processing_attempt a JOIN processing_input i ON i.id = a.input_id
        WHERE a.id = $1`,
      [attempt],
    )
    const manifest = decodeSessionInput(retained.manifest_bytes, retained.manifest_digest)
    const valid = { text: 'Lot packet A', instructions: '', tools: [] }
    for (const [label, opening] of [
      ['text that is not a string', { ...valid, text: 42 }],
      ['a resume that is not a string', { ...valid, resume: 42 }],
      ['an empty resume', { ...valid, resume: '' }],
      ['missing evidence confirmation', { ...valid, evidenceRelease: undefined }],
    ] as const) {
      await t.test(label, async (t) => {
        const turnRoot = join(root, label.replaceAll(' ', '-'))
        const sessionsRoot = join(turnRoot, 'guest-sessions')
        await mkdir(join(turnRoot, 'reap'), { recursive: true })
        await mkdir(join(turnRoot, 'policy'))
        // The coordinator end of a plain local connection, sending a command it would never build.
        const listener = createServer()
        listener.listen(0, '127.0.0.1')
        await once(listener, 'listening')
        t.after(() => listener.close())
        const accepted = once(listener, 'connection')
        const guest = netConnect((listener.address() as AddressInfo).port, '127.0.0.1')
        t.after(() => guest.destroy())
        const [coordinator] = (await accepted) as [Socket]
        t.after(() => coordinator.destroy())
        const frames = new Frames(coordinator)
        const coordinatorSide = (async () => {
          await frames.read()
          await frames.send({
            protocol,
            lineage: randomUUID(),
            attemptId: attempt,
            turn: '1',
            manifest,
            protected_hosts: [],
            evidenceRelease: 1,
            ...opening,
          })
        })()
        let starts = 0
        await assert.rejects(
          serveGuestTurn(guest as unknown as TLSSocket, {
            provider: 'claude',
            isolated: true,
            reapProof: true,
            sessionsRoot,
            reapPath: join(turnRoot, 'reap', 'turn'),
            policyPath: join(turnRoot, 'policy', 'policy.json'),
            runNative: async () => {
              starts++
            },
          }),
          label === 'missing evidence confirmation'
            ? /runner_evidence_release_unsupported/
            : /invalid_opening/,
        )
        await coordinatorSide
        assert.equal(starts, 0)
        assert.deepEqual(await readdir(join(turnRoot, 'policy')), [])
        assert.deepEqual(await readdir(join(turnRoot, 'reap')), [])
        assert.equal(await readdir(sessionsRoot).catch(() => 'absent'), 'absent')
      })
    }
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
    for (const turnPolicy of [undefined, true]) {
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
        turnPolicy,
        evidenceFiles: true,
        claudeSubscription: true,
      })
      await once(socket, 'close')
      assert.deepEqual(received, [])
    }
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
  prepare: (
    root: string,
    t: TestContext,
    fixture: Awaited<ReturnType<typeof processingFixture>>,
  ) => Promise<Record<string, string>>
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
    label: 'whose pairing CA is not a certificate',
    code: 'session_agent_startup_refused',
    prepare: async (root) => {
      await pairedCertificates(root)
      await writeFile(join(root, 'bench-coordinator', 'ca.pem'), 'not a certificate\n')
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
      }
    },
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
  {
    label: 'whose scheduler database has no user',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: 'postgres://127.0.0.1:5432/dbos',
      }
    },
  },
  {
    label: 'whose scheduler database port is out of range',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: 'postgres://dbos@127.0.0.1/dbos?port=65536',
      }
    },
  },
  {
    label: 'whose scheduler database name decodes to a NUL',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: 'postgres://dbos@127.0.0.1:5432/%00',
      }
    },
  },
  {
    label: 'whose scheduler database options decode to a NUL',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL:
          'postgres://dbos@127.0.0.1:5432/dbos?application_name=bench%00intake',
      }
    },
  },
  {
    label: 'whose scheduler database authority is a socket path',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL:
          'postgres://dbos@%2Ffixture/scheduler_db?host=127.0.0.1',
      }
    },
  },
  {
    label: 'whose scheduler database name is longer than DBOS allows',
    code: 'local_agent_database_required',
    prepare: async (root) => {
      await pairedCertificates(root)
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: `postgres://bench@127.0.0.1/${'s'.repeat(64)}`,
      }
    },
  },
  {
    label: 'whose scheduler database rejects its credentials',
    code: 'session_agent_startup_refused',
    prepare: async (root, _t, fixture) => {
      await pairedCertificates(root)
      const rejected = new URL(fixture.scheduler.url)
      rejected.password = 'not-the-password'
      return {
        INTAKE_AGENT_PROTECTED_ORIGINS: validOrigins,
        INTAKE_VM_PAIR: join(root, 'bench-coordinator'),
        INTAKE_AGENT_SCHEDULER_DATABASE_URL: rejected.toString(),
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
      // Settles once the worker exits or fails to start, whichever comes first.
      let finished: Promise<{ code: number | null } | { error: Error }> | undefined
      let root: string | undefined
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
      // One ordered teardown: the worker is reaped before its database is dropped.
      t.after(async () => {
        if (worker && finished && worker.exitCode === null && worker.signalCode === null) {
          worker.kill('SIGKILL')
          const reaped = await Promise.race([
            finished,
            delay(WORKER_EXIT_TIMEOUT_MS).then(() => undefined),
          ])
          // An unreaped worker keeps its database: dropping it under a live child is worse.
          assert.ok(reaped, 'the worker was not reaped after SIGKILL')
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
          id: 'shared-vm-agent/3',
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
      const overrides = await misconfiguration.prepare(root, t, fixture)
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
            INTAKE_PROCESSING_PROFILE: 'shared-vm-agent/3',
            ...overrides,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      worker = spawned
      finished = new Promise((resolve) => {
        spawned.once('exit', (code) => resolve({ code }))
        spawned.once('error', (error) => resolve({ error }))
      })
      let output = ''
      spawned.stderr.on('data', (bytes: Buffer) => (output += bytes.toString()))
      const outcome = await Promise.race([
        finished,
        delay(WORKER_EXIT_TIMEOUT_MS).then(() => 'still running' as const),
      ])
      assert.notEqual(outcome, 'still running', 'the worker did not refuse within its deadline')
      assert.ok(typeof outcome === 'object' && 'code' in outcome, 'the worker did not start')
      assert.equal(outcome.code, 1)
      assert.match(output, new RegExp(`"code":"${misconfiguration.code}"`))
      assert.equal(before, 'running')
      assert.equal(await stateOf(), before)
    },
  )
}

test('retained session inputs decode with and without sealed web settings', async (t) => {
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
