import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
import { startSessionBridge, type BridgeProviderStatuses } from '#/agents/shared-vm/coordinator.ts'
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
  type StatusReader,
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
  read: StatusReader,
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

async function waitFor(check: () => boolean | Promise<boolean>, what: string, withinMs = 2000) {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
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
  socket.on('error', () => socket.destroy())
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

/** A fake account RPC whose `account/read` waits until the test releases it. */
function heldAccountRpc() {
  const held = {
    starts: 0,
    closes: 0,
    locks: [] as boolean[],
    connected: true,
    releases: [] as (() => void)[],
    release() {
      for (const release of held.releases.splice(0)) {
        release()
      }
    },
    factory: (_root: string, _home: string, exclusive: boolean) => {
      held.locks.push(exclusive)
      if (!exclusive) {
        held.starts++
      }
      return {
        initialize: async () => {},
        close: async () => {
          held.closes++
        },
        connected: () => {
          if (exclusive) {
            return Promise.resolve(held.connected)
          }
          return new Promise<boolean>((resolve) => {
            held.releases.push(() => resolve(held.connected))
          })
        },
        request: async () => device,
      }
    },
  }
  return held
}

/** Reads until the check in progress has finished, without asking for another one. */
async function checked(account: CodexAccount) {
  let status = await account.readStatus()
  await waitFor(
    async () => {
      status = await account.readStatus()
      return status.state !== 'checking'
    },
    'the Codex check',
    10_000,
  )
  return status
}

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

  // Signed out, before any sign-in or turn: no account to check, so no account process.
  assert.deepEqual(await account.readStatus(), { state: 'signed_out', checkedAt: when })
  assert.equal(methods.length, 0)

  // Signing in, before any turn: read from the pending login, with no RPC on it.
  await account.action('start')
  methods.length = 0
  assert.deepEqual(await account.readStatus(true), { state: 'signing_in', checkedAt: when })
  assert.equal(methods.length, 0)

  // Expired but not yet cancelled: still read as signing in, and left as it is.
  t.mock.timers.setTime(when + 16 * 60_000)
  rpc.completion = { loginId, success: true }
  connected = true
  assert.equal((await account.readStatus()).state, 'signing_in')
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
  assert.deepEqual(await checked(account), {
    state: 'signed_in',
    checkedAt: when + 16 * 60_000,
  })
  assert.deepEqual(methods, ['account/read'])
  assert.deepEqual(locks, [false])
})

test('reads arriving together share one Codex check, and a stale result is kept while it is redone', async (t) => {
  const root = await scratch(t, 'codex-status-shared-')
  await mkdir(join(root, 'account'))
  const held = heldAccountRpc()
  const account = new CodexAccount(root, held.factory, { freshMs: 200, minRefreshIntervalMs: 0 })

  // The first reads have no result yet: they say so at once, and start one check between them.
  const first = await Promise.all([1, 2, 3, 4, 5].map(() => account.readStatus()))
  assert.deepEqual(new Set(first.map((status) => status.state)), new Set(['checking']))
  await waitFor(() => held.releases.length === 1, 'the first check')
  assert.equal(held.starts, 1)
  held.release()
  const result = await checked(account)
  assert.equal(result.state, 'signed_in')

  // Still fresh: answered from the last check, with no new one.
  assert.deepEqual(await account.readStatus(), result)
  assert.equal(held.starts, 1)

  // Stale: still answered from the last check, while one new check runs.
  await delay(250)
  const stale = await Promise.all([1, 2, 3].map(() => account.readStatus()))
  assert.deepEqual(stale, [result, result, result])
  await waitFor(() => held.releases.length === 1, 'the second check')
  assert.equal(held.starts, 2)
  held.connected = false
  held.release()
  await waitFor(async () => (await account.readStatus()).state === 'signed_out', 'the new result')
  const redone = await account.readStatus()
  assert.ok(redone.state === 'signed_out' && redone.checkedAt > (result as typeof redone).checkedAt)
})

test('a stale Codex result whose check keeps failing is checked again only at the interval', async (t) => {
  const root = await scratch(t, 'codex-status-failing-')
  await mkdir(join(root, 'account'))
  let starts = 0
  let failing = false
  const account = new CodexAccount(
    root,
    () => {
      starts++
      return {
        initialize: async () => {},
        close: async () => {},
        connected: async () => {
          if (failing) {
            throw new Error('codex_account_unavailable')
          }
          return true
        },
        request: async () => device,
      }
    },
    { freshMs: 0, minRefreshIntervalMs: 300 },
  )
  const result = await checked(account)
  assert.equal(result.state, 'signed_in')
  failing = true
  await delay(320)
  // Always stale: the first read starts one check, which fails and keeps the result.
  assert.deepEqual(await account.readStatus(), result)
  await waitFor(() => starts === 2, 'the failing check')
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(await account.readStatus(), result)
    await delay(10)
  }
  assert.equal(starts, 2)
  await delay(320)
  await account.readStatus()
  assert.equal(starts, 3)
})

