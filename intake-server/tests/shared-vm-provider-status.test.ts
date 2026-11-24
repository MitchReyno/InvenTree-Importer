import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { connect as connectNet } from 'node:net'
import { connect as connectTls, createServer as createTlsServer, type TLSSocket } from 'node:tls'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { pairedCertificates } from './support/vm-pairing.ts'
import { freePort } from './support/manual-process.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { CodexAccount } from '#/agents/shared-vm/codex-login.ts'
import { credentialPath, managementServer } from '#/agents/shared-vm/credential-http.ts'
import {
  credentialStore,
  readClaudeStatus,
  readClaudeToken,
} from '#/agents/shared-vm/claude-credential.ts'
import { claudeStatusReader, codexStatusReader } from '#/agents/shared-vm/credential-status.ts'
import {
  STATUS_PROTOCOL,
  serveProviderStatus,
  type GuestProviderStatus,
} from '#/agents/shared-vm/provider-status.ts'

const loginId = 'be8d5568-670e-4618-a98a-557c7c7862d0'
const device = {
  type: 'chatgptDeviceCode',
  loginId,
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
}
const token = 'sk-ant-oat01-provider-status-sentinel'

/** The pre-`credential_meta` guest image's store code, kept to test upgrade and rollback. */
function olderImageStore(directory: string) {
  const db = new DatabaseSync(join(directory, 'claude.sqlite'))
  db.exec(`PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS credential (
      id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, token TEXT
    );`)
  db.prepare('INSERT OR IGNORE INTO credential VALUES (1, ?, NULL)').run(randomUUID())
  return {
    revision: () =>
      String(db.prepare('SELECT revision FROM credential WHERE id=1').get()!.revision),
    change: (revision: string, value: string | null) =>
      db
        .prepare('UPDATE credential SET revision=?, token=? WHERE id=1 AND revision=?')
        .run(randomUUID(), value, revision).changes === 1,
    close: () => db.close(),
  }
}

async function scratch(t: TestContext, prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** A paired coordinator bridge, as the session worker runs it. */
async function coordinator(t: TestContext, root: string, timing?: StatusTiming) {
  await pairedCertificates(root)
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, undefined, timing)
  t.after(() => bridge.close())
  return { bridge, port }
}

type StatusTiming = Parameters<typeof startSessionBridge>[3]

/** The relay's byte pump: the status socket's bytes to the coordinator's listener and back. */
async function relayStatus(t: TestContext, socketPath: string, port: number) {
  const guest = connectNet(socketPath)
  await once(guest, 'connect')
  const host = connectNet(port, '127.0.0.1')
  await once(host, 'connect')
  guest.pipe(host).pipe(guest)
  const closed = Promise.all([once(guest, 'close'), once(host, 'close')])
  for (const socket of [guest, host]) {
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      guest.destroy()
      host.destroy()
    })
  }
  t.after(() => {
    guest.destroy()
    host.destroy()
  })
  return { guest, host, closed }
}

/** A credential process's status-only endpoint, in its own private socket directory. */
async function statusService(
  t: TestContext,
  root: string,
  provider: 'claude' | 'codex',
  read: (signal: AbortSignal) => Promise<GuestProviderStatus>,
  deadlineMs?: number,
) {
  const socketPath = join(root, provider + '-status', 'status.sock')
  const server = await serveProviderStatus({
    provider,
    pairing: await pairing(join(root, 'bench-guest')),
    socketPath,
    read,
    deadlineMs,
  })
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return socketPath
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 200; i++) {
    if (await check()) {
      return
    }
    await delay(10)
  }
  assert.fail('timed out waiting for ' + what)
}

