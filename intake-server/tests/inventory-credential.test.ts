import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { createServer as httpServer } from 'node:http'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_INVENTORY_TOKEN_LENGTH } from '@invimport/contracts'
import { createServer } from '#/api/server.ts'
import { registerFrontendAssets } from '#/api/frontend-assets.ts'
import { bootstrap, devConfig } from '#/config.ts'
import { connectionStatus } from '#/header/connection.ts'
import { CredentialHolder } from '#/inventory/credential.ts'
import {
  claimStore,
  CREDENTIAL_FILE,
  deleteCredential,
  loadSavedCredential,
  requireStableAncestors,
  requireUnpublished,
  resolveSecretsDir,
  saveCredential,
} from '#/inventory/credential-store.ts'
import {
  registerInventoryCredential,
  type InventoryCredentialRoutes,
} from '#/inventory/credential-routes.ts'
import { configureReadTarget } from '#/inventory/read-target.ts'
import { inventoryTransport, withoutEcho } from '#/inventory/transport.ts'

const ENVIRONMENT_TOKEN = 'environment-token-synthetic'
// Planted so every response and log line can be searched for it.
const PLANTED = 'planted-replacement-0123456789abcdef'
const TARGET = { origin: 'https://inventory.example.invalid', targetContextId: 'context-1' }

const config = devConfig({
  INTAKE_ORIGIN: 'http://127.0.0.1:4334',
  INTAKE_CREDENTIAL_REF: 'credential-fixture',
  INTAKE_DEV_API_KEY: ENVIRONMENT_TOKEN,
})

const binding = {
  actorId: '00000000-0000-4000-8000-000000000001',
  targetId: '00000000-0000-4000-8000-000000000002',
  targetContextId: '00000000-0000-4000-8000-000000000003',
}

async function secretsDir(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'intake-secrets-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  return join(parent, 'secrets')
}

function json(status: number) {
  return new Response('{"results":[]}', {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The token as stored, read back through the file's JSON. */
async function storedToken(directory: string) {
  const text = await readFile(join(directory, CREDENTIAL_FILE), 'utf8')
  return (JSON.parse(text) as { token: string }).token
}

type Overrides = Partial<Omit<InventoryCredentialRoutes, 'target'>> & {
  holder?: CredentialHolder
  probeWith?: (token: string) => Promise<Response>
  noTarget?: boolean
}

async function credentialServer(overrides: Overrides = {}) {
  const app = createServer(config)
  const probes: string[] = []
  let changes = 0
  let fences = 0
  const holder = overrides.holder ?? new CredentialHolder(ENVIRONMENT_TOKEN, null)
  const probeWith =
    overrides.probeWith ??
    (async (token: string) => {
      probes.push(token)
      return json(200)
    })
  registerInventoryCredential(app, {
    secretsDir: overrides.secretsDir,
    target: overrides.noTarget ? undefined : { holder, binding: TARGET, probeWith },
    fence:
      overrides.fence ??
      (async () => {
        fences += 1
      }),
    changed: () => {
      changes += 1
    },
  })
  // Reading bootstrap boots the server, so it comes after every route is registered.
  const csrf = (
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { host: '127.0.0.1:4334' },
      })
    ).json() as { csrf_token: string }
  ).csrf_token
  const headers = { host: '127.0.0.1:4334', origin: config.origin, 'x-intake-csrf': csrf }
  return {
    app,
    holder,
    probes,
    changes: () => changes,
    fences: () => fences,
    replace: (token: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/inventory-credential',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: JSON.stringify({ token }),
      }),
    // No body, so no content type, as the browser client sends it.
    revert: (extra: Record<string, string> = headers) =>
      app.inject({ method: 'DELETE', url: '/api/v1/inventory-credential', headers: extra }),
  }
}

test('a saved token is an owner-only file, written whole, in an owner-only directory', async (t) => {
  const directory = await secretsDir(t)

  const saved = await saveCredential(directory, PLANTED, TARGET)

  const file = join(directory, CREDENTIAL_FILE)
  assert.equal(await storedToken(directory), PLANTED)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.deepEqual(await readdir(directory), [CREDENTIAL_FILE], 'no temporary file is left')
  assert.deepEqual(await loadSavedCredential(directory, TARGET), saved)
})