test('Check again starts a fresh Codex check, at most once per interval, and answers at once', async (t) => {
  const root = await scratch(t, 'codex-status-forced-')
  await mkdir(join(root, 'account'))
  const held = heldAccountRpc()
  const account = new CodexAccount(root, held.factory, { minRefreshIntervalMs: 300 })
  void account.readStatus()
  await waitFor(() => held.releases.length === 1, 'the first check')
  held.release()
  const result = await checked(account)

  // Within the interval of the last check's start, Check again starts nothing.
  assert.deepEqual(await account.readStatus(true), result)
  assert.equal(held.starts, 1)

  // After it, one forced check starts; the answer is still the last result.
  await delay(320)
  const forced = await Promise.all([account.readStatus(true), account.readStatus(true)])
  assert.deepEqual(forced, [result, result])
  await waitFor(() => held.releases.length === 1, 'the forced check')
  assert.equal(held.starts, 2)
  held.release()
  await waitFor(async () => {
    const status = await account.readStatus()
    return status.state === 'signed_in' && status.checkedAt > (result as typeof status).checkedAt
  }, 'the forced result')
  assert.equal(held.starts, 2)
})

test('a sign-in change forgets the last Codex check, and stops a check rather than wait for it', async (t) => {
  const root = await scratch(t, 'codex-status-change-')
  await mkdir(join(root, 'account'))
  const held = heldAccountRpc()
  const account = new CodexAccount(root, held.factory, { refreshTimeoutMs: 60_000 })
  void account.readStatus()
  await waitFor(() => held.releases.length === 1, 'the first check')
  held.release()
  assert.equal((await checked(account)).state, 'signed_in')

  // An operator status read changes nothing, so the result is kept.
  const result = await account.readStatus()
  const statusAction = account.action('status')
  await waitFor(() => held.releases.length === 1, 'the operator status read')
  held.release()
  assert.deepEqual(await statusAction, { state: 'connected' })
  assert.deepEqual(await account.readStatus(), result)

  // Signed out and in again: the next read checks again instead of reusing signed in.
  held.connected = false
  assert.deepEqual(await account.action('disconnect'), { state: 'disconnected' })
  assert.equal((await account.readStatus()).state, 'signed_out')
  await mkdir(join(root, 'account'))
  held.connected = true
  assert.deepEqual(await account.readStatus(), { state: 'checking' })
  await waitFor(() => held.releases.length === 1, 'the check after the change')

  // A sign-out while that check hangs stops it, at once, and its result is never reported.
  const closes = held.closes
  const started = Date.now()
  held.connected = false
  assert.deepEqual(await account.action('disconnect'), { state: 'disconnected' })
  assert.ok(Date.now() - started < 1000)
  assert.ok(held.closes > closes)
  held.connected = true
  held.release()
  assert.equal((await account.readStatus()).state, 'signed_out')
})

test('a Codex status read is busy during a sign-in change, and never refuses one', async (t) => {
  const root = await scratch(t, 'codex-status-busy-')
  await mkdir(join(root, 'account'))
  let releaseAction!: () => void
  const account = new CodexAccount(root, (_root, _home, exclusive) => ({
    initialize: async () => {
      if (exclusive) {
        await new Promise<void>((resolve) => (releaseAction = resolve))
      }
    },
    close: async () => {},
    connected: async () => true,
    request: async () => device,
  }))

  const disconnecting = account.action('disconnect')
  await waitFor(() => releaseAction !== undefined, 'the disconnect to start')
  assert.deepEqual(await account.readStatus(true), { state: 'busy' })
  releaseAction()
  await disconnecting.catch(() => {})

  // An operator action arriving during a check runs rather than failing.
  await mkdir(join(root, 'account'), { recursive: true })
  void account.readStatus()
  assert.deepEqual(await account.action('status'), { state: 'connected' })
})

