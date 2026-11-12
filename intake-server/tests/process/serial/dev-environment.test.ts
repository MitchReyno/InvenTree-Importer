import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as portServer } from 'node:net'
import { database } from '#/db/database.ts'
import { processingCheckpoint } from '../../support/processing-process.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

async function freePort() {
  const server = portServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function controlledInventory() {
  const requests: { method: string; path: string; authorization: string | undefined }[] = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method!,
      path: request.url!,
      authorization: request.headers.authorization,
    })
    const url = new URL(request.url!, 'http://controlled.invalid')
    response.setHeader('content-type', 'application/json')
    if (request.method !== 'GET') {
      response.writeHead(405).end('{}')
      return
    }
    if (url.pathname === '/api/part/') {
      response.end(
        JSON.stringify({
          count: 1,
          next: null,
          previous: null,
          results: [{ pk: 29, name: 'Controlled existing Part' }],
        }),
      )
      return
    }
    const match = /^\/api\/(part|stock\/location)\/([1-9][0-9]*)\/$/.exec(url.pathname)
    if (match) {
      response.end(JSON.stringify({ pk: match[2], name: 'Controlled existing record', tags: [] }))
      return
    }
    response.writeHead(404).end('{}')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    origin,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

test(
  'dotenv selects a retained read-only target without fake/apply processes, external token persistence or cross-target reuse',
  { timeout: 120000 },
  async () => {
    assert.ok(process.env.INTAKE_TEST_ADMIN_URL)
    assert.match(process.env.INTAKE_MEDIA_DECODER_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/)
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'bench-dev-env-')))
    const root = join(directory, 'app')
    const envFile = join(directory, 'synthetic.env')
    const target = await controlledInventory()
    const other = await controlledInventory()
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const key = 'synthetic-read-token-never-public'
    const writeSettings = async (targetLines: string[]) =>
      writeFile(
        envFile,
        [
          `INTAKE_APP_STATE="${root}"`,
          `INTAKE_DEV_PORT=${port}`,
          ...targetLines,
          'OPENAI_API_KEY=synthetic-provider-must-not-run',
          `INTAKE_MEDIA_DECODER_IMAGE=${process.env.INTAKE_MEDIA_DECODER_IMAGE}`,
        ].join('\n'),
        { mode: 0o600 },
      )
    const externalTarget = (targetOrigin: string) => [
      `INTAKE_INVENTREE_URL=${targetOrigin}`,
      'INTAKE_CREDENTIAL_REF=controlled_readonly',
      `INTAKE_INVENTREE_TOKEN=${key}`,
    ]
    let child: ChildProcess | undefined
    let output = ''
    let csrf = ''
    async function request(path: string, body?: unknown) {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-intake-csrf': csrf,
          'idempotency-key': randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, value: await response.json() }
    }
    async function start(expectReady = true) {
      output = ''
      child = spawn(process.execPath, ['tooling/dev.cjs'], {
        cwd: repository,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          INTAKE_ENV_FILE: envFile,
          INTAKE_DEV_ADMIN_URL: process.env.INTAKE_TEST_ADMIN_URL,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [child.stdout!, child.stderr!]) {
        stream.on('data', (bytes) => {
          output = (output + bytes.toString()).slice(-65536)
        })
      }
      if (!expectReady) {
        const [code] = await once(child, 'close', { signal: AbortSignal.timeout(30000) })
        assert.notEqual(code, 0)
        assert.equal(output.includes(key), false)
        return
      }
      await processingCheckpoint(
        async () => {
          assert.equal(child!.exitCode, null, output)
          return output
        },
        (value) => value.includes('Development app ready:'),
        45000,
      )
      csrf = (await request('/bootstrap')).value.csrf_token
    }
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close', { signal: AbortSignal.timeout(45000) })
        child.kill('SIGTERM')
        const [code] = await closed
        assert.equal(code, 0, output)
      }
    }
    try {
      await writeSettings(externalTarget(target.origin))
      await start()
      const connection = await request('/connection-status')
      assert.equal(connection.status, 200)
      assert.equal(connection.value.target.state, 'reachable')
      assert.equal(connection.value.target.kind, 'configured')
      assert.equal(connection.value.target.navigation_url, target.origin + '/')
      for (const suffix of ['', '?raw']) {
        const blocked = await fetch(`${origin}/@fs${envFile}${suffix}`)
        assert.equal(blocked.status, 403)
        assert.equal((await blocked.text()).includes(key), false)
      }
      const running = JSON.parse(await readFile(join(root, 'running.json'), 'utf8'))
      // The default scripted sessions run in the session worker.
      assert.deepEqual(running.children.map((item: { name: string }) => item.name).sort(), [
        'agents',
        'api',
        'media',
        'ui',
      ])
      assert.match(output, /Processing: synthetic-session\/1\./)
      const stateBytes = await readFile(join(root, 'app.json'), 'utf8')
      const state = JSON.parse(stateBytes)
      assert.equal(state.version, 2)
      assert.equal(stateBytes.includes(key), false)
      assert.equal(stateBytes.includes('synthetic-provider'), false)
      assert.equal(output.includes(key), false)
      const db = database(state.apiUrl)
      try {
        assert.equal(
          (await db.pool.query('SELECT count(*)::text AS count FROM executor_deployment')).rows[0]
            .count,
          '0',
        )
        assert.equal(
          (await db.pool.query('SELECT profile FROM target WHERE id=$1', [state.identity.target]))
            .rows[0].profile,
          'protected-read-only',
        )
      } finally {
        await db.close()
      }
      const created = await request('/batches', {
        title: 'Readonly target context',
        note: 'Controlled human note.',
      })
      assert.equal(created.status, 201, JSON.stringify(created.value))
      let batch = created.value
      async function edit(change: unknown) {
        const result = await request(`/batches/${batch.id}/edits`, {
          expected_revision: batch.revision,
          change,
        })
        assert.equal(result.status, 200, JSON.stringify(result.value))
        batch = result.value
      }
      await edit({ kind: 'add_part', label: 'Existing controlled Part' })
      const part = batch.parts[0].id
      async function observed(model: string, pk: string) {
        const result = await request(`/batches/${batch.id}/observations`, { model, pk })
        assert.equal(result.status, 201)
        return {
          mode: 'set',
          value: {
            observation_id: result.value.id,
            target_context_id: result.value.target_context_id,
            model,
            pk: result.value.pk,
          },
        }
      }
      await edit({ kind: 'part', id: part, choice: await observed('part', '29') })
      await edit({ kind: 'defaults', location: await observed('location', '43') })
      await edit({
        kind: 'add_lot',
        label: 'Counted physical packet',
        note: '17 counted pieces.',
        part_subject_id: part,
      })
      const lot = batch.lots[0].id
      await edit({ kind: 'lot', id: lot, quantity: { mode: 'set', value: '17' } })
      const selection = { expected_batch_revision: batch.revision, selected_lot_ids: [lot] }
      const preparation = await request(`/batches/${batch.id}/preparations`, selection)
      assert.equal(preparation.status, 200)
      assert.notEqual(preparation.value.status, 'prepared')
      assert.ok(
        preparation.value.issues.some(
          (issue: { code: string }) => issue.code === 'unsupported_capability',
        ),
        JSON.stringify(preparation.value),
      )
      assert.ok(target.requests.some((value) => value.path === '/api/part/?limit=1'))
      assert.ok(target.requests.some((value) => value.path.startsWith('/api/part/29/')))
      assert.ok(
        target.requests.every(
          (value) => value.method === 'GET' && value.authorization === `Token ${key}`,
        ),
      )
      assert.equal(JSON.stringify(connection.value).includes(key), false)
      await stop()
      await start()
      assert.equal((await request(`/batches/${batch.id}`)).value.title, 'Readonly target context')
      await stop()
      const requestCount = target.requests.length
      await writeSettings(externalTarget(other.origin))
      await start(false)
      assert.equal(target.requests.length, requestCount)
      assert.equal(other.requests.length, 0)
      assert.deepEqual(
        JSON.parse(await readFile(join(root, 'app.json'), 'utf8')).target,
        state.target,
      )
      await writeSettings([
        'INTAKE_TARGET_PROFILE=read-only',
        `INTAKE_READ_ORIGIN=${target.origin}`,
        'INTAKE_CREDENTIAL_REF=controlled_readonly',
        `INTAKE_DEV_API_KEY=${key}`,
      ])
      await start(false)
      assert.match(output, /retired_development_setting/)
      assert.match(output, /INTAKE_DEV_API_KEY: use INTAKE_INVENTREE_TOKEN/)
      assert.equal(target.requests.length, requestCount)
      assert.equal(await readFile(join(root, 'app.json'), 'utf8'), stateBytes)
    } finally {
      await stop()
      await target.close()
      await other.close()
    }
  },
)