test('a replacement is a new file renamed into place, never the old one rewritten', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, 'first-token', TARGET)
  const old = await open(join(directory, CREDENTIAL_FILE), 'r')
  t.after(() => old.close())

  await saveCredential(directory, PLANTED, TARGET)

  // The old file's contents are untouched: a reader mid-way never sees a mixture.
  assert.match(await old.readFile('utf8'), /first-token/)
  assert.equal(await storedToken(directory), PLANTED)
  assert.deepEqual(await readdir(directory), [CREDENTIAL_FILE])
})

test('a failure to flush the directory after the rename still reports the token saved', async (t) => {
  const directory = await secretsDir(t)
  const failing = {
    syncDirectory: async () => {
      throw new Error('EIO')
    },
  }

  const saved = await saveCredential(directory, PLANTED, TARGET, failing)
  await deleteCredential(directory, failing)

  assert.equal(saved.token, PLANTED)
  assert.deepEqual(await readdir(directory), [])
})

test('a saved file or directory other users can reach is refused, with or without a token', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED, TARGET)
  const file = join(directory, CREDENTIAL_FILE)

  await chmod(file, 0o644)
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })

  await chmod(file, 0o600)
  await chmod(directory, 0o750)
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })

  await rm(file)
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })
  await assert.rejects(saveCredential(directory, PLANTED, TARGET), {
    code: 'secret_file_permissions',
  })
})

test(
  'an access list granting another user is refused, though the mode bits say owner-only',
  { skip: process.platform !== 'darwin' && 'only macOS hides access lists from the mode bits' },
  async (t) => {
    const directory = await secretsDir(t)
    await saveCredential(directory, PLANTED, TARGET)
    const file = join(directory, CREDENTIAL_FILE)

    execFileSync('/bin/chmod', ['+a', 'everyone allow read', file])
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await assert.rejects(loadSavedCredential(directory, TARGET), {
      code: 'secret_file_permissions',
    })

    execFileSync('/bin/chmod', ['-N', file])
    execFileSync('/bin/chmod', ['+a', 'everyone allow read,file_inherit', directory])
    await assert.rejects(loadSavedCredential(directory, TARGET), {
      code: 'secret_file_permissions',
    })
    await assert.rejects(saveCredential(directory, 'next-token', TARGET), {
      code: 'secret_file_permissions',
    })
    assert.equal(await storedToken(directory), PLANTED)
  },
)

test('a linked directory, a linked file or a pipe is refused without blocking', async (t) => {
  const directory = await secretsDir(t)
  const real = `${directory}-real`
  await mkdir(real, { mode: 0o700 })
  await symlink(real, directory)
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })
  await rm(directory)

  await mkdir(directory, { mode: 0o700 })
  await saveCredential(real, PLANTED, TARGET)
  await symlink(join(real, CREDENTIAL_FILE), join(directory, CREDENTIAL_FILE))
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })
  await rm(join(directory, CREDENTIAL_FILE))

  execFileSync('mkfifo', ['-m', '600', join(directory, CREDENTIAL_FILE)])
  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_permissions' })
})

test('a link among the published app files never serves the saved token', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED, TARGET)
  const dist = join(directory, '..', 'dist')
  await mkdir(dist)
  await writeFile(join(dist, 'index.html'), '<!doctype html>')
  await symlink(join(directory, CREDENTIAL_FILE), join(dist, 'token.txt'))
  await symlink(directory, join(dist, 'linked'))
  const app = createServer(config)
  await registerFrontendAssets(app, dist, directory)

  const page = await app.inject({ url: '/', headers: { host: '127.0.0.1:4334' } })
  const linkedFile = await app.inject({ url: '/token.txt', headers: { host: '127.0.0.1:4334' } })
  const linkedDirectory = await app.inject({
    url: `/linked/${CREDENTIAL_FILE}`,
    headers: { host: '127.0.0.1:4334' },
  })

  assert.equal(page.statusCode, 200)
  for (const response of [linkedFile, linkedDirectory]) {
    assert.notEqual(response.statusCode, 200)
    assert.ok(!response.body.includes(PLANTED))
  }
})