// Stand-ins for `flock` and the Codex app-server, so the real account RPC runs: the lock mode
// and every request are logged, and `account/read` can be made to hang.
const FAKE_FLOCK = `#!/bin/sh
[ "$1" = -n ] && shift
[ "$1" = -F ] && shift
printf '%s\\n' "$1" >> "$CODEX_HOME/../fake.log"
shift 2
exec "$@"
`
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require('node:fs')
// The account process gets a fixed environment: its log and hang switch sit beside its home.
const log = (line) => appendFileSync(process.env.CODEX_HOME + '/../fake.log', line + '\\n')
const hang = existsSync(process.env.CODEX_HOME + '/../hang')
log('started ' + process.pid)
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (message.method) {
      log(message.method + ' ' + JSON.stringify(message.params ?? null))
    }
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'bench_intake/0.166.0' } }) + '\\n')
    }
    if (message.method === 'account/read' && !hang) {
      process.stdout.write(JSON.stringify({ id: message.id, result: { account: { type: 'chatgpt', email: 'operator@example.com', planType: 'plus' } } }) + '\\n')
    }
  }
})
`

/** Puts the fake `flock` and `codex` on PATH for this test; `codexText` may replace the app-server. */
async function fakeCodexBin(t: TestContext, root: string, codexText = FAKE_CODEX) {
  const bin = join(root, 'bin')
  await mkdir(bin)
  for (const [name, text] of [
    ['flock', FAKE_FLOCK],
    ['codex', codexText],
  ]) {
    await writeFile(join(bin, name), text)
    await chmod(join(bin, name), 0o755)
  }
  const savedPath = process.env.PATH
  process.env.PATH = bin + ':' + process.env.PATH
  t.after(() => {
    process.env.PATH = savedPath
  })
}

async function pidsStarted(log: string) {
  const text = await readFile(log, 'utf8')
  return [...text.matchAll(/started (\d+)/g)].map((match) => Number(match[1]))
}

function gone(pid: number) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

test('the real Codex account RPC reads without a refresh, shared, and a check past its timeout is reaped', async (t) => {
  const root = await scratch(t, 'codex-status-rpc-')
  await fakeCodexBin(t, root)
  const state = join(root, 'state')
  await mkdir(join(state, 'account'), { recursive: true })
  const log = join(state, 'fake.log')
  await writeFile(log, '')
  // Long enough for the fake app-server to start under load.
  const account = new CodexAccount(state, undefined, {
    refreshTimeoutMs: 3000,
    minRefreshIntervalMs: 0,
  })
  const status = await checked(account)
  assert.equal(status.state, 'signed_in')
  const lines = (await readFile(log, 'utf8')).trim().split('\n')
  assert.equal(lines[0], '-s')
  assert.ok(lines.includes('account/read {"refreshToken":false}'))
  assert.deepEqual(
    lines.filter((line) => line.startsWith('account/') && !line.startsWith('account/read')),
    [],
  )
  assert.ok(!JSON.stringify(status).includes('operator@example.com'))

  // A forced check that hangs is stopped at its timeout, and its process is gone; the last
  // result stays, with the time it was checked.
  await writeFile(join(state, 'hang'), '')
  await writeFile(log, '')
  assert.deepEqual(await account.readStatus(true), status)
  await waitFor(async () => (await readFile(log, 'utf8')).includes('account/read'), 'the hang')
  const [pid] = await pidsStarted(log)
  await waitFor(() => gone(pid), 'the hanging check to be reaped', 10_000)
  assert.deepEqual(await account.readStatus(), status)
})

// The account process ignores SIGTERM, so stopping it needs the SIGKILL that follows.
const STUBBORN_CODEX_LINE = "process.on('SIGTERM', () => {})"

test('a first Codex check that times out reads as unknown, its stubborn process killed', async (t) => {
  const root = await scratch(t, 'codex-status-kill-')
  await fakeCodexBin(
    t,
    root,
    FAKE_CODEX.replace("let buffer = ''", STUBBORN_CODEX_LINE + "\nlet buffer = ''"),
  )
  const state = join(root, 'state')
  await mkdir(join(state, 'account'), { recursive: true })
  await writeFile(join(state, 'hang'), '')
  const log = join(state, 'fake.log')
  await writeFile(log, '')
  const account = new CodexAccount(state, undefined, {
    refreshTimeoutMs: 3000,
    minRefreshIntervalMs: 60_000,
  })
  assert.deepEqual(await account.readStatus(), { state: 'checking' })
  assert.deepEqual(await checked(account), { state: 'timeout' })
  const pids = await pidsStarted(log)
  assert.equal(pids.length, 1)
  assert.ok(gone(pids[0]))
  // A failed check is retried only after the interval, so repeated reads start nothing.
  assert.deepEqual(await account.readStatus(true), { state: 'timeout' })
  assert.equal((await pidsStarted(log)).length, 1)
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
  assert.ok(status.claude.state === 'saved')
  assert.deepEqual(status.claude, {
    state: 'saved',
    revision: store.status().revision,
    saved_at: '2026-11-23T22:00:00.000Z',
    checked_at: status.claude.checked_at,
  })
  assert.ok(!JSON.stringify(status).includes(token))
  // The connection is kept for the next read.
  assert.equal((await bridge.providerStatus()).claude.state, 'saved')

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

test('each provider reads independently: one not answering leaves the other answered', async (t) => {
  const root = await scratch(t, 'status-independent-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 1000, peerWaitMs: 100 })
  const claudeSocket = await statusService(t, root, 'claude', async () => ({
    provider: 'claude',
    state: 'not_saved',
    revision: randomUUID(),
  }))
  await relayStatus(t, claudeSocket, port)
  // Codex's credential process takes the request and never answers.
  const silent = await fakeStatusPeer(t, root, port, 'codex', async () => undefined)
  const started = Date.now()
  const status = await bridge.providerStatus()
  assert.ok(Date.now() - started < 1500)
  assert.equal(status.claude.state, 'not_saved')
  assert.deepEqual(status.codex, { state: 'unknown', reason: 'timeout' })
  // The coordinator abandons it by closing the connection, which ends the guest's work on it.
  await silent.closed
})

test('the guest reports a timeout only once its work is cleaned up', async (t) => {
  const root = await scratch(t, 'status-guest-deadline-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 3000, peerWaitMs: 100 })
  let cleanedAt = 0
  let reads = 0
  let reap = 80
  const socketPath = await statusService(
    t,
    root,
    'codex',
    (signal) => {
      reads++
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          // Stopping and reaping the account process takes a moment.
          setTimeout(() => {
            cleanedAt = Date.now()
            reject(signal.reason)
          }, reap)
        })
      })
    },
    900,
  )
  const relayed = await relayStatus(t, socketPath, port)
  const started = Date.now()
  const status = await bridge.providerStatus()
  const answeredAt = Date.now()
  assert.ok(answeredAt - started < 2000)
  assert.deepEqual(status.codex, { state: 'unknown', reason: 'timeout' })
  assert.ok(cleanedAt > 0 && cleanedAt <= answeredAt)

  // A budget too short to leave room for cleanup starts no read at all.
  const before = reads
  assert.deepEqual((await bridge.providerStatus(250)).codex, {
    state: 'unknown',
    reason: 'timeout',
  })
  assert.equal(reads, before)

  // Cleanup that isn't confirmed in time closes the connection without an answer.
  reap = 5000
  assert.equal((await bridge.providerStatus()).codex.state, 'unknown')
  await relayed.closed
})

/** Reads through the coordinator until Codex's check in progress has finished. */
async function checkedThrough(bridge: { providerStatus: () => Promise<BridgeProviderStatuses> }) {
  for (let i = 0; i < 40; i++) {
    const status = await bridge.providerStatus()
    if (status.codex.state !== 'unknown' || status.codex.reason !== 'checking') {
      return status
    }
    await delay(250)
  }
  assert.fail('timed out waiting for the Codex check')
}

test('a Codex check slower than the request answers checking at once, then the result with its time', async (t) => {
  const root = await scratch(t, 'status-slow-codex-')
  const { bridge, port } = await coordinator(t, root)
  const codexRoot = join(root, 'codex-state')
  await mkdir(join(codexRoot, 'account'), { recursive: true })
  // Longer than the whole request budget, as `account/read` was on the real VM.
  const account = new CodexAccount(codexRoot, () => ({
    initialize: async () => {},
    close: async () => {},
    connected: () => delay(3000).then(() => true),
    request: async () => device,
  }))
  const socketPath = await statusService(t, root, 'codex', codexStatusReader(account))
  await relayStatus(t, socketPath, port)

  const started = Date.now()
  const first = await bridge.providerStatus()
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`)
  assert.deepEqual(first.codex, { state: 'unknown', reason: 'checking' })

  const later = await checkedThrough(bridge)
  assert.equal(later.codex.state, 'signed_in')
  const checkedAt = Date.parse((later.codex as { checked_at: string }).checked_at)
  assert.ok(checkedAt >= started + 2900 && checkedAt <= Date.now())
})

