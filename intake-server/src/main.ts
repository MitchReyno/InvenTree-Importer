import { registerHeader } from './header/routes.ts'
import { scopedConnectionStatus } from './header/binding.ts'
import { headerWork } from './header/work.ts'
import { registerAgents } from './agents/routes.ts'
import { devListenPort } from './dev/listen.ts'
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
import { catalogueReader } from './capture/catalogue.ts'
import { registerManual } from './review/routes.ts'
import { registerAttention } from './attention/routes.ts'
import { attentionReader } from './attention/reader.ts'
import { registerRecords } from './records/routes.ts'
import { recordsReader } from './records/reader.ts'
import { existingValuesReader } from './records/existing.ts'
import { requireCurrentTargetContext } from './capture/target-context.ts'
import {
  inventoryTransport,
  type ListOperation,
  type ReadOperation,
  type TargetBinding,
} from './inventory/transport.ts'
import {
  claimStore,
  loadSavedCredential,
  requireStableAncestors,
  requireUnpublished,
} from './inventory/credential-store.ts'
import { registerFrontendAssets } from './api/frontend-assets.ts'
import { configureReadTarget, readTargetBinding } from './inventory/read-target.ts'
import { registerInventoryCredential } from './inventory/credential-routes.ts'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The built browser app, served as static files; secrets must never live under it. */
const FRONTEND_ASSETS = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))

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
    'secret_file_permissions',
    'secret_file_invalid',
    'invalid_secrets_directory',
    'secret_store_in_use',
  ]
  return error instanceof Error && safe.includes(error.message)
    ? error.message
    : 'web_startup_refused'
}

/** Fixes this process's target on the read-only transport. Callers receive closures, not the transport. */
function bindReadOnlyTarget(
  transport: ReturnType<typeof inventoryTransport>,
  binding: TargetBinding,
) {
  return {
    read: (operation: ReadOperation) => transport.read(binding, operation),
    list: (operation: ListOperation, timeoutMs: number) =>
      transport.list(binding, operation, timeoutMs),
    probe: () => transport.probe(binding),
    serverVersion: () => transport.serverVersion(binding),
    attachments: {
      metadata: (pk: string) => transport.readPartAttachmentMetadata(binding, pk),
      file: (input: { pk: string; partPk: string; path: string }) =>
        transport.readPartAttachmentFile(binding, input),
    },
  }
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

  // Releases this process's claim on the secrets directory; nothing to release until claimed.
  let releaseStore: () => Promise<void> = async () => undefined

  let server: ReturnType<typeof createServer> | undefined
  try {
    // A saved replacement other users could reach refuses startup, with or without a database.
    const readOrigin = process.env.INTAKE_READ_ORIGIN
    // The checkout too: the frontend dev server may serve any file in it.
    await requireUnpublished(config.secretsDir, [FRONTEND_ASSETS, REPOSITORY_ROOT])
    await requireStableAncestors(config.secretsDir)
    releaseStore = await claimStore(config.secretsDir)
    const saved = await loadSavedCredential(
      config.secretsDir,
      readTargetBinding(config, readOrigin),
    )
    const mediaStore = await configuredMediaStore(process.env, db?.pool)
    server = createServer(config, { mediaEnabled: mediaStore !== undefined })
    server.addHook('onClose', releaseStore)
    registerReadiness(server, db?.pool, config, mediaStore !== undefined)
    if (db) {
      if (!(await compatibleSchema(db.pool))) {
        throw new Error('database_version_quarantined')
      }
      registerLive(server, db.pool, config)
      server.addHook('onClose', closeDatabase)
      // Only the read closure crosses the capture boundary. No browser-supplied origin/key.
      const readTarget = configureReadTarget(config, readOrigin, saved)
      const transport = readTarget?.transport
      const targetReads = transport
        ? bindReadOnlyTarget(transport, {
            targetId: config.targetId,
            contextId: config.targetContextId,
          })
        : undefined
      const read = targetReads ? captureRead(targetReads.read) : undefined
      const catalogue = targetReads
        ? catalogueReader({
            list: targetReads.list,
            read: targetReads.read,
            targetContextId: config.targetContextId,
          })
        : undefined
      registerCapture(server, db.pool, config, read, catalogue)
      const processing = processingConfig(config, process.env)
      const runtime = {
        deploymentId: process.env.INTAKE_DEPLOYMENT_ID,
        readOrigin: process.env.INTAKE_READ_ORIGIN,
        mediaEnabled: mediaStore !== undefined,
      }
      const manualConfig = { ...config, ...runtime }
      const headerConfig = { ...manualConfig, ...processing }
      registerProcessing(server, db.pool, processing, lockCaptureForEdit)
      registerAgents(server, db.pool, processing)
      const connection = scopedConnectionStatus(
        db.pool,
        config,
        runtime.readOrigin,
        targetReads?.probe,
        targetReads?.serverVersion,
        readTarget?.holder,
      )
      registerHeader(server, config, connection, (batchId) =>
        headerWork(db.pool, headerConfig, batchId),
      )
      registerInventoryCredential(server, {
        secretsDir: config.secretsDir,
        target: readTarget,
        fence: () => requireCurrentTargetContext(db.pool, config),
        changed: () => connection.reset(),
      })
      if (mediaStore) {
        // Region crops are cached privately beside, never inside, the blob store.
        registerMediaRoutes(
          server,
          db.pool,
          config,
          mediaStore,
          `${process.env.INTAKE_BLOB_ROOT!.replace(/\/+$/, '')}-region-crops`,
        )
      }
      const readRecords = recordsReader(
        db.pool,
        config,
        processing,
        lockCaptureForEdit,
        runtime.mediaEnabled,
      )
      registerAttention(
        server,
        config,
        attentionReader(db.pool, manualConfig, processing, lockCaptureForEdit, readRecords),
      )
      registerRecords(
        server,
        config,
        readRecords,
        targetReads && {
          read: existingValuesReader({
            targetContextId: config.targetContextId,
            read: targetReads.read,
          }),
          fence: () => requireCurrentTargetContext(db.pool, config),
        },
      )
      registerManual(server, db.pool, manualConfig, read, targetReads?.attachments, processing)
    }
    if (existsSync(FRONTEND_ASSETS)) {
      await registerFrontendAssets(server, FRONTEND_ASSETS, config.secretsDir)
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        process.stdout.write(JSON.stringify({ event: 'web_draining' }) + '\n')
        void server!.close()
      })
    }
    await server.listen({ host: '127.0.0.1', port: devListenPort(config.origin, process.env) })
    process.stdout.write(
      JSON.stringify({ event: 'web_ready', mode: 'restricted_local', research: 'unqualified' }) +
        '\n',
    )
  } catch (error) {
    await server?.close().catch(() => undefined)
    await releaseStore().catch(() => undefined)
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
