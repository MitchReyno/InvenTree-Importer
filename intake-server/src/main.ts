import { createServer } from './api/server.ts'
import { registerLive } from './live/routes.ts'
import { compatibleSchema } from './operations/compatibility.ts'
import { registerReadiness } from './operations/readiness.ts'
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

function startupFailureCode(error: unknown) {
  const safe = [
    'media_database_required',
    'media_root_required',
    'media_store_identity_mismatch',
    'database_version_quarantined',
  ]
  return error instanceof Error && safe.includes(error.message)
    ? error.message
    : 'web_startup_refused'
}

async function main() {
  const config = devConfig(process.env)
  const db = process.env.INTAKE_DATABASE_URL ? database(process.env.INTAKE_DATABASE_URL) : undefined
  let closed = false

  const closeDatabase = async () => {
    if (!closed) {
      closed = true
      await db?.close()
    }
  }

  let server: ReturnType<typeof createServer> | undefined
  try {
    const mediaStore = await configuredMediaStore(process.env, db?.pool)
    server = createServer(config, { mediaEnabled: mediaStore !== undefined })
    registerReadiness(server, db?.pool, config, mediaStore !== undefined)
    if (db) {
      if (!(await compatibleSchema(db.pool))) {
        throw new Error('database_version_quarantined')
      }
      registerLive(server, db.pool, config)
      server.addHook('onClose', closeDatabase)
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
      const processing = processingConfig(config, process.env)
      registerProcessing(server, db.pool, processing, lockCaptureForEdit)
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
        processing,
      )
    }
    const assets = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
    if (existsSync(assets)) {
      await server.register(fastifyStatic, { root: assets, index: 'index.html', dotfiles: 'deny' })
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        process.stdout.write(JSON.stringify({ event: 'web_draining' }) + '\n')
        void server!.close()
      })
    }
    await server.listen({ host: '127.0.0.1', port: Number(new URL(config.origin).port) || 80 })
    process.stdout.write(
      JSON.stringify({ event: 'web_ready', mode: 'restricted_local', research: 'unqualified' }) +
        '\n',
    )
  } catch (error) {
    await server?.close().catch(() => undefined)
    await closeDatabase()
    const code = startupFailureCode(error)
    throw new Error(code)
  }
}

main().catch((error: unknown) => {
  const code = startupFailureCode(error)
  process.stderr.write(JSON.stringify({ event: 'web_startup_refused', code }) + '\n')
  process.exitCode = 1
})