test('Check again reaches the Codex guest, and its answer says how old its check is', async (t) => {
  const root = await scratch(t, 'status-refresh-flag-')
  const { bridge, port } = await coordinator(t, root, { deadlineMs: 1000, peerWaitMs: 500 })
  const requests: Record<string, Record<string, unknown>[]> = { claude: [], codex: [] }
  let codexAnswer: Record<string, unknown> = { provider: 'codex', state: 'signed_in' }
  const revision = randomUUID()
  await fakeStatusPeer(t, root, port, 'claude', async (request) => {
    requests.claude.push(request)
    return { provider_status: { provider: 'claude', state: 'not_saved', revision } }
  })
  const codex = await fakeStatusPeer(t, root, port, 'codex', async (request) => {
    requests.codex.push(request)
    return { provider_status: codexAnswer }
  })
  await waitFor(async () => {
    const status = await bridge.providerStatus()
    return status.claude.state !== 'unknown' && status.codex.state !== 'unknown'
  }, 'both status connections')

  // An older guest's answer has no age: it was read just now. Claude is read on every request.
  const before = Date.now()
  const forced = await bridge.providerStatus(undefined, true)
  const after = Date.now()
  assert.equal(requests.codex.at(-1)?.refresh, true)
  assert.equal(requests.claude.at(-1)?.refresh, undefined)
  for (const status of [forced.claude, forced.codex]) {
    assert.ok('checked_at' in status)
    const checkedAt = Date.parse(status.checked_at)
    assert.ok(checkedAt >= before && checkedAt <= after)
  }
  assert.equal(forced.claude.state === 'not_saved' && forced.claude.revision, revision)

  // A plain read doesn't ask for a check.
  await bridge.providerStatus()
  assert.equal(requests.codex.at(-1)?.refresh, undefined)

  // An answer from a check 90 s ago is dated then.
  codexAnswer = { provider: 'codex', state: 'signed_out', age_ms: 90_000 }
  const aged = (await bridge.providerStatus()).codex
  assert.ok(aged.state === 'signed_out')
  assert.ok(Math.abs(Date.parse(aged.checked_at) - (Date.now() - 90_000)) < 1000)

  // No check finished yet.
  codexAnswer = { provider: 'codex', state: 'checking' }
  assert.deepEqual((await bridge.providerStatus()).codex, { state: 'unknown', reason: 'checking' })

  // An answer with a bad age, or with anything else in it, is refused.
  codexAnswer = { provider: 'codex', state: 'signed_in', age_ms: -1 }
  assert.deepEqual((await bridge.providerStatus()).codex, {
    state: 'unknown',
    reason: 'service_unavailable',
  })
  await codex.closed
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
    // The turn holds the account lock shared; so does the check.
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
  assert.equal((await checkedThrough(bridge)).codex.state, 'signed_in')
  assert.equal(turn.destroyed, false)
})