/** A turn peer, as the relay's guest container greets the coordinator between turns. */
async function turnPeer(
  t: TestContext,
  root: string,
  port: number,
  greeting: Record<string, unknown>,
) {
  const socket = connectTls({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  await new Frames(socket).send({ ready: protocol, ...greeting })
  return socket
}

/** A status peer that answers each read as `answer` says, for coordinator-only checks. */
async function fakeStatusPeer(
  t: TestContext,
  root: string,
  port: number,
  provider: string,
  answer: (request: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>,
) {
  const socket = connectTls({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const frames = new Frames(socket)
  await frames.send({ ready: STATUS_PROTOCOL, provider })
  const closed = once(socket, 'close')
  void (async () => {
    for (;;) {
      const reply = await answer(await frames.read())
      if (reply) {
        await frames.send(reply)
      }
    }
  })().catch(() => socket.destroy())
  return { socket, closed }
}

test('the Claude save time is shown only for the revision the newer image recorded it for', async (t) => {
  const directory = await scratch(t, 'claude-meta-')
  const savedAt = new Date('2026-11-23T22:00:00.000Z')

  // A token saved by an older image has no recorded time.
  const older = olderImageStore(directory)
  assert.equal(older.change(older.revision(), token), true)
  older.close()
  const upgraded = credentialStore(directory, () => savedAt)
  assert.deepEqual(readClaudeStatus(directory), {
    configured: true,
    revision: upgraded.status().revision,
    saved_at: null,
  })

  // The newer image records the time in the same transaction as the change.
  assert.equal(upgraded.change(upgraded.status().revision, token + '-new'), true)
  const replaced = upgraded.status().revision
  assert.deepEqual(readClaudeStatus(directory), {
    configured: true,
    revision: replaced,
    saved_at: savedAt.toISOString(),
  })
  // A refused change records nothing.
  assert.equal(upgraded.change('stale-revision', null), false)
  assert.equal(readClaudeStatus(directory).saved_at, savedAt.toISOString())
  upgraded.close()

  // Rolled back, the older image opens the store and replaces the token.
  const rolledBack = olderImageStore(directory)
  assert.equal(rolledBack.revision(), replaced)
  assert.equal(rolledBack.change(replaced, token + '-older'), true)
  rolledBack.close()
  assert.equal(readClaudeToken(directory), token + '-older')

  // Upgraded again, the time recorded for an earlier revision is not shown.
  const reupgraded = credentialStore(directory, () => new Date('2026-11-24T01:00:00.000Z'))
  assert.equal(reupgraded.status().configured, true)
  assert.equal(readClaudeStatus(directory).saved_at, null)
  assert.equal(readClaudeToken(directory), token + '-older')
  reupgraded.close()

  // A removal on the older image reads as not saved after the next upgrade.
  const removal = olderImageStore(directory)
  assert.equal(removal.change(removal.revision(), null), true)
  removal.close()
  credentialStore(directory).close()
  assert.deepEqual(Object.keys(readClaudeStatus(directory)).sort(), [
    'configured',
    'revision',
    'saved_at',
  ])
  assert.equal(readClaudeStatus(directory).configured, false)
  assert.equal(readClaudeStatus(directory).saved_at, null)
})

test('a Claude status read is read-only and runs beside a turn reading the token', async (t) => {
  const directory = await scratch(t, 'claude-status-')
  const store = credentialStore(directory, () => new Date('2026-11-23T22:00:00.000Z'))
  t.after(() => store.close())
  assert.equal(readClaudeStatus(directory).configured, false)
  assert.equal(store.change(store.status().revision, token), true)
  // A turn holds its own read-only connection while the status is read.
  const turn = new DatabaseSync(join(directory, 'claude.sqlite'), { readOnly: true })
  t.after(() => turn.close())
  turn.exec('BEGIN')
  assert.equal(turn.prepare('SELECT token FROM credential WHERE id=1').get()!.token, token)
  const before = store.status().revision
  const status = readClaudeStatus(directory)
  turn.exec('COMMIT')
  assert.equal(status.configured, true)
  assert.equal(store.status().revision, before)
  assert.ok(!JSON.stringify(status).includes(token))
})

test('a Codex status read never cancels, completes or changes a sign-in', async (t) => {
  const root = await scratch(t, 'codex-status-read-')
  const when = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: when })
  const methods: string[] = []
  const locks: boolean[] = []
  let connected = false
  const rpc = {
    completion: undefined as Record<string, unknown> | undefined,
    initialize: async () => {},
    close: async () => {},
    connected: async () => {
      methods.push('account/read')
      return connected
    },
    request: async (method: string) => {
      methods.push(method)
      return device
    },
  }
  const account = new CodexAccount(root, (_root, _home, exclusive) => {
    locks.push(exclusive)
    return rpc
  })
  const signal = new AbortController().signal

  // Signed out, before any sign-in or turn.
  assert.equal(await account.readStatus(signal), 'signed_out')
  assert.equal(methods.length, 0)

  // Signing in, before any turn: read from the pending login, with no RPC on it.
  await account.action('start')
  methods.length = 0
  assert.equal(await account.readStatus(signal), 'signing_in')
  assert.equal(methods.length, 0)

  // Expired but not yet cancelled: still read as signing in, and left as it is.
  t.mock.timers.setTime(when + 16 * 60_000)
  rpc.completion = { loginId, success: true }
  connected = true
  assert.equal(await account.readStatus(signal), 'signing_in')
  assert.equal(methods.length, 0)
  const staging = (await readdir(root)).filter((name) => name.startsWith('login-'))
  assert.equal(staging.length, 1)
  assert.ok(!(await readdir(root)).includes('account'))
  await account.action('cancel', loginId)
  assert.ok(methods.includes('account/login/cancel'))

  // Signed in: one account read without a refresh, under the shared lock a turn also takes.
  await mkdir(join(root, 'account'))
  methods.length = 0
  locks.length = 0
  assert.equal(await account.readStatus(signal), 'signed_in')
  assert.deepEqual(methods, ['account/read'])
  assert.deepEqual(locks, [false])
})

test('a Codex status read is busy during a sign-in change, and never refuses one', async (t) => {
  const root = await scratch(t, 'codex-status-busy-')
  await mkdir(join(root, 'account'))
  let releaseAction!: () => void
  let releaseRead!: () => void
  let reads = 0
  const account = new CodexAccount(root, (_root, _home, exclusive) => ({
    initialize: async () => {
      if (exclusive) {
        await new Promise<void>((resolve) => (releaseAction = resolve))
      } else if (reads++ === 0) {
        await new Promise<void>((resolve) => (releaseRead = resolve))
      }
    },
    close: async () => {},
    connected: async () => true,
    request: async () => device,
  }))
  const signal = new AbortController().signal

  const disconnecting = account.action('disconnect')
  await waitFor(() => releaseAction !== undefined, 'the disconnect to start')
  assert.equal(await account.readStatus(signal), 'busy')
  releaseAction()
  await disconnecting.catch(() => {})

  // An operator action arriving during a read waits for it rather than failing.
  const reading = account.readStatus(signal)
  await waitFor(() => reads === 1, 'the read to start')
  const status = account.action('status')
  releaseRead()
  assert.equal(await reading, 'signed_in')
  assert.deepEqual(await status, { state: 'connected' })
})

test('an abandoned Codex read stops its account process', async (t) => {
  const root = await scratch(t, 'codex-status-abort-')
  await mkdir(join(root, 'account'))
  let closed = 0
  const account = new CodexAccount(root, () => ({
    initialize: async () => {},
    close: async () => {
      closed++
    },
    connected: () => new Promise<boolean>(() => {}),
    request: async () => device,
  }))
  const controller = new AbortController()
  const reading = account.readStatus(controller.signal)
  await delay(20)
  controller.abort()
  await assert.rejects(reading)
  assert.ok(closed >= 1)
})

test('the status endpoint answers only the paired coordinator, with no secret', async (t) => {
  const root = await scratch(t, 'status-endpoint-')
  const { bridge, port } = await coordinator(t, root)
  const directory = join(root, 'store')
  await mkdir(directory)
  const store = credentialStore(directory, () => new Date('2026-11-23T22:00:00.000Z'))
  t.after(() => store.close())
  assert.equal(store.change(store.status().revision, token), true)
  const socketPath = await statusService(t, root, 'claude', claudeStatusReader(directory))

  await relayStatus(t, socketPath, port)
  const status = await bridge.providerStatus()
  assert.deepEqual(status.claude, {
    state: 'saved',
    revision: store.status().revision,
    saved_at: '2026-11-23T22:00:00.000Z',
  })
  assert.ok(!JSON.stringify(status).includes(token))
  // The connection is kept for the next read.
  assert.deepEqual(await bridge.providerStatus(), status)

  // A server that isn't the paired coordinator gets no status, only a refused handshake.
  for (const identity of ['bench-guest', 'other-ca']) {
    const impostor = createTlsServer(
      identity === 'other-ca'
        ? { ...(await selfSigned(root)), requestCert: true, rejectUnauthorized: false }
        : {
            ...(await pairing(join(root, 'bench-guest'))),
            requestCert: true,
          },
    )
    const received: Buffer[] = []
    impostor.on('secureConnection', (socket: TLSSocket) => {
      socket.on('data', (data: Buffer) => received.push(data))
      socket.on('error', () => socket.destroy())
    })
    impostor.on('tlsClientError', () => {})
    impostor.listen(0, '127.0.0.1')
    await once(impostor, 'listening')
    t.after(() => impostor.close())
    const address = impostor.address()
    assert.ok(address && typeof address === 'object')
    const relayed = await relayStatus(t, socketPath, address.port)
    await relayed.closed
    assert.deepEqual(received, [], identity + ' received a status frame')
  }
})

test('the browser-facing management listener has no status-only path', async (t) => {
  const directory = await scratch(t, 'status-management-')
  const key = 'b'.repeat(64)
  const origin = 'https://personal.example'
  const server = managementServer(directory, origin, key)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port
  const headers = { origin, 'content-type': 'application/json' }
  for (const path of [credentialPath + '/status', '/personal-runner/status', '/status']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base + path, {
        method,
        headers,
        body: method === 'POST' ? '{"status":true}' : undefined,
      })
      assert.equal(response.status, 404, method + ' ' + path)
    }
  }
  // Its own status action still needs the management key.
  const unkeyed = await fetch(base + credentialPath, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'status' }),
  })
  assert.equal(unkeyed.status, 403)
})

