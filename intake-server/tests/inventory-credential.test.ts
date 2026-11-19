import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '#/api/server.ts'
import { bootstrap, devConfig } from '#/config.ts'
import { connectionStatus } from '#/header/connection.ts'
import { CredentialHolder } from '#/inventory/credential.ts'
import {
  CREDENTIAL_FILE,
  deleteCredential,
  loadSavedCredential,
  saveCredential,
} from '#/inventory/credential-store.ts'
import {
  registerInventoryCredential,
  type InventoryCredentialRoutes,
} from '#/inventory/credential-routes.ts'
import { inventoryTransport } from '#/inventory/transport.ts'

const ENVIRONMENT_TOKEN = 'environment-token-synthetic'
// Planted so every response and log line can be searched for it.
const PLANTED = 'planted-replacement-0123456789abcdef'

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

async function credentialServer(routes: Partial<InventoryCredentialRoutes> = {}) {
  const app = createServer(config)
  const probes: string[] = []
  let changes = 0
  const holder = routes.holder ?? new CredentialHolder(ENVIRONMENT_TOKEN, null)
  registerInventoryCredential(app, {
    secretsDir: undefined,
    holder,
    probeWith: async (token) => {
      probes.push(token)
      return json(200)
    },
    changed: () => {
      changes += 1
    },
    ...routes,
  })
  // Reading bootstrap boots the server, so it comes after every route is registered.
  const csrf = await csrfToken(app)
  const headers = {
    host: '127.0.0.1:4334',
    origin: config.origin,
    'x-intake-csrf': csrf,
    'content-type': 'application/json',
  }
  return {
    app,
    holder,
    probes,
    changes: () => changes,
    replace: (token: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/inventory-credential',
        headers,
        payload: JSON.stringify({ token }),
      }),
    revert: () => {
      // No body, so no content type, as the browser client sends it.
      const { 'content-type': _json, ...bodyless } = headers
      return app.inject({
        method: 'DELETE',
        url: '/api/v1/inventory-credential',
        headers: bodyless,
      })
    },
  }
}

async function csrfToken(app: ReturnType<typeof createServer>) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { host: '127.0.0.1:4334' },
  })
  return (response.json() as { csrf_token: string }).csrf_token
}

test('a saved token is an owner-only file, written whole, in an owner-only directory', async (t) => {
  const directory = await secretsDir(t)

  const saved = await saveCredential(directory, PLANTED)

  const file = join(directory, CREDENTIAL_FILE)
  assert.equal(await readFile(file, 'utf8'), PLANTED)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.deepEqual(await readdir(directory), [CREDENTIAL_FILE], 'no temporary file is left')
  assert.deepEqual(await loadSavedCredential(directory), saved)
})

test('replacing a saved token swaps the file whole', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, 'first-token')

  await saveCredential(directory, PLANTED)

  assert.equal(await readFile(join(directory, CREDENTIAL_FILE), 'utf8'), PLANTED)
  assert.deepEqual(await readdir(directory), [CREDENTIAL_FILE])
})

test('a saved file or directory other users can read is refused, not used', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED)
  const file = join(directory, CREDENTIAL_FILE)

  await chmod(file, 0o644)
  await assert.rejects(loadSavedCredential(directory), { code: 'secret_file_permissions' })

  await chmod(file, 0o600)
  await chmod(directory, 0o750)
  await assert.rejects(loadSavedCredential(directory), { code: 'secret_file_permissions' })
})

test('a saved file that is not a token is refused', async (t) => {
  const directory = await secretsDir(t)
  await mkdir(directory, { mode: 0o700 })
  await writeFile(join(directory, CREDENTIAL_FILE), 'two words\n', { mode: 0o600 })

  await assert.rejects(loadSavedCredential(directory), { code: 'secret_file_invalid' })
})

test('without a secrets directory nothing is saved or loaded', async () => {
  assert.equal(await loadSavedCredential(undefined), null)
  await assert.rejects(saveCredential(undefined, PLANTED), { code: 'secret_store_unavailable' })
  await deleteCredential(undefined)
})

test('a relative secrets directory is refused at configuration', () => {
  assert.throws(
    () => devConfig({ INTAKE_SECRETS_DIR: 'secrets' }),
    new Error('invalid_secrets_directory'),
  )
})

test('Check and save probes the candidate first and saves only a token InvenTree accepts', async (t) => {
  const directory = await secretsDir(t)
  const server = await credentialServer({ secretsDir: directory })

  const response = await server.replace(PLANTED)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(server.probes, [PLANTED])
  const body = response.json() as { credential_source: string; credential_saved_at: string }
  assert.equal(body.credential_source, 'saved')
  assert.ok(!Number.isNaN(Date.parse(body.credential_saved_at)))
  assert.equal(server.holder.current(), PLANTED)
  assert.equal(server.changes(), 1)
  assert.equal(await readFile(join(directory, CREDENTIAL_FILE), 'utf8'), PLANTED)
  assert.ok(!response.body.includes(PLANTED))
})

