import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { Pool } from 'pg'
import { canonical, strictJson } from '@invimport/contracts/json'
import { BlobStore } from '../media/blob-store.ts'
import { readMediaStoreIdentity } from '../media/store-identity.ts'
import { compatibleSchema, expectedMigrations } from './compatibility.ts'
import { privateDirectory, privateFile, newDirectory, writeExclusive } from './files.ts'
import { requireDisabledGate } from './quiescence.ts'
import {
  archiveManifest,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_BLOBS,
  type ArchiveManifest,
} from './archive-model.ts'
import { nativePgTools, type PgTools } from './pg-tools.ts'
import { operationalDatabase, requireOperationalDatabase } from './config.ts'

interface ArchiveConfig {
  databaseUrl: string
  schedulerDatabaseUrl: string
  gateRoot: string
  blobRoot?: string
  archive: string
}

function sameDatabase(config: ArchiveConfig) {
  const identity = (raw: string) => {
    const { url, name } = operationalDatabase(raw)
    return `${url.hostname}:${url.port || '5432'}/${name}`
  }

  if (identity(config.databaseUrl) !== identity(config.schedulerDatabaseUrl)) {
    throw new Error('coherent_scheduler_database_required')
  }
}

async function hashDump(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      !stat.size ||
      stat.size > MAX_ARCHIVE_BYTES
    ) {
      throw new Error('invalid_database_archive')
    }
    const hash = createHash('sha256')
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk)
    }
    await file.sync()
    return hash.digest('hex')
  } finally {
    await file.close()
  }
}