test('each provider reads independently: one timing out leaves the other answered', async (t) => {
  const root = await scratch(t, 'status-independent-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 600, peerWaitMs: 100 })
  const claudeSocket = await statusService(t, root, 'claude', async () => ({
    provider: 'claude',
    state: 'not_saved',
    revision: randomUUID(),
  }))
  let codexAborted = false
  const codexSocket = await statusService(
    t,
    root,
    'codex',
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          codexAborted = true
          reject(signal.reason)
        })
      }),
    5000,
  )
  await relayStatus(t, claudeSocket, port)
  const codexRelay = await relayStatus(t, codexSocket, port)
  const started = Date.now()
  const status = await bridge.providerStatus()
  assert.ok(Date.now() - started < 1500)
  assert.equal(status.claude.state, 'not_saved')
  assert.deepEqual(status.codex, { state: 'unknown', reason: 'timeout' })
  // The coordinator abandons the read; the guest stops its work when the connection closes.
  await codexRelay.closed
  await waitFor(() => codexAborted, 'the guest to abandon its read')
})

test('the guest enforces its own deadline', async (t) => {
  const root = await scratch(t, 'status-guest-deadline-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 3000, peerWaitMs: 100 })
  let aborted = false
  const socketPath = await statusService(
    t,
    root,
    'codex',
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(signal.reason)
        })
      }),
    200,
  )
  await relayStatus(t, socketPath, port)
  const started = Date.now()
  const status = await bridge.providerStatus()
  assert.ok(Date.now() - started < 2000)
  assert.deepEqual(status.codex, { state: 'unknown', reason: 'timeout' })
  assert.equal(aborted, true)
})