test('a linked directory is refused however the path is spelled', async (t) => {
  const directory = await secretsDir(t)
  const real = `${directory}-real`
  await mkdir(real, { mode: 0o700 })
  await symlink(real, directory)

  for (const spelling of [`${directory}/`, `${directory}/.`, `${directory}/x/..`]) {
    await assert.rejects(loadSavedCredential(spelling, TARGET), {
      code: 'secret_file_permissions',
    })
    await assert.rejects(saveCredential(spelling, PLANTED, TARGET), {
      code: 'secret_file_permissions',
    })
  }
  assert.deepEqual(await readdir(real), [])
})

test('repeated resets never hold a status request: it answers unobserved and the next read probes', async () => {
  const releases: (() => void)[] = []
  const status = connectionStatus(binding, 'https://inventory.example.invalid/', async () => {
    await new Promise<void>((resolve) => releases.push(resolve))
    return json(200)
  })

  const waiting = status()
  for (let reset = 0; reset < 3; reset += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    status.reset()
    releases.shift()?.()
  }
  const answer = await waiting
  releases.forEach((release) => release())

  assert.equal(answer.target.state, 'unknown')
  assert.equal(answer.target.freshness, 'unobserved')
  const next = status()
  await new Promise((resolve) => setImmediate(resolve))
  releases.shift()?.()
  assert.equal((await next).target.state, 'reachable')
})

test('a secrets directory under an ancestor others can write to is refused', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'intake-ancestors-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const shared = join(parent, 'shared')
  await mkdir(shared)
  await chmod(shared, 0o777)
  const sticky = join(parent, 'sticky')
  await mkdir(sticky)
  await chmod(sticky, 0o1777)

  await assert.rejects(requireStableAncestors(await resolveSecretsDir(join(shared, 'secrets'))), {
    code: 'secret_file_permissions',
  })
  // A sticky directory, like /tmp, lets only an entry's owner replace it.
  await requireStableAncestors(await resolveSecretsDir(join(sticky, 'secrets')))
  await requireStableAncestors(await resolveSecretsDir(join(parent, 'secrets')))
})

test('a link under a writable parent is resolved once, so swapping it later redirects nothing', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'intake-ancestors-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const safe = join(parent, 'safe')
  const other = join(parent, 'other')
  const shared = join(parent, 'shared')
  await mkdir(safe, { mode: 0o700 })
  await mkdir(other, { mode: 0o700 })
  await mkdir(shared)
  await chmod(shared, 0o777)
  await symlink(safe, join(shared, 'link'))

  const resolved = await resolveSecretsDir(join(shared, 'link', 'secrets'))
  await requireStableAncestors(resolved)
  await rm(join(shared, 'link'))
  await symlink(other, join(shared, 'link'))
  await saveCredential(resolved, PLANTED, TARGET)

  assert.equal(resolved, join(await realpath(safe), 'secrets'))
  assert.deepEqual(await readdir(join(safe, 'secrets')), [CREDENTIAL_FILE])
  assert.deepEqual(await readdir(other), [])
})

test('one running server owns a store; a lock left by an exited one is replaced', async (t) => {
  const directory = await secretsDir(t)

  const release = await claimStore(directory)
  await assert.rejects(claimStore(directory), { code: 'secret_store_in_use' })
  await release()
  const again = await claimStore(directory)
  await again()

  // A process that has exited no longer holds the store.
  const lock = join(directory, '.inventory-read-token.lock')
  await mkdir(lock, { mode: 0o700 })
  await writeFile(join(lock, 'pid'), '999999999', { mode: 0o600 })
  const reclaimed = await claimStore(directory)
  // A release that runs twice removes nothing it doesn't own.
  await reclaimed()
  const successor = await claimStore(directory)
  await reclaimed()
  await assert.rejects(claimStore(directory), { code: 'secret_store_in_use' })
  await successor()
})

