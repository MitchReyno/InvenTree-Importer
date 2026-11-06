import { registerLive } from '../../src/live/routes.ts'
import { registerProcessing } from '../../src/processing/routes.ts'
import { registerAttention } from '../../src/attention/routes.ts'
import { attentionReader } from '../../src/attention/reader.ts'
import { registerRecords } from '../../src/records/routes.ts'
import { recordsReader } from '../../src/records/reader.ts'
import { grantProcessing } from '../../src/processing/grants.ts'
import { lockCaptureForEdit } from '../../src/capture/repository.ts'
import {
  EFFECTS_BUILD,
  EFFECTS_CAPABILITY,
  RECORD_EFFECTS_BUILD,
  RECORD_EFFECTS_CAPABILITY,
} from '../../src/execution/effects-plan.ts'
import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { realpath } from 'node:fs/promises'
import { BlobStore } from '../../src/media/blob-store.ts'
import { grantMedia } from '../../src/media/grants.ts'
import { registerMediaRoutes } from '../../src/media/routes.ts'
import { MEDIA_CAPABILITY, MEDIA_EXECUTOR_BUILD } from '../../src/execution/media-plan.ts'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CaptureEditDto,
  CaptureObservationDto,
  CaptureSnapshotDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { isolatedDatabase, seedAuthority } from './database.ts'
import { inventoryFake } from '../fixtures/inventory-fake.ts'
import { database } from '../../src/db/database.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantCapture } from '../../src/capture/grants.ts'
import { grantManual } from '../../src/review/grants.ts'
import { durableExclusive } from '../../src/execution/ownership.ts'
import { CAPABILITY, EXECUTOR_BUILD } from '../../src/execution/plan.ts'
import { createServer } from '../../src/api/server.ts'
import { registerCapture } from '../../src/capture/routes.ts'
import { registerManual } from '../../src/review/routes.ts'
import { captureRead } from '../../src/capture/read.ts'
import type { TargetProfile } from '../../src/inventory/transport.ts'
import { inventoryTransport } from '../../src/inventory/transport.ts'
import type { ManualRunnerConfig } from '../../src/review/runner.ts'

