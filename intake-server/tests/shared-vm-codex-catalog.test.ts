import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexAccount } from '#/agents/shared-vm/codex-login.ts'
import { CatalogReadError } from '#/agents/model-catalog/normalise.ts'
import { codexModels } from '#/agents/model-catalog/normalise.ts'

const id = 'be8d5568-670e-4618-a98a-557c7c7862d0'
const device = {
  type: 'chatgptDeviceCode',
  loginId: id,
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
}
const page = JSON.parse(
  await readFile(
    new URL('./fixtures/model-catalog/codex-model-list-0.166.0.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>

/** An account RPC that records what happens in order and can hold `model/list` open. */
function recordingRpc(events: string[], hold?: Promise<void>) {
  return (_root: string, home: string, exclusive: boolean) => {
    const name = exclusive ? 'exclusive' : 'shared'
    events.push(`${name} open`)
    let closed = false
    let loggedOut = false
    return {
      completion: { loginId: id, success: true } as Record<string, unknown> | undefined,
      initialize: async () => 'bench_intake/0.166.0 (fixture)',
      connected: async () => !loggedOut,
      async close() {
        if (!closed) {
          closed = true
          events.push(`${name} closed`)
        }
      },
      async request(method: string) {
        events.push(`${name} ${method}`)
        if (method === 'account/logout') {
          loggedOut = true
        }
        if (method === 'model/list') {
          await hold
          return page
        }
        return device
      },
      home,
    }
  }
}

test('a Codex catalogue read lists models under the shared lock with its sign-in generation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const events: string[] = []
  const account = new CodexAccount(root, recordingRpc(events))
  await assert.rejects(account.readModels(AbortSignal.timeout(5000)), (error) => {
    return error instanceof CatalogReadError && error.code === 'signed_out'
  })
  assert.deepEqual(events, [])

  await account.action('start')
  // A pending sign-in holds the exclusive lock; no read starts beside it.
  await assert.rejects(account.readModels(AbortSignal.timeout(5000)), CatalogReadError)
  assert.deepEqual(await account.action('status', id), { state: 'connected' })
  const promoted = await account.signInGeneration()
  assert.match(promoted, /^[0-9a-f-]{36}$/)

  events.length = 0
  const read = await account.readModels(AbortSignal.timeout(5000))
  assert.equal(read.generation, promoted)
  assert.equal(read.cliVersion, '0.166.0')
  assert.equal(codexModels(read.raw as unknown[]).length, 10)
  assert.deepEqual(events, ['shared open', 'shared model/list', 'shared closed'])

  // Logging out advances the generation, so the list read before belongs to another sign-in.
  await account.action('disconnect')
  assert.notEqual(await account.signInGeneration(), promoted)
})

test('a sign-in change waits for a running catalogue read to stop and reap', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'account'))
  const events: string[] = []
  let release!: () => void
  const hold = new Promise<void>((resolve) => (release = resolve))
  const account = new CodexAccount(root, recordingRpc(events, hold))
  const reading = account.readModels(AbortSignal.timeout(5000))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(events, ['shared open', 'shared model/list'])
  const disconnecting = account.action('disconnect')
  const failed = await reading.then(
    () => undefined,
    (error: unknown) => error,
  )
  assert.ok(failed instanceof CatalogReadError)
  await disconnecting
  release()
  // The read's process was reaped before the exclusive sign-in change opened.
  assert.ok(events.indexOf('shared closed') < events.indexOf('exclusive open'))
  assert.notEqual(await account.signInGeneration(), 'unrecorded')
})

test('the sign-in generation moves before the account does, so an interrupted change never keeps it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-order-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let account: CodexAccount
  let atLogout: string | undefined
  const base = recordingRpc([])
  account = new CodexAccount(root, (rootPath, home, exclusive) => {
    const rpc = base(rootPath, home, exclusive)
    return {
      ...rpc,
      async request(method: string) {
        if (method === 'account/logout') {
          atLogout = await account.signInGeneration()
        }
        return rpc.request(method)
      },
    }
  })
  await account.action('start')
  // The promotion's rename fails, as a stop between the two steps would leave it.
  await mkdir(join(root, 'account', 'in-the-way'), { recursive: true })
  const before = await account.signInGeneration()
  await assert.rejects(account.action('status', id))
  const afterFailedPromotion = await account.signInGeneration()
  assert.notEqual(afterFailedPromotion, before)

  await account.action('disconnect')
  assert.ok(atLogout)
  assert.notEqual(atLogout, afterFailedPromotion)
})

test('a read asked for after its request ended, or racing a sign-in change, starts no app-server', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'account'))
  const events: string[] = []
  const account = new CodexAccount(root, recordingRpc(events))
  await assert.rejects(account.readModels(AbortSignal.abort()), CatalogReadError)
  assert.equal(events.length, 0)

  // The disconnect starts while the read is still looking for the account directory.
  const reading = account.readModels(AbortSignal.timeout(5000))
  const disconnecting = account.action('disconnect')
  await assert.rejects(reading, CatalogReadError)
  await disconnecting
  assert.ok(!events.includes('shared open'), events.join(', '))
  assert.ok(events.includes('exclusive account/logout'))
})