test('starters recovering the same stale lock at once leave exactly one owner', async (t) => {
  const directory = await secretsDir(t)
  const lock = join(directory, '.inventory-read-token.lock')
  await mkdir(lock, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  await writeFile(join(lock, 'pid'), '999999999', { mode: 0o600 })

  const claims = await Promise.allSettled(Array.from({ length: 5 }, () => claimStore(directory)))

  const owners = claims.filter((claim) => claim.status === 'fulfilled')
  assert.equal(owners.length, 1)
  for (const claim of claims) {
    if (claim.status === 'rejected') {
      assert.equal((claim.reason as { code: string }).code, 'secret_store_in_use')
    }
  }
  assert.equal((await readFile(join(lock, 'pid'), 'utf8')).trim(), String(process.pid))
  await (owners[0] as PromiseFulfilledResult<() => Promise<void>>).value()
})

test(
  'an ancestor with a deny-only access list is fine; one that grants access is refused',
  { skip: process.platform !== 'darwin' && 'only macOS hides access lists from the mode bits' },
  async () => {
    // Home folders carry `group:everyone deny delete`; the launcher's default lives under one.
    await requireStableAncestors(
      await resolveSecretsDir(join(homedir(), `.intake-secrets-test-${process.pid}`, 'secrets')),
    )
    const parent = await mkdtemp(join(tmpdir(), 'intake-ancestors-'))
    const denying = join(parent, 'denying')
    const granting = join(parent, 'granting')
    await mkdir(denying)
    await mkdir(granting)
    try {
      execFileSync('/bin/chmod', ['+a', 'everyone deny delete', denying])
      execFileSync('/bin/chmod', ['+a', 'everyone allow add_file,delete_child', granting])

      await requireStableAncestors(await resolveSecretsDir(join(denying, 'secrets')))
      await assert.rejects(
        requireStableAncestors(await resolveSecretsDir(join(granting, 'secrets'))),
        { code: 'secret_file_permissions' },
      )
    } finally {
      // Cleared first: the deny entry would refuse the removal.
      execFileSync('/bin/chmod', ['-N', denying, granting])
      await rm(parent, { recursive: true, force: true })
    }
  },
)

test('a recovery left mid-way is never expired: claims stay refused until it is removed', async (t) => {
  const directory = await secretsDir(t)
  await mkdir(directory, { mode: 0o700 })
  const lock = join(directory, '.inventory-read-token.lock')
  await mkdir(lock, { mode: 0o700 })
  await writeFile(join(lock, 'pid'), '999999999', { mode: 0o600 })
  const recovery = join(directory, '.inventory-read-token.lock.recovery')
  await mkdir(recovery, { mode: 0o700 })
  const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await utimes(recovery, longAgo, longAgo)

  await assert.rejects(claimStore(directory), { code: 'secret_store_in_use' })
  await assert.rejects(claimStore(directory), { code: 'secret_store_in_use' })

  await rm(recovery, { recursive: true })
  const owner = await claimStore(directory)
  await owner()
})

test('a lock whose owner cannot be read is never recovered', async (t) => {
  const directory = await secretsDir(t)
  await mkdir(directory, { mode: 0o700 })
  const lock = join(directory, '.inventory-read-token.lock')
  await mkdir(lock, { mode: 0o700 })
  await writeFile(join(lock, 'pid'), 'not-a-pid', { mode: 0o600 })

  await assert.rejects(claimStore(directory), { code: 'secret_store_in_use' })

  assert.equal(await readFile(join(lock, 'pid'), 'utf8'), 'not-a-pid', 'the lock is untouched')
})

test('a directory slipped in above the store by someone else is caught when the store is made', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'intake-ancestors-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  // As if created between the startup check and the store's own mkdir.
  const slipped = join(parent, 'slipped')
  await mkdir(slipped)
  await chmod(slipped, 0o777)
  const directory = join(await realpath(parent), 'slipped', 'nested', 'secrets')

  await assert.rejects(claimStore(directory), { code: 'secret_file_permissions' })
  await assert.rejects(saveCredential(directory, PLANTED, TARGET), {
    code: 'secret_file_permissions',
  })
})

test('missing ancestors are created owner-only, one at a time', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'intake-ancestors-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const directory = join(await realpath(parent), 'a', 'b', 'secrets')

  const release = await claimStore(directory)
  await release()

  for (const created of ['a', 'a/b', 'a/b/secrets']) {
    assert.equal((await stat(join(parent, created))).mode & 0o777, 0o700, created)
  }
})

