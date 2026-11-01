import { createServer } from './api/server.ts'
import { devConfig } from './config.ts'
import { database } from './db/database.ts'
import { registerCapture } from './capture/routes.ts'
import { BlobStore } from './media/blob-store.ts'
import { registerMediaRoutes } from './media/routes.ts'
import { captureRead } from './capture/read.ts'
import { registerManual } from './review/routes.ts'
import { inventoryTransport } from './inventory/transport.ts'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Explicit opt-in only; never discovers a default directory or initializes without a DB. */
async function configuredMediaStore(env: NodeJS.ProcessEnv) {
  const root = env.INTAKE_BLOB_ROOT
  if (root === undefined) {
    return undefined
  }
  if (!env.INTAKE_DATABASE_URL) {
    throw new Error('media_database_required')
  }
  if (root.length === 0) {
    throw new Error('media_root_required')
  }

  return BlobStore.initialize(root)
}

const config = devConfig(process.env)
const mediaStore = await configuredMediaStore(process.env)
const server = createServer(config, { mediaEnabled: mediaStore !== undefined })
if (process.env.INTAKE_DATABASE_URL) {
  const db = database(process.env.INTAKE_DATABASE_URL)
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
  )
}
const assets = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
if (existsSync(assets))
  await server.register(fastifyStatic, { root: assets, index: 'index.html', dotfiles: 'deny' })
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void server.close()
  })
await server.listen({ host: '127.0.0.1', port: Number(new URL(config.origin).port) || 80 })
process.stdout.write('Bench Intake development API listening on configured loopback origin.\n')