/** A certificate from another CA, for a server that is not the paired coordinator. */
async function selfSigned(root: string) {
  const other = join(root, 'other')
  await mkdir(other)
  await pairedCertificates(other)
  return pairing(join(other, 'bench-coordinator'))
}

test('status connections leave all eight turn connections free', async (t) => {
  const root = await scratch(t, 'status-capacity-')
  const { bridge, port } = await coordinator(t, root)
  const turns: TLSSocket[] = []
  for (let i = 0; i < 8; i++) {
    turns.push(await turnPeer(t, root, port, { codexSubscription: true, providerStatus: true }))
  }
  for (const provider of ['claude', 'codex'] as const) {
    const socketPath = await statusService(t, root, provider, async () =>
      provider === 'claude'
        ? { provider, state: 'not_saved', revision: randomUUID() }
        : { provider, state: 'signed_out', age_ms: 0 },
    )
    await relayStatus(t, socketPath, port)
  }
  const status = await bridge.providerStatus()
  assert.equal(status.claude.state, 'not_saved')
  assert.equal(status.codex.state, 'signed_out')
  // A ninth turn connection is still refused.
  const ninth = await turnPeer(t, root, port, { codexSubscription: true, providerStatus: true })
  await once(ninth, 'close')
  assert.ok(turns.every((socket) => !socket.destroyed))
})

test("one provider's relays cannot take the other's status connections", async (t) => {
  const root = await scratch(t, 'status-per-provider-')
  const { bridge, port } = await coordinator(t, root)
  const claudeSocket = await statusService(t, root, 'claude', async () => ({
    provider: 'claude',
    state: 'not_saved',
    revision: randomUUID(),
  }))
  const extra: Promise<unknown>[] = []
  for (let i = 0; i < 4; i++) {
    extra.push((await relayStatus(t, claudeSocket, port)).closed)
  }
  // Claude keeps two; the others are refused.
  await Promise.race(extra)
  const codexSocket = await statusService(t, root, 'codex', async () => ({
    provider: 'codex',
    state: 'signed_in',
    age_ms: 0,
  }))
  await relayStatus(t, codexSocket, port)
  const status = await bridge.providerStatus()
  assert.equal(status.claude.state, 'not_saved')
  assert.equal(status.codex.state, 'signed_in')
})
