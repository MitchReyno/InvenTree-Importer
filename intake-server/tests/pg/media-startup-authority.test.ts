import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { freePort, until } from '../support/manual-process.ts'

async function startMain(
  url: string,
  root: string,
  authority: Awaited<ReturnType<typeof seedAuthority>>,
) {
  const origin = `http://127.0.0.1:${await freePort()}`
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      INTAKE_DATABASE_URL: url,
      INTAKE_BLOB_ROOT: root,
      INTAKE_ORIGIN: origin,
      INTAKE_ACTOR_ID: authority.actor,
      INTAKE_TARGET_ID: authority.target,
      INTAKE_TARGET_CONTEXT_ID: authority.context,
      INTAKE_CREDENTIAL_REF: 'owned_startup_fixture',
      INTAKE_DEV_API_KEY: 'owned-fake-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const completed = once(child, 'close')
  let output = ''
  child.stdout.on('data', (bytes) => {
    output += bytes.toString()
  })
  child.stderr.on('data', (bytes) => {
    output += bytes.toString()
  })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000)
  return {
    origin,
    child,
    completed,
    output: () => output,
    async stop() {
      clearTimeout(deadline)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await completed
    },
  }
}

async function awaitReady(runtime: Awaited<ReturnType<typeof startMain>>) {
  await until(
    async () => {
      assert.equal(runtime.child.exitCode, null, 'Owned startup must remain alive')
      try {
        return (await fetch(`${runtime.origin}/api/v1/health`)).ok
      } catch {
        return false
      }
    },
    Boolean,
    5000,
  )
  const response = await fetch(`${runtime.origin}/api/v1/bootstrap`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).media_enabled, true)
}

test(
  'actual main reopens its bound store and refuses a different database before listening',
  { timeout: 30000 },
  async () => {
    const first = await isolatedDatabase()
    const second = await isolatedDatabase()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-owned-startup-')))
    let runtime: Awaited<ReturnType<typeof startMain>> | undefined
    try {
      const firstAuthority = await seedAuthority(first.pool)
      const secondAuthority = await seedAuthority(second.pool)
      runtime = await startMain(first.url, root, firstAuthority)
      await awaitReady(runtime)
      await runtime.stop()
      const marker = await readFile(join(root, '.media-store.json'))

      runtime = await startMain(first.url, root, firstAuthority)
      await awaitReady(runtime)
      await runtime.stop()
      assert.deepEqual(await readFile(join(root, '.media-store.json')), marker)

      runtime = await startMain(second.url, root, secondAuthority)
      const [code] = await runtime.completed
      assert.equal(code, 1)
      assert.match(runtime.output(), /media_store_identity_mismatch/)
      assert(!runtime.output().includes('listening on configured loopback origin'))
      assert.deepEqual(await readFile(join(root, '.media-store.json')), marker)
    } finally {
      await runtime?.stop()
      await first.dispose()
      await second.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)