test('overlapping claims leave exactly one owner', async (t) => {
  const directory = await secretsDir(t)
  await mkdir(directory, { mode: 0o700 })

  const claims = await Promise.allSettled(Array.from({ length: 5 }, () => claimStore(directory)))

  const owners = claims.filter((claim) => claim.status === 'fulfilled')
  assert.equal(owners.length, 1)
  for (const claim of claims) {
    if (claim.status === 'rejected') {
      assert.equal((claim.reason as { code: string }).code, 'secret_store_in_use')
    }
  }
  await (owners[0] as PromiseFulfilledResult<() => Promise<void>>).value()
})

test('a saved token is used only for the InvenTree and target context it was checked against', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED, TARGET)

  assert.equal(
    (await loadSavedCredential(directory, { ...TARGET, origin: 'https://other.invalid' }))?.token,
    undefined,
  )
  assert.equal(
    (await loadSavedCredential(directory, { ...TARGET, targetContextId: 'context-2' }))?.token,
    undefined,
  )
  assert.equal(await loadSavedCredential(directory, undefined), null)
  assert.equal((await loadSavedCredential(directory, TARGET))?.token, PLANTED)
})

test('a saved file that is not a token and its target is refused', async (t) => {
  const directory = await secretsDir(t)
  await mkdir(directory, { mode: 0o700 })
  await writeFile(join(directory, CREDENTIAL_FILE), PLANTED, { mode: 0o600 })

  await assert.rejects(loadSavedCredential(directory, TARGET), { code: 'secret_file_invalid' })
})

test('without a secrets directory nothing is saved or loaded', async () => {
  assert.equal(await loadSavedCredential(undefined, TARGET), null)
  await assert.rejects(saveCredential(undefined, PLANTED, TARGET), {
    code: 'secret_store_unavailable',
  })
  await deleteCredential(undefined)
})

test('a relative secrets directory, or one overlapping the published app, is refused', async (t) => {
  const directory = await secretsDir(t)
  const published = join(directory, '..', 'dist')
  await mkdir(published)

  assert.throws(
    () => devConfig({ INTAKE_SECRETS_DIR: 'secrets' }),
    new Error('invalid_secrets_directory'),
  )
  await assert.rejects(requireUnpublished(join(published, 'secrets'), [published]), {
    code: 'invalid_secrets_directory',
  })
  await assert.rejects(requireUnpublished(join(directory, '..'), [published]), {
    code: 'invalid_secrets_directory',
  })
  await requireUnpublished(directory, [published])
})

test('Check and save fences the target, probes the candidate, then saves only an accepted token', async (t) => {
  const directory = await secretsDir(t)
  let release: () => void = () => undefined
  let probing: () => void = () => undefined
  const probed = new Promise<void>((resolve) => {
    probing = resolve
  })
  const server = await credentialServer({
    secretsDir: directory,
    probeWith: async () => {
      probing()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return json(200)
    },
  })

  const pending = server.replace(PLANTED)
  await probed
  // While InvenTree is answering, nothing is written and the token in use is unchanged.
  await assert.rejects(readdir(directory), { code: 'ENOENT' })
  assert.equal(server.holder.current(), ENVIRONMENT_TOKEN)
  release()
  const response = await pending

  assert.equal(response.statusCode, 200)
  const body = response.json() as { credential_source: string; credential_saved_at: string }
  assert.equal(body.credential_source, 'saved')
  assert.ok(!Number.isNaN(Date.parse(body.credential_saved_at)))
  assert.equal(server.holder.current(), PLANTED)
  assert.equal(server.changes(), 1)
  assert.equal(server.fences(), 2, 'before the probe and before the write')
  assert.equal(await storedToken(directory), PLANTED)
  assert.ok(!response.body.includes(PLANTED))
})

