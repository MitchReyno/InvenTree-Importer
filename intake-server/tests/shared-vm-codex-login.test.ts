import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexAccount, parseDevice } from '../src/agents/shared-vm/codex-login.ts'

const id = 'be8d5568-670e-4618-a98a-557c7c7862d0'
const device = {
  type: 'chatgptDeviceCode',
  loginId: id,
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
}

test('a matching device completion and a confirmed ChatGPT account promote only the private guest home', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-login-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let connected = false
  const calls: string[] = []
  const rpc = {
    completion: undefined as Record<string, unknown> | undefined,
    initialize: async () => {},
    close: async () => {},
    connected: async () => connected,
    request: async (method: string) => {
      calls.push(method)
      if (method === 'account/logout') connected = false
      return device
    },
  }
  const account = new CodexAccount(root, () => rpc)
  assert.deepEqual(await account.action('status'), { state: 'disconnected' })
  await account.action('start')
  await assert.rejects(account.action('cancel', 'another-login'))
  connected = true
  rpc.completion = { loginId: 'another-login', success: true }
  assert.equal((await account.action('status', id)).state, 'pending')
  assert.ok(!(await readdir(root)).includes('account'))
  rpc.completion = { loginId: id, success: true }
  assert.deepEqual(await account.action('status', id), { state: 'connected' })
  const restarted = new CodexAccount(root, () => rpc)
  assert.deepEqual(await restarted.action('status'), { state: 'connected' })
  assert.deepEqual(await restarted.action('disconnect'), { state: 'disconnected' })
  assert.ok(calls.includes('account/logout'))
  assert.equal((await restarted.action('start')).state, 'pending')
  await restarted.action('cancel', id)
  assert.ok(calls.includes('account/login/cancel'))
})

test('denial, cancelled, interrupted and unconfirmed sign-ins cannot authorize a turn', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-deny-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const rpc = {
    completion: { loginId: id, success: false },
    initialize: async () => {},
    close: async () => {},
    connected: async () => false,
    request: async () => device,
  }
  const account = new CodexAccount(root, () => rpc)
  await account.action('start')
  assert.deepEqual(await account.action('status', id), { state: 'denied' })
  await account.action('start')
  rpc.completion.success = true
  await assert.rejects(account.action('status', id))
  assert.deepEqual(await readdir(root), [])
  await account.action('start')
  await account.action('cancel', id)
  await assert.rejects(account.action('status', id))
  assert.deepEqual(await account.action('status'), { state: 'disconnected' })
  assert.throws(() =>
    parseDevice({ ...device, verificationUrl: 'https://example.org/codex/device' }),
  )
})

test('expiry cancels the native login and discards even a late successful completion', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-expiry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const when = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: when })
  const methods: string[] = []
  const rpc = {
    completion: { loginId: id, success: true },
    initialize: async () => {},
    close: async () => {},
    connected: async () => true,
    request: async (method: string) => {
      methods.push(method)
      return device
    },
  }
  const account = new CodexAccount(root, () => rpc)
  await account.action('start')
  t.mock.timers.setTime(when + 16 * 60_000)
  t.mock.timers.tick(10_000)
  // Wait until the background cancel has closed the RPC and removed the pending home.
  for (let i = 0; i < 100 && (await readdir(root)).length; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  assert.deepEqual(await readdir(root), [])
  assert.deepEqual(await account.action('status', id), { state: 'disconnected' })
  assert.ok(methods.includes('account/login/cancel'))
  assert.deepEqual(await readdir(root), [])
})

test('an interrupted login stays unconfirmed after a new management process starts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-interrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdtemp(join(root, 'login-'))
  const rpc = {
    initialize: async () => {},
    close: async () => {},
    connected: async () => false,
    request: async () => device,
  }
  const account = new CodexAccount(root, () => rpc)
  assert.deepEqual(await account.action('status'), { state: 'disconnected' })
  await account.action('start')
  assert.equal((await readdir(root)).length, 1)
  await account.action('cancel', id)
  assert.deepEqual(await readdir(root), [])
})