test(
  'standalone dev API reads a caller-relative explicit env file through the same server-only loader',
  { timeout: 30000 },
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'bench-api-env-')))
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const token = 'synthetic-api-only-never-client'
    await writeFile(
      join(directory, 'standalone.env'),
      `INTAKE_ORIGIN=${origin}\nINTAKE_CREDENTIAL_REF=standalone_fixture\nINTAKE_DEV_API_KEY=${token}\nNODE_OPTIONS=--require=poison\n`,
      { mode: 0o600 },
    )
    const child = spawn(process.execPath, ['../tooling/dev/api.cjs'], {
      cwd: join(repository, 'intake-server'),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        INIT_CWD: directory,
        INTAKE_ENV_FILE: 'standalone.env',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    for (const stream of [child.stdout!, child.stderr!]) {
      stream.on('data', (bytes) => {
        output = (output + bytes.toString()).slice(-8192)
      })
    }
    try {
      await processingCheckpoint(
        async () => {
          assert.equal(child.exitCode, null, output)
          return output
        },
        (value) => value.includes('"web_ready"'),
      )
      const response = await fetch(`${origin}/api/v1/bootstrap`)
      assert.equal(response.status, 200)
      const bytes = await response.text()
      assert.equal(JSON.parse(bytes).status, 'configured')
      assert.equal(bytes.includes(token), false)
      assert.equal(output.includes(token), false)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close', { signal: AbortSignal.timeout(10000) })
        child.kill('SIGTERM')
        assert.equal((await closed)[0], 0)
      }
    }
  },
)