test('a refused token, an unreachable InvenTree or a rotated context writes nothing', async (t) => {
  const directory = await secretsDir(t)
  const refusing = await credentialServer({
    secretsDir: directory,
    probeWith: async () => json(401),
  })
  const unreachable = await credentialServer({
    secretsDir: directory,
    probeWith: async () => {
      throw new Error('connect ECONNREFUSED')
    },
  })
  let fenceCalls = 0
  const rotated = await credentialServer({
    secretsDir: directory,
    fence: async () => {
      fenceCalls += 1
      if (fenceCalls === 2) {
        const { fail } = await import('#/capture/model.ts')
        fail('target_context_changed', 409)
      }
    },
  })

  const refused = await refusing.replace(PLANTED)
  const failed = await unreachable.replace(PLANTED)
  const moved = await rotated.replace(PLANTED)

  assert.equal(refused.statusCode, 422)
  assert.equal((refused.json() as { code: string }).code, 'token_refused')
  assert.equal(failed.statusCode, 503)
  assert.equal((failed.json() as { code: string }).code, 'target_unavailable')
  assert.equal(moved.statusCode, 409)
  assert.equal((moved.json() as { code: string }).code, 'target_context_changed')
  for (const server of [refusing, unreachable, rotated]) {
    assert.equal(server.holder.current(), ENVIRONMENT_TOKEN)
    assert.equal(server.changes(), 0)
  }
  await assert.rejects(readdir(directory), { code: 'ENOENT' })
  for (const response of [refused, failed, moved]) {
    assert.ok(!response.body.includes(PLANTED))
  }
})

test('a second change while one runs is refused, not queued', async (t) => {
  const directory = await secretsDir(t)
  let release: () => void = () => undefined
  let probing: () => void = () => undefined
  const probed = new Promise<void>((resolve) => {
    probing = resolve
  })
  const server = await credentialServer({
    secretsDir: directory,
    probeWith: async () => {
      probing()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return json(200)
    },
  })

  const first = server.replace(PLANTED)
  await probed
  const second = await server.revert()
  release()

  assert.equal(second.statusCode, 409)
  assert.equal((second.json() as { code: string }).code, 'credential_change_in_progress')
  assert.equal((await first).statusCode, 200)
  assert.equal(server.holder.current(), PLANTED)
})

test('without a secrets directory or a read target, replacement is refused before InvenTree is asked', async () => {
  const unstored = await credentialServer({ secretsDir: undefined })
  const untargeted = await credentialServer({ secretsDir: '/unused', noTarget: true })

  const noStore = await unstored.replace(PLANTED)
  const noTarget = await untargeted.replace(PLANTED)

  assert.equal(noStore.statusCode, 503)
  assert.equal((noStore.json() as { code: string }).code, 'secret_store_unavailable')
  assert.equal(noTarget.statusCode, 503)
  assert.equal((noTarget.json() as { code: string }).code, 'setup_required')
  assert.deepEqual(unstored.probes, [])
  assert.equal(unstored.holder.current(), ENVIRONMENT_TOKEN)
})

test('Use the environment token deletes the saved file and reads use the environment token', async (t) => {
  const directory = await secretsDir(t)
  const saved = await saveCredential(directory, PLANTED, TARGET)
  const server = await credentialServer({
    secretsDir: directory,
    holder: new CredentialHolder(ENVIRONMENT_TOKEN, saved),
  })

  const response = await server.revert()

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    credential_source: 'environment',
    credential_saved_at: null,
  })
  assert.equal(server.holder.current(), ENVIRONMENT_TOKEN)
  assert.deepEqual(await readdir(directory), [])
  assert.equal(server.changes(), 1)
})

test('both commands need the CSRF token, and malformed tokens are refused without an echo', async (t) => {
  const directory = await secretsDir(t)
  const saved = await saveCredential(directory, PLANTED, TARGET)
  const server = await credentialServer({
    secretsDir: directory,
    holder: new CredentialHolder(ENVIRONMENT_TOKEN, saved),
  })
  const plain = { host: '127.0.0.1:4334', origin: config.origin }

  const unauthorisedPut = await server.app.inject({
    method: 'PUT',
    url: '/api/v1/inventory-credential',
    headers: { ...plain, 'content-type': 'application/json' },
    payload: JSON.stringify({ token: PLANTED }),
  })
  const unauthorisedDelete = await server.revert(plain)
  const malformed = await server.replace(`${PLANTED} with spaces`)
  const tooLong = await server.replace('x'.repeat(MAX_INVENTORY_TOKEN_LENGTH + 1) + PLANTED)

  assert.equal(unauthorisedPut.statusCode, 403)
  assert.equal(unauthorisedDelete.statusCode, 403)
  assert.equal(await storedToken(directory), PLANTED, 'the refused DELETE removed nothing')
  assert.equal(malformed.statusCode, 400)
  assert.ok([400, 413].includes(tooLong.statusCode))
  assert.deepEqual(server.probes, [])
  for (const response of [unauthorisedPut, unauthorisedDelete, malformed, tooLong]) {
    assert.ok(!response.body.includes(PLANTED))
  }
})