/** Same-database scheduler and table locks give one committed database/blob cut. */
export async function backupArchive(
  pool: Pool,
  config: ArchiveConfig,
  tools: PgTools = nativePgTools,
) {
  sameDatabase(config)
  await requireOperationalDatabase(pool, config.databaseUrl)
  const gate = await requireDisabledGate(config.gateRoot)
  if (config.blobRoot) {
    await privateDirectory(config.blobRoot)
  }
  const archive = await newDirectory(config.archive)
  const objects = await newDirectory(join(archive, 'blobs'))
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    await client.query("SET LOCAL lock_timeout='3s'")
    await client.query("SET LOCAL idle_in_transaction_session_timeout='120s'")
    await client.query("SET LOCAL statement_timeout='120s'")
    const tables = await client.query<{ relation: string }>(
      `SELECT pg_catalog.quote_ident(n.nspname)||'.'||pg_catalog.quote_ident(c.relname) AS relation
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
         AND n.nspname NOT LIKE 'pg_%' ORDER BY n.nspname,c.relname`,
    )
    if (!tables.rows.length) {
      throw new Error('database_archive_schema_required')
    }
    await client.query(
      `LOCK TABLE ${tables.rows.map((row) => row.relation).join(',')} IN SHARE MODE`,
    )
    if (!(await compatibleSchema(client))) {
      throw new Error('database_version_quarantined')
    }
    if ((await requireDisabledGate(config.gateRoot)).bindingSha256 !== gate.bindingSha256) {
      throw new Error('external_activation_changed')
    }
    const storeId = await readMediaStoreIdentity(client)
    const blobs = await client.query<{ digest: string; size: string }>(
      `SELECT encode(digest,'hex') AS digest,byte_size AS size FROM public.media_blob ORDER BY digest LIMIT $1`,
      [MAX_ARCHIVE_BLOBS + 1],
    )
    const manifest = archiveManifest({
      format: 'bench-intake-archive/1',
      database_sha256: '0'.repeat(64),
      external_binding_sha256: gate.bindingSha256,
      store_id: storeId,
      blobs: blobs.rows,
      migrations: await expectedMigrations(),
      scheduler: 'same-database',
      credentials: 'excluded',
      activation: 'externally-disabled',
    })
    if (manifest.blobs.length && !config.blobRoot) {
      throw new Error('archive_blob_root_required')
    }
    const store = config.blobRoot ? await BlobStore.initialize(config.blobRoot, storeId) : undefined
    for (const blob of manifest.blobs) {
      const bytes = await store!.read(blob.digest)
      if (String(bytes.length) !== blob.size) {
        throw new Error('archive_blob_size_mismatch')
      }
      await writeExclusive(join(objects, blob.digest), bytes)
    }
    const snapshot = await client.query<{ snapshot: string }>(
      'SELECT pg_catalog.pg_export_snapshot() AS snapshot',
    )
    const dump = join(archive, 'database.dump')
    await tools.dump(config.databaseUrl, snapshot.rows[0].snapshot, dump)
    manifest.database_sha256 = await hashDump(dump)
    if ((await requireDisabledGate(config.gateRoot)).bindingSha256 !== gate.bindingSha256) {
      throw new Error('external_activation_changed')
    }
    await client.query('COMMIT')
    await writeExclusive(join(archive, 'manifest.json'), canonical(manifest) + '\n')
    return {
      status: 'archived' as const,
      blobs: manifest.blobs.length,
      activation: 'disabled' as const,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function inspectArchive(path: string) {
  const archive = await privateDirectory(path)
  const manifest = archiveManifest(
    strictJson(
      (await privateFile(join(archive, 'manifest.json'), 2 * 1024 * 1024)).toString('utf8'),
    ),
  )
  if (canonical(manifest.migrations) !== canonical(await expectedMigrations())) {
    throw new Error('archive_version_quarantined')
  }
  if ((await hashDump(join(archive, 'database.dump'))) !== manifest.database_sha256) {
    throw new Error('database_archive_corrupt')
  }
  await privateDirectory(join(archive, 'blobs'))
  for (const blob of manifest.blobs) {
    const bytes = await privateFile(join(archive, 'blobs', blob.digest), Number(blob.size))
    if (
      bytes.length !== Number(blob.size) ||
      createHash('sha256').update(bytes).digest('hex') !== blob.digest
    ) {
      throw new Error('archive_blob_corrupt')
    }
  }
  return { archive, manifest }
}

/** Restore only into an empty database and new blob root; never activate, overwrite or erase. */
export async function restoreArchive(
  pool: Pool,
  config: ArchiveConfig,
  tools: PgTools = nativePgTools,
) {
  sameDatabase(config)
  await requireOperationalDatabase(pool, config.databaseUrl)
  const gate = await requireDisabledGate(config.gateRoot)
  const { archive, manifest } = await inspectArchive(config.archive)
  if (manifest.external_binding_sha256 !== gate.bindingSha256) {
    throw new Error('archive_external_binding_mismatch')
  }
  const destination = new URL(config.databaseUrl)
  if (!/^intake_restore_[a-z0-9_]{1,40}$/.test(destination.pathname.slice(1))) {
    throw new Error('fresh_restore_database_required')
  }
  const count = await pool.query<{ count: string }>(
    `SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
       AND c.relkind IN ('r','p','v','m','S','f')`,
  )
  if (count.rows[0].count !== '0') {
    throw new Error('restore_database_not_empty')
  }
  if (!config.blobRoot) {
    throw new Error('fresh_restore_blob_root_required')
  }
  const root = await newDirectory(config.blobRoot)
  if (root === resolve(archive)) {
    throw new Error('restore_destination_conflict')
  }
  await tools.restore(config.databaseUrl, join(archive, 'database.dump'))
  if (
    !(await compatibleSchema(pool)) ||
    (await readMediaStoreIdentity(pool)) !== manifest.store_id
  ) {
    throw new Error('restore_identity_mismatch')
  }
  const store = await BlobStore.initialize(root, manifest.store_id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const blob of manifest.blobs) {
      const bytes = await privateFile(join(archive, 'blobs', blob.digest), Number(blob.size))
      const retained = await store.publish(client, bytes)
      if (retained.digest !== blob.digest || retained.size !== blob.size) {
        throw new Error('restore_blob_mismatch')
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  if ((await requireDisabledGate(config.gateRoot)).bindingSha256 !== gate.bindingSha256) {
    throw new Error('external_activation_changed')
  }
  return {
    status: 'restored-quarantined' as const,
    blobs: manifest.blobs.length,
    activation: 'disabled' as const,
  }
}

export type { ArchiveConfig, ArchiveManifest }
