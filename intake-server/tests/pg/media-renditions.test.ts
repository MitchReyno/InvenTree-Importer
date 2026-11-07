import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import sharp from 'sharp'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { blobReferenced } from '../../src/media/blob-reference.ts'
import { BlobStore } from '../../src/media/blob-store.ts'
import { grantMedia } from '../../src/media/grants.ts'
import { grantProjection } from '../../src/operations/grants.ts'
import { grantCaptureRead } from '../../src/capture/grants.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import { database } from '../../src/db/database.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

const run = promisify(execFile)
const image = process.env.INTAKE_MEDIA_DECODER_IMAGE

async function role(db: { pool: pg.Pool; url: string }, purpose: Parameters<typeof grantMedia>[2]) {
  const name = `intake_rend_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 2`,
  )
  if (purpose === 'decoder') {
    await grantProjection(db.pool, name)
    await grantCaptureRead(db.pool, name)
  }
  await grantMedia(db.pool, name, purpose)
  const url = new URL(db.url)
  url.username = name
  url.password = password
  return { name, url: url.toString() }
}

test(
  'a decode commits renditions with its page, immutably, readable by every preview reader',
  { skip: image ? false : 'Explicit decoder image needed for PG/decoder boundary' },
  async () => {
    const db = await isolatedDatabase()
    const identity = await seedAuthority(db.pool)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-renditions-pg-')))
    const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const roles = {
      decoder: await role(db, 'decoder'),
      api: await role(db, 'api'),
      processing: await role(db, 'processing'),
      reader: await role(db, 'processing-reader'),
      gc: await role(db, 'gc'),
    }
    const pools = Object.fromEntries(
      Object.entries(roles).map(([key, value]) => [
        key,
        new pg.Pool({ connectionString: value.url, max: 1 }),
      ]),
    ) as Record<keyof typeof roles, pg.Pool>
    const decoder = database(roles.decoder.url)
    try {
      const batch = (await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'Renditions',
        note: '',
      })) as CaptureSnapshotDto
      validate('CaptureSnapshot', batch)
      const photo = await sharp({
        create: { width: 2400, height: 1600, channels: 3, background: '#406080' },
      })
        .jpeg()
        .toBuffer()
      const repository = mediaRepository(db.pool, binding, store)
      await repository.upload(batch.id, randomUUID(), '1', 'Photo', photo)
      assert.equal(await processMediaCommand(decoder.pool, store, binding, image!), true)

      const rows = await db.pool.query<{
        preview_id: string
        size: string
        width: number
        height: number
        digest: string
      }>(
        `SELECT r.preview_id,r.size,r.width,r.height,encode(r.blob_digest,'hex') AS digest
         FROM media_preview_rendition r JOIN media_preview p ON p.id=r.preview_id
         ORDER BY r.width`,
      )
      assert.deepEqual(
        rows.rows.map((row) => [row.size, row.width, row.height]),
        [
          ['thumb', 320, 213],
          ['card', 960, 640],
          ['view', 2048, 1365],
        ],
      )
      const snapshot = await repository.snapshot(batch.id)
      assert.ok(
        rows.rows.every(
          (row) => row.preview_id === snapshot.evidence[0].versions[0].pages[0].preview_id,
        ),
      )
      for (const row of rows.rows) {
        const metadata = await sharp(await store.read(row.digest)).metadata()
        assert.deepEqual([metadata.format, metadata.width], ['webp', row.width])
        const client = await db.pool.connect()
        try {
          assert.equal(await blobReferenced(client, row.digest), true)
        } finally {
          client.release()
        }
      }

      // Every role that reads media_preview can read its renditions; none can change them.
      for (const pool of Object.values(pools)) {
        const count = await pool.query(
          'SELECT count(*)::int AS count FROM public.media_preview_rendition',
        )
        assert.equal(count.rows[0].count, 3)
        await assert.rejects(pool.query('UPDATE public.media_preview_rendition SET width=width'), {
          code: '42501',
        })
        await assert.rejects(pool.query('DELETE FROM public.media_preview_rendition'), {
          code: '42501',
        })
      }
      // The owner is refused too: renditions are immutable.
      await assert.rejects(db.pool.query('UPDATE media_preview_rendition SET width=width'))
      await assert.rejects(db.pool.query('DELETE FROM media_preview_rendition'))

      // The SELECT-only collector keeps an aged rendition blob because a committed row references it.
      const aged = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const digest = rows.rows[0].digest
      await utimes(join(root, 'objects', digest.slice(0, 2), digest), aged, aged)
      const result = await run(process.execPath, ['--import', 'tsx', 'src/media/gc-main.ts'], {
        cwd: new URL('../../', import.meta.url),
        timeout: 5000,
        maxBuffer: 8192,
        env: {
          PATH: process.env.PATH,
          INTAKE_DATABASE_URL: roles.gc.url,
          INTAKE_BLOB_ROOT: root,
          INTAKE_MEDIA_GC_DIGEST: digest,
          INTAKE_MEDIA_GC_BEFORE: cutoff,
        },
      })
      assert.deepEqual(JSON.parse(result.stdout), { digest, cutoff, collected: false })
      assert.ok((await store.read(digest)).length > 0)
    } finally {
      await decoder.pool.end()
      for (const pool of Object.values(pools)) {
        await pool.end()
      }
      for (const value of Object.values(roles)) {
        await db.pool.query(`DROP OWNED BY ${value.name}`)
        await db.pool.query(`DROP ROLE ${value.name}`)
      }
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)