/** Only fresh synthetic roles/credentials and random isolated databases on the shared owned PG. */
export async function manualFixture(
  options: {
    media?: boolean
    effects?: boolean
    records?: boolean
    /** Also serves synthetic Processing on the same disposable database, for connected journeys. */
    processing?: boolean
    retainedRoot?: string
  } = {},
) {
  // Record creation is a separate `/2` deployment; it includes every `/1` effect.
  const effectsCapability = options.records
    ? RECORD_EFFECTS_CAPABILITY
    : options.effects
      ? EFFECTS_CAPABILITY
      : undefined
  const db = await isolatedDatabase(options.retainedRoot ? { retainedDev: true } : {})
  const identity = await seedAuthority(db.pool)
  const root = options.retainedRoot
    ? await realpath(options.retainedRoot)
    : await realpath(await mkdtemp(join(tmpdir(), 'bench-manual-')))
  const build = options.records
    ? RECORD_EFFECTS_BUILD
    : options.effects
      ? EFFECTS_BUILD
      : options.media
        ? MEDIA_EXECUTOR_BUILD
        : EXECUTOR_BUILD
  const capability = effectsCapability
    ? effectsCapability
    : options.media
      ? MEDIA_CAPABILITY
      : CAPABILITY
  const blobRoot = join(root, 'blobs')
  const store = options.media
    ? await BlobStore.initialize(blobRoot, await readMediaStoreIdentity(db.pool))
    : undefined
  const roles: string[] = []
  const connections: ReturnType<typeof database>[] = []
  let fake = await inventoryFake(db.pool, 0, true, options.media, Boolean(effectsCapability))
  const deploymentId = randomUUID()
  const epoch = randomUUID()
  await db.pool.query('INSERT INTO executor_deployment VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
    deploymentId,
    epoch,
    identity.target,
    identity.context,
    fake.origin,
    'manual-owned-fake-1',
    build,
    capability,
  ])
  const gateRoot = join(root, 'gate')
  await mkdir(gateRoot, { mode: 0o700 })
  await mkdir(join(gateRoot, 'witnesses'), { mode: 0o700 })
  await durableExclusive(
    join(gateRoot, 'activation.json'),
    canonical({
      enabled: true,
      deploymentId,
      epoch,
      targetId: identity.target,
      contextId: identity.context,
      origin: fake.origin,
      continuity: 'manual-owned-fake-1',
      build,
      capability,
    }),
  )
  async function role(purpose: 'api' | 'runner' | 'apply' | 'scheduler' | 'processing') {
    const name = `intake_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    roles.push(name)
    await db.pool.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 6`,
    )
    if (purpose === 'api') {
      await grantFoundation(db.pool, name)
      await grantCapture(db.pool, name)
      await db.pool.query(`GRANT SELECT ON processing_job,processing_question TO ${name}`)
      if (options.media) {
        await grantMedia(db.pool, name, 'api')
      }
      if (options.processing) {
        await grantProcessing(db.pool, name, 'api')
      }
    }
    if (purpose === 'processing') {
      await grantProcessing(db.pool, name, 'runner')
    } else if (purpose === 'scheduler') {
      await db.pool.query(`GRANT CREATE ON DATABASE ${db.name} TO ${name}`)
    } else {
      await grantManual(db.pool, name, purpose)
    }
    const url = new URL(db.url)
    url.username = name
    url.password = password
    const connection = database(url.toString())
    connections.push(connection)
    return { name, url: url.toString(), ...connection }
  }
  const api = await role('api')
  const runner = await role('runner')
  const apply = await role('apply')
  const scheduler = await role('scheduler')
  const processingRunner = options.processing ? await role('processing') : undefined
  const profile: TargetProfile = {
    kind: 'owned-disposable' as const,
    targetId: identity.target,
    contextId: identity.context,
    origin: fake.origin,
    protectedOrigins: ['https://protected.invalid'],
    credential: 'owned-fake-token',
    ...(options.media ? { attachmentCapability: MEDIA_CAPABILITY } : {}),
    ...(effectsCapability ? { effectsCapability } : {}),
  }
  const runnerConfig: ManualRunnerConfig = {
    runnerDatabaseUrl: runner.url,
    schedulerDatabaseUrl: scheduler.url,
    applyDatabaseUrl: apply.url,
    gateRoot,
    deploymentId,
    profile,
    ...(options.media ? { mediaBlobRoot: blobRoot } : {}),
  }
  const runnerConfigPath = join(root, 'runner.json')
  await writeFile(runnerConfigPath, JSON.stringify(runnerConfig), { mode: 0o600 })
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    credentialRef: 'owned_manual_fixture',
    apiKey: 'owned-fake-token',
    deploymentId,
    readOrigin: fake.origin,
    ...(options.media ? { mediaEnabled: true } : {}),
    ...(options.processing ? { channelSecret: `synthetic-channel-${randomUUID()}` } : {}),
  }
  const transport = inventoryTransport({ ...profile, kind: 'protected-read-only' })
  const read = captureRead((operation) =>
    transport.read({ targetId: identity.target, contextId: identity.context }, operation),
  )
  let app: ReturnType<typeof createServer> | undefined
  let token = ''
  async function start() {
    app = createServer(config, { mediaEnabled: Boolean(store) })
    registerLive(app, api.pool, config)
    registerCapture(app, api.pool, config, read)
    registerManual(app, api.pool, config, read, {
      metadata: (pk) =>
        transport.readPartAttachmentMetadata(
          { targetId: identity.target, contextId: identity.context },
          pk,
        ),
      file: (input) =>
        transport.readPartAttachmentFile(
          { targetId: identity.target, contextId: identity.context },
          input,
        ),
    })
    if (store) {
      registerMediaRoutes(app, api.pool, config, store)
    }
    registerRecords(
      app,
      config,
      recordsReader(
        api.pool,
        config,
        options.processing ? (config as never) : undefined,
        lockCaptureForEdit,
        Boolean(store),
      ),
    )
    if (options.processing) {
      registerProcessing(app, api.pool, config as never, lockCaptureForEdit)
      registerAttention(
        app,
        config,
        attentionReader(api.pool, config, config as never, lockCaptureForEdit),
      )
    }
    config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
    await authenticate()
  }
  async function authenticate() {
    token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json()).csrf_token
  }
  async function stop() {
    await app?.close()
    app = undefined
  }
  async function http(path: string, body?: unknown, key = randomUUID()) {
    const response = await fetch(`${config.origin}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }
  await start()
  return {
    db,
    store,
    identity,
    root,
    gateRoot,
    config,
    api,
    runner,
    apply,
    scheduler,
    runnerConfig,
    runnerConfigPath,
    processingRunner,
    http,
    start,
    stop,
    authenticate,
    get fake() {
      return fake
    },
    async restartFake() {
      const port = fake.port
      await fake.close()
      fake = await inventoryFake(db.pool, port, true, options.media, Boolean(effectsCapability))
    },
    async seedCapture() {
      const created = await http('/batches', {
        title: 'Two physical packets',
        note: 'Human counted A=17 and B=23. Keep original contributions separate.',
      })
      if (created.status !== 201) {
        throw new Error(`manual_fixture_create_failed:${JSON.stringify(created.value)}`)
      }
      let batch = created.value as CaptureSnapshotDto
      async function edit(change: CaptureEditDto['change']) {
        const result = await http(`/batches/${batch.id}/edits`, {
          expected_revision: batch.revision,
          change,
        })
        if (result.status !== 200) {
          throw new Error(`manual_fixture_edit_failed:${JSON.stringify(result.value)}`)
        }
        batch = result.value
      }
      await edit({ kind: 'add_part', label: 'Shared existing resistor' })
      const partId = batch.parts[0].id
      await edit({
        kind: 'add_lot',
        label: 'Packet A',
        note: '17 counted pieces.',
        part_subject_id: partId,
      })
      await edit({
        kind: 'add_lot',
        label: 'Packet B',
        note: '23 counted pieces.',
        part_subject_id: partId,
      })
      const a = batch.lots.find((value) => value.label === 'Packet A')!
      const b = batch.lots.find((value) => value.label === 'Packet B')!
      async function observe(model: 'part' | 'location', pk: string) {
        const result = await http(`/batches/${batch.id}/observations`, { model, pk })
        if (result.status !== 201) {
          throw new Error('manual_fixture_observation_failed')
        }
        const observation = result.value as CaptureObservationDto
        return {
          mode: 'set' as const,
          value: {
            observation_id: observation.id,
            target_context_id: observation.target_context_id,
            model,
            pk: observation.pk,
          },
        }
      }
      await edit({ kind: 'part', id: partId, choice: await observe('part', '29') })
      await edit({ kind: 'defaults', location: await observe('location', '43') })
      await edit({ kind: 'lot', id: a.id, quantity: { mode: 'set', value: '17' } })
      await edit({
        kind: 'lot',
        id: b.id,
        quantity: { mode: 'set', value: '23' },
        location: await observe('location', '48'),
      })
      return {
        get batch() {
          return batch
        },
        a,
        b,
        partId,
        edit,
      }
    },
    async dispose() {
      await stop()
      await fake.close()
      for (const connection of connections) {
        await connection.close()
      }
      for (const name of [...roles].reverse()) {
        await db.pool.query(`DROP OWNED BY ${name} CASCADE`)
        await db.pool.query(`DROP ROLE ${name}`)
      }
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