test(
  'a read-only mock runs scripted sessions with the mock inventory but no apply runner or deployment',
  { timeout: 120000 },
  async () => {
    assert.ok(process.env.INTAKE_TEST_ADMIN_URL)
    assert.match(process.env.INTAKE_MEDIA_DECODER_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bench-dev-readonly-mock-')))
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    let output = ''
    let csrf = ''
    const child = spawn(process.execPath, ['tooling/dev.cjs'], {
      cwd: repository,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        INTAKE_ENV_FILE: '',
        INTAKE_APP_STATE: root,
        INTAKE_DEV_PORT: String(port),
        INTAKE_DEV_ADMIN_URL: process.env.INTAKE_TEST_ADMIN_URL,
        INTAKE_MEDIA_DECODER_IMAGE: process.env.INTAKE_MEDIA_DECODER_IMAGE,
        INTAKE_INVENTREE_READ_ONLY: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const stream of [child.stdout!, child.stderr!]) {
      stream.on('data', (bytes) => {
        output = (output + bytes.toString()).slice(-65536)
      })
    }

    async function request(path: string, body?: unknown) {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-intake-csrf': csrf,
          'idempotency-key': randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, value: await response.json() }
    }

    try {
      await processingCheckpoint(
        async () => {
          assert.equal(child.exitCode, null, output)
          return output
        },
        (value) => value.includes('Development app ready:'),
        60000,
      )
      csrf = (await request('/bootstrap')).value.csrf_token
      assert.match(output, /Inventory: mock \(read-only\)\./)
      assert.match(output, /Processing: synthetic-session\/1\./)
      const running = JSON.parse(await readFile(join(root, 'running.json'), 'utf8'))
      assert.deepEqual(running.children.map((item: { name: string }) => item.name).sort(), [
        'agents',
        'api',
        'inventory',
        'media',
        'ui',
      ])
      const connection = await request('/connection-status')
      assert.equal(connection.value.target.kind, 'owned_test', JSON.stringify(connection.value))

      const created = await request('/batches', { title: 'Read-only mock', note: 'Controlled.' })
      assert.equal(created.status, 201, JSON.stringify(created.value))
      let batch = created.value
      async function edit(change: unknown) {
        const result = await request(`/batches/${batch.id}/edits`, {
          expected_revision: batch.revision,
          change,
        })
        assert.equal(result.status, 200, JSON.stringify(result.value))
        batch = result.value
      }
      await edit({ kind: 'add_part', label: 'Mock part' })
      await edit({
        kind: 'add_lot',
        label: 'Counted packet',
        note: '5 counted pieces.',
        part_subject_id: batch.parts[0].id,
      })
      const lot = batch.lots[0].id
      await edit({ kind: 'lot', id: lot, quantity: { mode: 'set', value: '5' } })
      const preparation = await request(`/batches/${batch.id}/preparations`, {
        expected_batch_revision: batch.revision,
        selected_lot_ids: [lot],
      })
      assert.equal(preparation.status, 200, JSON.stringify(preparation.value))
      assert.notEqual(preparation.value.status, 'prepared')
      // Without a deployment the API cannot authorize an effect, as for a real server.
      assert.ok(
        preparation.value.issues.some(
          (issue: { code: string }) => issue.code === 'unsupported_capability',
        ),
        JSON.stringify(preparation.value),
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close', { signal: AbortSignal.timeout(45000) })
        child.kill('SIGTERM')
        const [code] = await closed
        assert.equal(code, 0, output)
      }
    }
  },
)