test('older, missing, busy and unreachable guests read as unknown, never signed out', async (t) => {
  const root = await scratch(t, 'status-unknown-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 500, peerWaitMs: 50 })

  // Nothing paired is connected.
  assert.deepEqual(await bridge.providerStatus(), {
    claude: { state: 'unknown', reason: 'vm_unreachable' },
    codex: { state: 'unknown', reason: 'vm_unreachable' },
  })

  // A Codex guest image without the status capability, and a current Claude one whose
  // credential service has no status connection.
  await turnPeer(t, root, port, { codexSubscription: true })
  await turnPeer(t, root, port, { claudeSubscription: true, providerStatus: true })
  await waitFor(async () => {
    const status = await bridge.providerStatus()
    return status.codex.state === 'unknown' && status.codex.reason === 'guest_outdated'
  }, 'the older Codex guest')
  assert.deepEqual((await bridge.providerStatus()).claude, {
    state: 'unknown',
    reason: 'service_unavailable',
  })

  // A busy Codex service; and a Claude answer carrying a secret, which is refused.
  await fakeStatusPeer(t, root, port, 'codex', async () => ({
    provider_status: { provider: 'codex', state: 'busy' },
  }))
  const leaking = await fakeStatusPeer(t, root, port, 'claude', async () => ({
    provider_status: {
      provider: 'claude',
      state: 'saved',
      revision: randomUUID(),
      saved_at: null,
      token,
    },
  }))
  await waitFor(async () => {
    const status = await bridge.providerStatus()
    return status.codex.state === 'unknown' && status.codex.reason === 'busy'
  }, 'the busy Codex service')
  const status = await bridge.providerStatus()
  assert.ok(!JSON.stringify(status).includes(token))
  assert.equal(status.claude.state, 'unknown')
  await leaking.closed
})

test('a status read overlaps an active turn on the same provider', async (t) => {
  const root = await scratch(t, 'status-turn-')
  const { bridge, port } = await coordinator(t, root)
  const turn = await turnPeer(t, root, port, { codexSubscription: true, providerStatus: true })
  const codexRoot = join(root, 'codex-state')
  await mkdir(join(codexRoot, 'account'), { recursive: true })
  const account = new CodexAccount(codexRoot, (_root, _home, exclusive) => {
    // The turn holds the account lock shared; so does the read.
    assert.equal(exclusive, false)
    return {
      initialize: async () => {},
      close: async () => {},
      connected: async () => true,
      request: async () => device,
    }
  })
  const socketPath = await statusService(t, root, 'codex', codexStatusReader(account))
  await relayStatus(t, socketPath, port)
  // The turn peer stays connected, as during a turn; the status read doesn't wait for it.
  assert.deepEqual((await bridge.providerStatus()).codex, { state: 'signed_in' })
  assert.equal(turn.destroyed, false)
})

/** A certificate from another CA, for a server that is not the paired coordinator. */
async function selfSigned(root: string) {
  const other = join(root, 'other')
  await mkdir(other)
  await pairedCertificates(other)
  return pairing(join(other, 'bench-coordinator'))
}
