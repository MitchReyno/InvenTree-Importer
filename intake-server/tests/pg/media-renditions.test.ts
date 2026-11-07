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

test(
  'the preview route serves each size privately, revalidates by digest and falls back to the page',
  { skip: image ? false : 'Explicit decoder image needed for PG/decoder boundary' },
  async () => {
    const { createServer } = await import('../../src/api/server.ts')
    const { registerCapture } = await import('../../src/capture/routes.ts')
    const { registerMediaRoutes } = await import('../../src/media/routes.ts')
    const { grantFoundation } = await import('../../src/operations/grants.ts')
    const { grantCapture } = await import('../../src/capture/grants.ts')
    const db = await isolatedDatabase()
    const identity = await seedAuthority(db.pool)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-renditions-http-')))
    const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const api = await role(db, 'api')
    await grantFoundation(db.pool, api.name)
    await grantCapture(db.pool, api.name)
    const decoderRole = await role(db, 'decoder')
    const runtime = database(api.url)
    const decoder = database(decoderRole.url)
    const apps: { close: () => Promise<unknown> }[] = []
    async function serve(context: string) {
      const config = {
        origin: 'http://127.0.0.1:1',
        actorId: identity.actor,
        targetId: identity.target,
        targetContextId: context,
        credentialRef: 'owned_media_fixture',
        apiKey: 'fake-only',
      }
      const app = createServer(config, { mediaEnabled: true })
      registerCapture(app, runtime.pool, config)
      registerMediaRoutes(app, runtime.pool, config, store)
      config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
      apps.push(app)
      return config.origin
    }
    try {
      const repository = mediaRepository(db.pool, binding, store)
      const capture = captureRepository(db.pool, binding)
      const batch = (await capture.create(randomUUID(), {
        title: 'Sized',
        note: '',
      })) as CaptureSnapshotDto
      const other = (await capture.create(randomUUID(), {
        title: 'Other',
        note: '',
      })) as CaptureSnapshotDto
      const photo = await sharp({
        create: { width: 2400, height: 1600, channels: 3, background: '#406080' },
      })
        .jpeg()
        .toBuffer()
      const small = await sharp({
        create: { width: 300, height: 200, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer()
      await repository.upload(batch.id, randomUUID(), '1', 'Photo', photo)
      await repository.upload(batch.id, randomUUID(), '2', 'Small', small)
      assert.equal(await processMediaCommand(decoder.pool, store, binding, image!), true)
      assert.equal(await processMediaCommand(decoder.pool, store, binding, image!), true)
      const snapshot = await repository.snapshot(batch.id)
      // JSON responses keep their shape: the snapshot still validates against the strict schema.
      validate('MediaSnapshot', snapshot)
      const pageOf = (label: string) =>
        snapshot.evidence.find((item) => item.label === label)!.versions[0].pages[0]
      const large = pageOf('Photo')
      const tiny = pageOf('Small')
      const origin = await serve(identity.context)
      const url = (batchId: string, previewId: string, size?: string) =>
        `${origin}/api/v1/batches/${batchId}/media/previews/${previewId}${size ? `?size=${size}` : ''}`

      for (const [size, width] of [
        ['thumb', 320],
        ['card', 960],
        ['view', 2048],
      ] as const) {
        const response = await fetch(url(batch.id, large.preview_id, size))
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('content-type'), 'image/webp')
        assert.equal(response.headers.get('cache-control'), 'private, no-cache')
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.equal((await sharp(bytes).metadata()).width, width)
        assert.match(response.headers.get('etag')!, /^"[a-f0-9]{64}"$/)
      }
      const full = await fetch(url(batch.id, large.preview_id))
      assert.equal(full.headers.get('content-type'), 'image/png')
      assert.equal((await sharp(Buffer.from(await full.arrayBuffer())).metadata()).width, 2400)
      assert.equal(
        (await fetch(url(batch.id, large.preview_id, 'full'))).headers.get('etag'),
        full.headers.get('etag'),
      )

      // A size the page has no rendition for is the full page, still revalidated.
      const fallback = await fetch(url(batch.id, tiny.preview_id, 'card'))
      assert.equal(fallback.headers.get('content-type'), 'image/png')
      assert.equal(fallback.headers.get('cache-control'), 'private, no-cache')
      assert.equal((await sharp(Buffer.from(await fallback.arrayBuffer())).metadata()).width, 300)

      // A repeat with the validator is authorized again, then answered 304 without bytes.
      const thumb = await fetch(url(batch.id, large.preview_id, 'thumb'))
      const etag = thumb.headers.get('etag')!
      const unchanged = await fetch(url(batch.id, large.preview_id, 'thumb'), {
        headers: { 'if-none-match': etag },
      })
      assert.equal(unchanged.status, 304)
      assert.equal((await unchanged.arrayBuffer()).byteLength, 0)

      assert.equal((await fetch(url(batch.id, large.preview_id, 'huge'))).status, 400)
      assert.equal((await fetch(url(other.id, large.preview_id, 'thumb'))).status, 404)
      // The same URL and validator under another target context never reach the cached bytes.
      const foreign = await serve(randomUUID())
      const elsewhere = await fetch(
        `${foreign}/api/v1/batches/${batch.id}/media/previews/${large.preview_id}?size=thumb`,
        { headers: { 'if-none-match': etag } },
      )
      assert.notEqual(elsewhere.status, 200)
      assert.notEqual(elsewhere.status, 304)
    } finally {
      for (const app of apps) {
        await app.close()
      }
      await runtime.pool.end()
      await decoder.pool.end()
      for (const value of [api, decoderRole]) {
        await db.pool.query(`DROP OWNED BY ${value.name}`)
        await db.pool.query(`DROP ROLE ${value.name}`)
      }
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)