test('the longest token is accepted even when every character is JSON-escaped', async (t) => {
  const directory = await secretsDir(t)
  const server = await credentialServer({ secretsDir: directory })
  const escaped = '"'.repeat(MAX_INVENTORY_TOKEN_LENGTH)

  const response = await server.replace(escaped)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(server.probes, [escaped])
})

test('a read already sent keeps its token, and the next read uses the replacement', async () => {
  const holder = new CredentialHolder(ENVIRONMENT_TOKEN, null)
  const sent: string[] = []
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const transport = inventoryTransport(
    {
      kind: 'protected-read-only',
      origin: TARGET.origin,
      targetId: binding.targetId,
      contextId: binding.targetContextId,
      protectedOrigins: [TARGET.origin],
      credential: ENVIRONMENT_TOKEN,
    },
    async (_url, init) => {
      sent.push(new Headers(init?.headers).get('authorization')!)
      await held
      return json(200)
    },
    { credential: () => holder.current(), refuseEcho: true },
  )
  const target = { targetId: binding.targetId, contextId: binding.targetContextId }

  const inFlight = transport.probe(target)
  holder.replace({ token: PLANTED, savedAt: new Date().toISOString() })
  release()
  await inFlight
  await transport.probe(target)

  assert.deepEqual(sent, [`Token ${ENVIRONMENT_TOKEN}`, `Token ${PLANTED}`])
})

test('a target that echoes the token it was sent ends that read with an error, never the token', async () => {
  const holder = new CredentialHolder(ENVIRONMENT_TOKEN, null)
  holder.replace({ token: 'echo"token\\', savedAt: '2026-11-19T00:00:00.000Z' })
  const echoed = JSON.stringify({ pk: 7, name: 'Drawer', description: 'echo"token\\' })
  const bodies = [
    // Raw, split across two chunks.
    ['{"description":"echo"to', 'ken\\"}'],
    // As a JSON string, which escapes the quote and the backslash.
    [echoed.slice(0, 30), echoed.slice(30)],
  ]
  const transport = inventoryTransport(
    {
      kind: 'protected-read-only',
      origin: TARGET.origin,
      targetId: binding.targetId,
      contextId: binding.targetContextId,
      protectedOrigins: [TARGET.origin],
      credential: ENVIRONMENT_TOKEN,
    },
    async () => {
      const chunks = bodies.shift()!
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'application/json' } })
    },
    { credential: () => holder.current(), refuseEcho: true },
  )
  const target = { targetId: binding.targetId, contextId: binding.targetContextId }

  for (let read = 0; read < 2; read += 1) {
    const response = await transport.read(target, { kind: 'get_location', pk: '7' })
    await assert.rejects(response.text(), { code: 'target_echoed_token' })
  }
})

test('the approval transport, without the read option, keeps a response that contains its token', async () => {
  const transport = inventoryTransport(
    {
      kind: 'protected-read-only',
      origin: TARGET.origin,
      targetId: binding.targetId,
      contextId: binding.targetContextId,
      protectedOrigins: [TARGET.origin],
      credential: PLANTED,
    },
    async () =>
      new Response(JSON.stringify({ pk: 7, note: PLANTED }), {
        headers: { 'content-type': 'application/json' },
      }),
  )

  const response = await transport.read(
    { targetId: binding.targetId, contextId: binding.targetContextId },
    { kind: 'get_location', pk: '7' },
  )

  // Its outcomes are unchanged: the caller still receives the body it would have before.
  assert.deepEqual(await response.json(), { pk: 7, note: PLANTED })
})

