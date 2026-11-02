import { createServer } from './api/server.ts'
import { devConfig, processingConfig } from './config.ts'
import { database } from './db/database.ts'
import type { Pool } from 'pg'
import { readMediaStoreIdentity } from './media/store-identity.ts'
import { registerCapture } from './capture/routes.ts'
import { lockCaptureForEdit } from './capture/repository.ts'
import { registerProcessing } from './processing/routes.ts'
import { BlobStore } from './media/blob-store.ts'
import { registerMediaRoutes } from './media/routes.ts'
import { captureRead } from './capture/read.ts'
import { registerManual } from './review/routes.ts'
import { inventoryTransport } from './inventory/transport.ts'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Explicit opt-in only; never discovers a default directory or initializes without a DB. */
async function configuredMediaStore(env: NodeJS.ProcessEnv, pool?: Pool) {
  const root = env.INTAKE_BLOB_ROOT
  if (root === undefined) {
    return undefined
  }
  if (!pool) {
    throw new Error('media_database_required')
  }
  if (root.length === 0) {
    throw new Error('media_root_required')
  }

  const storeId = await readMediaStoreIdentity(pool)
  return BlobStore.initialize(root, storeId)
}

const config = devConfig(process.env)
const db = process.env.INTAKE_DATABASE_URL ? database(process.env.INTAKE_DATABASE_URL) : undefined
const mediaStore = await configuredMediaStore(process.env, db?.pool)
const server = createServer(config, { mediaEnabled: mediaStore !== undefined })
if (db) {
  server.addHook('onClose', () => db.close())
  // Only the read closure crosses the capture boundary. No browser-supplied origin/key.
  const transport =
    process.env.INTAKE_READ_ORIGIN && config.apiKey
      ? inventoryTransport({
          kind: 'protected-read-only',
          origin: process.env.INTAKE_READ_ORIGIN,
          targetId: config.targetId,
          contextId: config.targetContextId,
          protectedOrigins: [process.env.INTAKE_READ_ORIGIN],
          credential: config.apiKey,
        })
      : undefined
  const read = transport
    ? captureRead((op) =>
        transport.read({ targetId: config.targetId, contextId: config.targetContextId }, op),
      )
    : undefined
  await registerCapture(server, db.pool, config, read)
  registerProcessing(server, db.pool, processingConfig(config, process.env), lockCaptureForEdit)
  if (mediaStore) {
    registerMediaRoutes(server, db.pool, config, mediaStore)
  }
  registerManual(
    server,
    db.pool,
    {
      ...config,
      mediaEnabled: mediaStore !== undefined,
      deploymentId: process.env.INTAKE_DEPLOYMENT_ID,
      readOrigin: process.env.INTAKE_READ_ORIGIN,
    },
    read,
    transport
      ? {
          metadata: (pk) =>
            transport.readPartAttachmentMetadata(
              { targetId: config.targetId, contextId: config.targetContextId },
              pk,
            ),
          file: (input) =>
            transport.readPartAttachmentFile(
              { targetId: config.targetId, contextId: config.targetContextId },
              input,
            ),
        }
      : undefined,
  )
}
const assets = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
if (existsSync(assets)) {
  await server.register(fastifyStatic, { root: assets, index: 'index.html', dotfiles: 'deny' })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close()
  })
}
await server.listen({ host: '127.0.0.1', port: Number(new URL(config.origin).port) || 80 })
process.stdout.write('Bench Intake development API listening on configured loopback origin.\n')