test('a refused token or an unreachable InvenTree writes nothing and keeps the token in use', async (t) => {
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

  const refused = await refusing.replace(PLANTED)
  const failed = await unreachable.replace(PLANTED)

  assert.equal(refused.statusCode, 422)
  assert.equal((refused.json() as { code: string }).code, 'token_refused')
  assert.equal(failed.statusCode, 503)
  assert.equal((failed.json() as { code: string }).code, 'target_unavailable')
  for (const server of [refusing, unreachable]) {
    assert.equal(server.holder.current(), ENVIRONMENT_TOKEN)
    assert.equal(server.changes(), 0)
  }
  await assert.rejects(readdir(directory), { code: 'ENOENT' })
  assert.ok(!refused.body.includes(PLANTED) && !failed.body.includes(PLANTED))
})

test('without a secrets directory, replacement is refused before InvenTree is asked', async () => {
  const server = await credentialServer({ secretsDir: undefined })

  const response = await server.replace(PLANTED)

  assert.equal(response.statusCode, 503)
  assert.equal((response.json() as { code: string }).code, 'secret_store_unavailable')
  assert.deepEqual(server.probes, [])
  assert.equal(server.holder.current(), ENVIRONMENT_TOKEN)
})

test('Use the environment token deletes the saved file and reads use the environment token', async (t) => {
  const directory = await secretsDir(t)
  const saved = await saveCredential(directory, PLANTED)
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

test('token commands need the CSRF token and refuse malformed tokens without echoing them', async (t) => {
  const directory = await secretsDir(t)
  const server = await credentialServer({ secretsDir: directory })
  const spaced = `${PLANTED} with spaces`
  const long = 'x'.repeat(4097) + PLANTED

  const unauthorised = await server.app.inject({
    method: 'PUT',
    url: '/api/v1/inventory-credential',
    headers: { host: '127.0.0.1:4334', origin: config.origin, 'content-type': 'application/json' },
    payload: JSON.stringify({ token: PLANTED }),
  })
  const malformed = await server.replace(spaced)
  const tooLong = await server.replace(long)

  assert.equal(unauthorised.statusCode, 403)
  assert.equal(malformed.statusCode, 400)
  assert.ok([400, 413].includes(tooLong.statusCode))
  assert.deepEqual(server.probes, [])
  for (const response of [unauthorised, malformed, tooLong]) {
    assert.ok(!response.body.includes(PLANTED))
  }
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
      origin: 'https://inventory.example.invalid',
      targetId: binding.targetId,
      contextId: binding.targetContextId,
      protectedOrigins: ['https://inventory.example.invalid'],
      credential: ENVIRONMENT_TOKEN,
    },
    async (_url, init) => {
      sent.push(new Headers(init?.headers).get('authorization')!)
      await held
      return json(200)
    },
    () => holder.current(),
  )
  const target = { targetId: binding.targetId, contextId: binding.targetContextId }

  const inFlight = transport.probe(target)
  holder.replace({ token: PLANTED, savedAt: new Date().toISOString() })
  release()
  await inFlight
  await transport.probe(target)

  assert.deepEqual(sent, [`Token ${ENVIRONMENT_TOKEN}`, `Token ${PLANTED}`])
})

test('a reset drops the observation and the forced-check window, and an older probe never lands', async () => {
  const outcomes = [json(401), json(200)]
  let release: () => void = () => undefined
  const status = connectionStatus(binding, 'https://inventory.example.invalid/', async () => {
    const outcome = outcomes.shift()!
    if (outcome.status === 401) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    return outcome
  })

  const old = status.check()
  await new Promise((resolve) => setImmediate(resolve))
  status.reset()
  const fresh = status.check()
  release()

  assert.equal((await old).target.state, 'reachable')
  assert.equal((await fresh).target.state, 'reachable')
  assert.equal((await status()).target.failure_code, null)
})

test('a saved token survives a restart, and bootstrap still reflects only the injected key', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED)
  const restarted = devConfig({
    INTAKE_ORIGIN: 'http://127.0.0.1:4334',
    INTAKE_CREDENTIAL_REF: 'credential-fixture',
    INTAKE_SECRETS_DIR: directory,
  })

  const holder = new CredentialHolder('', await loadSavedCredential(restarted.secretsDir))

  assert.equal(holder.current(), PLANTED)
  assert.equal(bootstrap(restarted).status, 'setup_required')
  assert.ok(!JSON.stringify(bootstrap(restarted)).includes(PLANTED))
})

test('the server refuses to start with a saved token other users can read, without printing it', async (t) => {
  const directory = await secretsDir(t)
  await saveCredential(directory, PLANTED)
  await chmod(join(directory, CREDENTIAL_FILE), 0o644)
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  const child = spawn(process.execPath, ['--import', tsx, 'src/main.ts'], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH,
      INTAKE_ORIGIN: 'http://127.0.0.1:4335',
      INTAKE_CREDENTIAL_REF: 'credential-fixture',
      INTAKE_DEV_API_KEY: ENVIRONMENT_TOKEN,
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