test('a response without the token passes through unchanged', async () => {
  const response = withoutEcho(
    new Response('{"name":"Drawer 4"}', { headers: { 'content-type': 'application/json' } }),
    PLANTED,
  )

  assert.deepEqual(await response.json(), { name: 'Drawer 4' })
  assert.equal(response.headers.get('content-type'), 'application/json')
})

test('a reset ends the forced-check window and an older probe never lands', async () => {
  let clock = 0
  const outcomes = [json(200), json(401), json(200), json(200)]
  let release: () => void = () => undefined
  const holder = new CredentialHolder(ENVIRONMENT_TOKEN, null)
  const status = connectionStatus(
    binding,
    'https://inventory.example.invalid/',
    async () => {
      const outcome = outcomes.shift()!
      if (outcome.status === 401) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return outcome
    },
    Date.now,
    undefined,
    () => clock,
    holder,
  )

  // A forced check opens the 5-second window.
  await status.check()
  assert.equal(outcomes.length, 3)
  // The next forced check, started with the old token, is still running at the swap.
  clock = 6000
  const old = status.check()
  await new Promise((resolve) => setImmediate(resolve))
  holder.replace({ token: PLANTED, savedAt: '2026-11-19T00:00:00.000Z' })
  status.reset()
  const fresh = await status.check()
  // The old check finishes later, so its window, were it kept, would end later too.
  clock = 7000
  release()
  const settled = await old

  assert.equal(fresh.target.state, 'reachable')
  assert.equal(fresh.target.credential_source, 'saved')
  assert.equal(settled.target.failure_code, null, 'the old probe never became the observation')
  assert.equal(settled.target.credential_source, 'saved')
  // The window is the new token's own, from 6000: at 11500 it has ended and a check probes.
  clock = 11500
  const remaining = outcomes.length
  await status.check()
  assert.equal(outcomes.length, remaining - 1)
})

test('after a restart the transport reads with the saved token; bootstrap still follows the injected key', async (t) => {
  const directory = await secretsDir(t)
  const seen: string[] = []
  const inventory = httpServer((request, response) => {
    seen.push(request.headers.authorization ?? '')
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"results":[]}')
  })
  inventory.listen(0, '127.0.0.1')
  await once(inventory, 'listening')
  t.after(() => inventory.close())
  const address = inventory.address() as { port: number }
  const readOrigin = `http://127.0.0.1:${address.port}`
  const restarted = devConfig({
    INTAKE_ORIGIN: 'http://127.0.0.1:4334',
    INTAKE_CREDENTIAL_REF: 'credential-fixture',
    INTAKE_DEV_API_KEY: ENVIRONMENT_TOKEN,
    INTAKE_SECRETS_DIR: directory,
  })
  const before = configureReadTarget(restarted, readOrigin, null)!
  await saveCredential(directory, PLANTED, before.binding)

  const saved = await loadSavedCredential(restarted.secretsDir, before.binding)
  const after = configureReadTarget(restarted, readOrigin, saved)!
  await after.transport.probe({
    targetId: restarted.targetId,
    contextId: restarted.targetContextId,
  })

  assert.deepEqual(seen, [`Token ${PLANTED}`])
  assert.equal(after.holder.state().credential_source, 'saved')
  assert.equal(bootstrap(restarted).status, 'configured')
  assert.ok(!JSON.stringify(bootstrap(restarted)).includes(PLANTED))
})

test('the server refuses to start with a saved token other users can read, without printing it', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED, TARGET)
  await chmod(join(directory, CREDENTIAL_FILE), 0o644)
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  const child = spawn(process.execPath, ['--import', tsx, 'src/main.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH,
      INTAKE_ORIGIN: 'http://127.0.0.1:4335',
      INTAKE_CREDENTIAL_REF: 'credential-fixture',
      INTAKE_DEV_API_KEY: ENVIRONMENT_TOKEN,
      INTAKE_READ_ORIGIN: TARGET.origin,
      INTAKE_SECRETS_DIR: directory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(30_000) })

  assert.equal(code, 1)
  assert.match(output, /"code":"secret_file_permissions"/)
  assert.ok(!output.includes(PLANTED))
})
