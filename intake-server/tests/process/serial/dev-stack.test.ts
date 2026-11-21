import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, access, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import sharp from 'sharp'
import { LIVE_PROTOCOL } from '@invimport/contracts'
import { processingCheckpoint } from '../../support/processing-process.ts'
import { database } from '#/db/database.ts'
import { provisionLegacyDevApi } from '../../support/dev-legacy.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
type Running = { supervisor: number; origin: string; children: { name: string; pid: number }[] }

async function freePort() {
  const socket = createServer()
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done))
  const port = (socket.address() as { port: number }).port
  await new Promise<void>((done) => socket.close(() => done()))
  return port
}

test(
  'one-command dev app preserves data, proxies HTTP/WS, processes media and reloads only code',
  { timeout: 180000 },
  async () => {
    assert.ok(process.env.INTAKE_TEST_ADMIN_URL)
    assert.match(process.env.INTAKE_MEDIA_DECODER_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bench-dev-stack-')))
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const source = join(repository, 'intake-server/src/dev/listen.ts')
    const original = await readFile(source)
    let modified = false
    let child: ChildProcess | undefined
    let output = ''
    let token = ''
    const running = async () =>
      JSON.parse(await readFile(join(root, 'running.json'), 'utf8')) as Running
    const pid = (state: Running, name: string) =>
      state.children.find((item) => item.name === name)!.pid
    async function start() {
      output = ''
      child = spawn(process.execPath, ['tooling/dev.cjs'], {
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
          // This test covers the per-stage synthetic Processing child.
          INTAKE_USE_AGENT_SESSIONS: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [child.stdout!, child.stderr!]) {
        stream.on('data', (bytes) => {
          output = (output + bytes.toString()).slice(-65536)
        })
      }
      await processingCheckpoint(
        async () => {
          assert.equal(child!.exitCode, null, output)
          return output
        },
        (text) => text.includes('Development app ready:'),
        45000,
      )
      const bootstrap = await request('/bootstrap')
      assert.equal(bootstrap.status, 200)
      token = bootstrap.value.csrf_token
    }
    async function request(path: string, body?: unknown) {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-intake-csrf': token,
          'idempotency-key': randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, value: await response.json() }
    }
    async function stop() {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        return
      }
      const exited = once(child, 'close', { signal: AbortSignal.timeout(45000) })
      child.kill('SIGTERM')
      const [code] = await exited
      assert.equal(code, 0, output)
    }
    try {
      await start()
      assert.equal((await fetch(origin)).status, 200)
      const connection = await request('/connection-status')
      assert.equal(connection.status, 200)
      assert.equal(connection.value.target.state, 'reachable', JSON.stringify(connection.value))
      const created = await request('/batches', {
        title: 'Retained full-stack smoke',
        note: 'Controlled synthetic note.',
      })
      assert.equal(created.status, 201)
      const batch = created.value
      const edited = await request(`/batches/${batch.id}/edits`, {
        expected_revision: batch.revision,
        change: { kind: 'add_part', label: 'Owned test subject' },
      })
      assert.equal(edited.status, 200)
      const png = await sharp(Buffer.from([10, 20, 30]), {
        raw: { width: 1, height: 1, channels: 3 },
      })
        .png()
        .toBuffer()
      const media = await request(`/batches/${batch.id}/media`)
      const upload = await fetch(`${origin}/api/v1/batches/${batch.id}/media/originals`, {
        method: 'POST',
        headers: {
          origin,
          'x-intake-csrf': token,
          'idempotency-key': randomUUID(),
          'content-type': 'application/octet-stream',
          'x-intake-media-revision': media.value.revision,
          'x-intake-media-label': 'Controlled PNG',
        },
        body: new Uint8Array(png),
      })
      assert.equal(upload.status, 200)
      await processingCheckpoint(
        async () => (await request(`/batches/${batch.id}/media`)).value,
        (value) =>
          value.evidence.some((entry: { versions: { state: string }[] }) =>
            entry.versions.some((version) => version.state === 'ready'),
          ),
        30000,
      )
      const capture = await request(`/batches/${batch.id}`)
      const started = await request(`/batches/${batch.id}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.value.revision,
        subject_ids: [edited.value.parts[0].id],
        stages: ['reading'],
      })
      assert.equal(started.status, 202, JSON.stringify(started.value))
      const completed = await processingCheckpoint(
        async () => (await request(`/batches/${batch.id}/processing`)).value,
        (value) => value.jobs[0].state === 'ready',
      )
      assert.match(completed.jobs[0].proposals[0].value.summary, /SYNTHETIC development result/)
      const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/v1/live`, {
        headers: { origin },
        handshakeTimeout: 5000,
      })
      try {
        await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
        const frame = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            protocol: LIVE_PROTOCOL,
            csrf_token: token,
            batch_id: batch.id,
            cursors: [],
          }),
        )
        assert.equal(JSON.parse((await frame)[0].toString()).type, 'ready')
      } finally {
        socket.terminate()
      }
      let current = (await request(`/batches/${batch.id}`)).value
      async function edit(change: unknown) {
        const result = await request(`/batches/${batch.id}/edits`, {
          expected_revision: current.revision,
          change,
        })
        assert.equal(result.status, 200, JSON.stringify(result.value))
        current = result.value
      }
      async function observe(model: string, pk: string) {
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
      await edit({ kind: 'part', id: current.parts[0].id, choice: await observe('part', '29') })
      await edit({ kind: 'defaults', location: await observe('location', '43') })
      await edit({
        kind: 'add_lot',
        label: 'Controlled counted packet',
        note: '17 counted pieces.',
        part_subject_id: current.parts[0].id,
      })
      const lot = current.lots[0]
      await edit({ kind: 'lot', id: lot.id, quantity: { mode: 'set', value: '17' } })
      const selection = { expected_batch_revision: current.revision, selected_lot_ids: [lot.id] }
      assert.equal((await request(`/batches/${batch.id}/reviews`, selection)).status, 200)
      const prepared = await request(`/batches/${batch.id}/preparations`, selection)
      assert.equal(prepared.value.status, 'prepared', JSON.stringify(prepared.value))
      const preview = prepared.value.preparation
      const approved = await request(`/preparations/${preview.id}/approvals`, {
        preparation_id: preview.id,
        expected_plan_sha256: preview.plan_sha256,
        expected_review_fingerprint: preview.review_fingerprint,
        selected_lot_ids: preview.selected_lot_ids,
        expected_target_revision: preview.target_revision,
      })
      assert.equal(approved.status, 200, JSON.stringify(approved.value))
      const run = (await request(`/runs/${approved.value.run_id}`)).value
      assert.equal(
        (await request(`/runs/${run.run_id}/start`, { expected_run_revision: run.revision }))
          .status,
        200,
      )
      const settled = await processingCheckpoint(
        async () => (await request(`/runs/${run.run_id}`)).value,
        (value) => value.state === 'settled_complete' && value.dispatch_state === 'finished',
      )
      assert.ok(
        settled.supported_effects.some(
          (effect: { kind: string; certainty: string }) =>
            effect.kind === 'create_stock' && effect.certainty === 'confirmed',
        ),
      )
      const before = await running()
      await writeFile(join(root, 'runtime.json'), '{"revision":7}')
      await writeFile(source, original)
      await delay(1000)
      assert.deepEqual(await running(), before)
      await writeFile(
        source,
        Buffer.concat([
          original,
          Buffer.from('\n// Controlled development source-reload qualification.\n'),
        ]),
      )
      modified = true
      const after = await processingCheckpoint(
        running,
        (value) => pid(value, 'api') !== pid(before, 'api'),
        30000,
      )
      assert.equal(pid(after, 'ui'), pid(before, 'ui'))
      assert.equal((await request(`/batches/${batch.id}`)).value.title, 'Retained full-stack smoke')
      await writeFile(
        source,
        Buffer.concat([original, Buffer.from('\nthis is invalid TypeScript !!!\n')]),
      )
      await processingCheckpoint(
        async () => output,
        (value) => value.includes('Application reload failed;'),
        30000,
      )
      assert.equal(child!.exitCode, null)
      await writeFile(source, original)
      modified = false
      await processingCheckpoint(running, (value) => pid(value, 'api') !== pid(after, 'api'), 30000)
      const final = await running()
      const beforeUpgradeMedia = (await request(`/batches/${batch.id}/media`)).value
      await stop()
      await assert.rejects(access(join(root, 'supervisor.lock')), { code: 'ENOENT' })
      for (const owned of final.children) {
        assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' })
      }
      await assert.rejects(fetch(origin))
      const legacy = await provisionLegacyDevApi(root, process.env.INTAKE_TEST_ADMIN_URL!)
      const legacyRuntime = database(legacy.apiUrl)
      try {
        await assert.rejects(legacyRuntime.pool.query('SELECT 1 FROM capture_context LIMIT 1'), {
          code: '42501',
        })
      } finally {
        await legacyRuntime.close()
      }
      const upgradeUploadKey = randomUUID()
      let legacyOutput = ''
      const legacyWeb = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
        cwd: join(repository, 'intake-server'),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          INTAKE_ORIGIN: origin,
          INTAKE_DATABASE_URL: legacy.apiUrl,
          INTAKE_ACTOR_ID: legacy.identity.actor,
          INTAKE_TARGET_ID: legacy.identity.target,
          INTAKE_TARGET_CONTEXT_ID: legacy.identity.context,
          INTAKE_CREDENTIAL_REF: 'owned_legacy_fixture',
          INTAKE_DEV_API_KEY: 'owned-fake-token',
          INTAKE_BLOB_ROOT: legacy.blobRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [legacyWeb.stdout!, legacyWeb.stderr!]) {
        stream.on('data', (bytes) => {
          legacyOutput = (legacyOutput + bytes.toString()).slice(-8192)
        })
      }
      try {
        await processingCheckpoint(
          async () => {
            assert.equal(legacyWeb.exitCode, null, legacyOutput)
            return legacyOutput
          },
          (value) => value.includes('"web_ready"'),
        )
        token = (await request('/bootstrap')).value.csrf_token
        const failedPhoto = await fetch(`${origin}/api/v1/batches/${batch.id}/media/originals`, {
          method: 'POST',
          headers: {
            origin,
            'x-intake-csrf': token,
            'idempotency-key': upgradeUploadKey,
            'content-type': 'application/octet-stream',
            'x-intake-media-revision': beforeUpgradeMedia.revision,
            'x-intake-media-label': 'Upgrade PNG',
          },
          body: new Uint8Array(png),
        })
        assert.equal(failedPhoto.status, 500)
      } finally {
        if (legacyWeb.exitCode === null && legacyWeb.signalCode === null) {
          const closed = once(legacyWeb, 'close', { signal: AbortSignal.timeout(10000) })
          legacyWeb.kill('SIGTERM')
          assert.equal((await closed)[0], 0)
        }
      }
      await start()
      assert.equal((await request(`/batches/${batch.id}`)).value.title, 'Retained full-stack smoke')
      const mediaAfterUpgrade = await request(`/batches/${batch.id}/media`)
      assert.equal(mediaAfterUpgrade.status, 200)
      assert.equal(mediaAfterUpgrade.value.revision, beforeUpgradeMedia.revision)
      const photoAfterUpgrade = await fetch(
        `${origin}/api/v1/batches/${batch.id}/media/originals`,
        {
          method: 'POST',
          headers: {
            origin,
            'x-intake-csrf': token,
            'idempotency-key': upgradeUploadKey,
            'content-type': 'application/octet-stream',
            'x-intake-media-revision': mediaAfterUpgrade.value.revision,
            'x-intake-media-label': 'Upgrade PNG',
          },
          body: new Uint8Array(png),
        },
      )
      assert.equal(photoAfterUpgrade.status, 200)
      const received = await photoAfterUpgrade.json()
      await processingCheckpoint(
        async () => (await request(`/batches/${batch.id}/media`)).value,
        (value) =>
          value.evidence.some(
            (entry: { id: string; versions: { state: string }[] }) =>
              entry.id === received.evidence_id &&
              entry.versions.some((version) => version.state === 'ready'),
          ),
      )
      const groupInput = (await request(`/batches/${batch.id}/media`)).value
      const grouped = await request(`/batches/${batch.id}/media/commands`, {
        expected_revision: groupInput.revision,
        change: { kind: 'group', label: 'New group after upgrade' },
      })
      assert.equal(grouped.status, 200, JSON.stringify(grouped.value))
      await stop()
    } finally {
      if (modified) {
        await writeFile(source, original)
      }
      await stop()
    }
  },
)
