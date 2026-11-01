import fastifyStatic from '@fastify/static'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { schemas } from '@invimport/contracts'
import { registerMediaRoutes } from '../../src/media/routes.ts'
import { grantMedia } from '../../src/media/grants.ts'
import type { BlobStore } from '../../src/media/blob-store.ts'
import { manualRepository } from '../../src/review/repository.ts'
import { randomUUID } from 'node:crypto'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { createServer } from '../../src/api/server.ts'
import { registerCapture } from '../../src/capture/routes.ts'
import { lockCaptureForEdit } from '../../src/capture/repository.ts'
import { registerProcessing } from '../../src/processing/routes.ts'
import { grantProcessing } from '../../src/processing/grants.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantCapture } from '../../src/capture/grants.ts'
import { database } from '../../src/db/database.ts'
import { isolatedDatabase, seedAuthority } from './database.ts'

export interface ProcessingWebOptions {
  port?: number
  assets?: string
  mediaStore?: BlobStore
  readOnlyInventoryActivity?: boolean
}

/** Owned synthetic roles and manual evidence only; no target/provider transport is constructed. */
export async function processingFixture(options: { autoStart?: boolean } = {}) {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const runtimeRoles: string[] = []
  const connections: ReturnType<typeof database>[] = []

  async function createRole(purpose: 'api' | 'runner' | 'scheduler') {
    const name = `intake_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    await db.pool.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
    )
    runtimeRoles.push(name)
    if (purpose === 'api') {
      await grantFoundation(db.pool, name)
      await grantCapture(db.pool, name)
      await grantProcessing(db.pool, name, 'api')
    } else if (purpose === 'runner') {
      await grantProcessing(db.pool, name, 'runner')
    } else {
      await db.pool.query(`GRANT CREATE ON DATABASE ${db.name} TO ${name}`)
    }

    const url = new URL(db.url)
    url.username = name
    url.password = password
    const connection = database(url.toString())
    connections.push(connection)
    return { name, url: url.toString(), ...connection }
  }

  const api = await createRole('api')
  const runner = await createRole('runner')
  const scheduler = await createRole('scheduler')
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    channelSecret: `synthetic-channel-${randomUUID()}`,
    credentialRef: 'processing_fixture',
    apiKey: 'synthetic-unused-no-target-transport',
  }
  let app: ReturnType<typeof createServer> | undefined
  let csrfToken = ''

  async function start(web: ProcessingWebOptions = {}) {
    if (app) {
      throw new Error('processing_fixture_already_started')
    }
    if (web.assets) {
      await access(join(web.assets, 'index.html'))
    }
    if (web.mediaStore) {
      await grantMedia(db.pool, api.name, 'api')
    }
    app = createServer(config, { mediaEnabled: web.mediaStore !== undefined })
    registerCapture(app, api.pool, config)
    registerProcessing(app, api.pool, config, lockCaptureForEdit)
    if (web.mediaStore) {
      registerMediaRoutes(app, api.pool, config, web.mediaStore)
    }
    if (web.readOnlyInventoryActivity) {
      const inventory = manualRepository(db.pool, config)
      app.get('/api/v1/activity', { schema: { response: { 200: schemas.ManualActivity } } }, () =>
        inventory.activity(),
      )
    }
    if (web.assets) {
      await app.register(fastifyStatic, { root: web.assets, index: 'index.html', dotfiles: 'deny' })
    }
    config.origin = await app.listen({ host: '127.0.0.1', port: web.port ?? 0 })
    const bootstrap = await fetch(`${config.origin}/api/v1/bootstrap`)
    csrfToken = (await bootstrap.json()).csrf_token
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
        'x-intake-csrf': csrfToken,
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }

  async function seedCapture() {
    const created = await http('/batches', {
      title: 'Synthetic manual processing',
      note: 'Keep the two physical packets separate.',
    })
    if (created.status !== 201) {
      throw new Error('processing_fixture_capture_failed')
    }
    let batch = created.value as CaptureSnapshotDto

    async function edit(change: CaptureEditDto['change']) {
      const response = await http(`/batches/${batch.id}/edits`, {
        expected_revision: batch.revision,
        change,
      })
      if (response.status !== 200) {
        throw new Error(`processing_fixture_edit_failed:${response.status}`)
      }
      batch = response.value
    }

    await edit({
      kind: 'add_lot',
      label: 'Packet A',
      note: 'Label says approximately 20. Human count unresolved.',
      part_subject_id: null,
    })
    await edit({
      kind: 'add_lot',
      label: 'Packet B',
      note: 'Human counted 23.',
      part_subject_id: null,
    })
    const packetA = batch.lots.find((lot) => lot.label === 'Packet A')!
    const packetB = batch.lots.find((lot) => lot.label === 'Packet B')!
    await edit({ kind: 'lot', id: packetB.id, quantity: { mode: 'set', value: '23' } })
    return {
      get batch() {
        return batch
      },
      packetA,
      packetB,
      edit,
    }
  }

  if (options.autoStart !== false) {
    await start()
  }
  return {
    db,
    identity,
    api,
    runner,
    scheduler,
    config,
    http,
    start,
    stop,
    seedCapture,
    async dispose() {
      await stop()
      for (const connection of connections) {
        await connection.close()
      }
      for (const name of runtimeRoles.reverse()) {
        await db.pool.query(`DROP OWNED BY ${name} CASCADE`)
        await db.pool.query(`DROP ROLE ${name}`)
      }
      await db.dispose()
    },
  }
}
