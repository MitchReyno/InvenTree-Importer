import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { manualFixture } from '../support/manual.ts'
import { isolatedDatabase } from '../support/database.ts'
import { ownedPgTools } from '../support/pg-tools.ts'
import { mediaRepository } from '#/media/repository.ts'
import { PART_ATTACHMENT_PNG } from '../support/part-attachment.ts'
import { backupArchive, restoreArchive } from '#/operations/archive.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { compatibleSchema } from '#/operations/compatibility.ts'
import { requireDisabledGate } from '#/operations/quiescence.ts'
import { registerReadiness } from '#/operations/readiness.ts'
import { createServer } from '#/api/server.ts'

async function disabled(root: string) {
  const path = join(root, 'activation.json')
  const activation = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...activation, enabled: false }), { mode: 0o600 })
}

test(
  'actual PostgreSQL dump/restore retains exact original blobs and identity while remaining externally disabled',
  { timeout: 30000 },
  async () => {
    const fixture = await manualFixture({ media: true })
    const restored = await isolatedDatabase({ migrate: false, restore: true })
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-archive-')))
    try {
      const capture = await fixture.seedCapture()
      const repository = mediaRepository(fixture.api.pool, fixture.config, fixture.store!)
      const media = await repository.snapshot(capture.batch.id)
      await repository.upload(
        capture.batch.id,
        randomUUID(),
        media.revision,
        'Retained original',
        PART_ATTACHMENT_PNG,
      )
      await disabled(fixture.gateRoot)
      const config = {
        databaseUrl: fixture.db.url,
        schedulerDatabaseUrl: fixture.scheduler.url,
        gateRoot: fixture.gateRoot,
        blobRoot: join(fixture.root, 'blobs'),
        archive: join(root, 'archive'),
      }
      assert.equal((await backupArchive(fixture.db.pool, config, ownedPgTools)).blobs, 1)
      const manifest = JSON.parse(await readFile(join(config.archive, 'manifest.json'), 'utf8'))
      assert.equal(manifest.credentials, 'excluded')
      assert.deepEqual((await readdir(config.archive)).sort(), [
        'blobs',
        'database.dump',
        'manifest.json',
      ])
      const result = await restoreArchive(
        restored.pool,
        {
          ...config,
          databaseUrl: restored.url,
          schedulerDatabaseUrl: restored.url,
          blobRoot: join(root, 'restored-blobs'),
        },
        ownedPgTools,
      )
      assert.equal(result.status, 'restored-quarantined')
      assert.equal((await requireDisabledGate(fixture.gateRoot)).activation.enabled, false)
      assert.equal(await compatibleSchema(restored.pool), true)
      const store = await BlobStore.initialize(join(root, 'restored-blobs'), manifest.store_id)
      assert.ok(
        (await store.read(createHash('sha256').update(PART_ATTACHMENT_PNG).digest('hex'))).equals(
          PART_ATTACHMENT_PNG,
        ),
      )
      assert.equal(
        (await restored.pool.query('SELECT count(*) FROM media_version')).rows[0].count,
        '1',
      )
      await assert.rejects(
        restoreArchive(
          restored.pool,
          {
            ...config,
            databaseUrl: restored.url,
            schedulerDatabaseUrl: restored.url,
            blobRoot: join(root, 'another-root'),
          },
          ownedPgTools,
        ),
        /restore_database_not_empty/,
      )
      await assert.rejects(backupArchive(fixture.db.pool, config, ownedPgTools), /EEXIST/)
    } finally {
      await restored.dispose()
      await fixture.dispose()
    }
  },
)

test(
  'archive refuses active gates, split scheduler history and corrupt bytes without activating or overwriting',
  { timeout: 30000 },
  async () => {
    const fixture = await manualFixture()
    const restored = await isolatedDatabase({ migrate: false, restore: true })
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-archive-refusal-')))
    try {
      const config = {
        databaseUrl: fixture.db.url,
        schedulerDatabaseUrl: fixture.scheduler.url,
        gateRoot: fixture.gateRoot,
        archive: join(root, 'archive'),
      }
      await assert.rejects(
        backupArchive(fixture.db.pool, config, ownedPgTools),
        /externally_disabled_apply_required/,
      )
      await disabled(fixture.gateRoot)
      await assert.rejects(
        backupArchive(
          fixture.db.pool,
          { ...config, schedulerDatabaseUrl: restored.url },
          ownedPgTools,
        ),
        /coherent_scheduler_database_required/,
      )
      await assert.rejects(
        backupArchive(
          fixture.db.pool,
          { ...config, databaseUrl: restored.url, schedulerDatabaseUrl: restored.url },
          ownedPgTools,
        ),
        /operational_database_mismatch/,
      )
      await backupArchive(fixture.db.pool, config, ownedPgTools)
      const activationPath = join(fixture.gateRoot, 'activation.json')
      const activation = await readFile(activationPath, 'utf8')
      await writeFile(
        activationPath,
        JSON.stringify({ ...JSON.parse(activation), epoch: randomUUID() }),
        { mode: 0o600 },
      )
      await assert.rejects(
        restoreArchive(
          restored.pool,
          {
            ...config,
            databaseUrl: restored.url,
            schedulerDatabaseUrl: restored.url,
            blobRoot: join(root, 'wrong-identity-root'),
          },
          ownedPgTools,
        ),
        /archive_external_binding_mismatch/,
      )
      await writeFile(activationPath, activation, { mode: 0o600 })
      await writeFile(join(config.archive, 'database.dump'), 'Corrupt archive', { mode: 0o600 })
      await assert.rejects(
        restoreArchive(
          restored.pool,
          {
            ...config,
            databaseUrl: restored.url,
            schedulerDatabaseUrl: restored.url,
            blobRoot: join(root, 'restore-root'),
          },
          ownedPgTools,
        ),
        /database_archive_corrupt/,
      )
      assert.equal(
        (await restored.pool.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'"))
          .rows[0].count,
        '0',
      )
      assert.equal((await requireDisabledGate(fixture.gateRoot)).activation.enabled, false)
    } finally {
      await restored.dispose()
      await fixture.dispose()
    }
  },
)

test('readiness is read-only, redacted and refuses incompatible schema or context', async () => {
  const fixture = await manualFixture()
  const app = createServer(fixture.config)
  registerReadiness(app, fixture.api.pool, fixture.config, false)
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/readiness',
      headers: { host: new URL(fixture.config.origin).host },
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().research, 'unqualified')
    assert.equal(response.body.includes(fixture.config.apiKey), false)
    assert.equal(response.body.includes(fixture.db.url), false)
    const shadow = await fixture.db.pool.connect()
    try {
      await shadow.query(
        'CREATE TEMP TABLE schema_migration AS SELECT * FROM public.schema_migration',
      )
      await fixture.db.pool.query(
        'UPDATE public.schema_migration SET sha256=$1 WHERE name=(SELECT min(name) FROM public.schema_migration)',
        ['0'.repeat(64)],
      )
      assert.equal(
        await compatibleSchema(shadow),
        false,
        'temporary valid hashes cannot hide public migration drift',
      )
    } finally {
      shadow.release(true)
    }
    assert.equal(await compatibleSchema(fixture.api.pool), false)
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/readiness',
      headers: { host: new URL(fixture.config.origin).host },
    })
    assert.equal(stale.statusCode, 503)
    assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
  } finally {
    await app.close()
    await fixture.dispose()
  }
})
