import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import sharp from 'sharp'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { BlobStore } from '../../src/media/blob-store.ts'
import { grantMedia } from '../../src/media/grants.ts'
import { grantProjection } from '../../src/operations/grants.ts'
import { grantCaptureRead } from '../../src/capture/grants.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { mediaContent } from '../../src/media/content.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import { backfillRenditions, mediaWorkerStep } from '../../src/media/backfill.ts'
import { database } from '../../src/db/database.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const skip = image ? false : 'Explicit decoder image needed for PG/decoder boundary'
/** A well-formed image reference that no container can run, so the render is interrupted. */
const missingImage = `sha256:${'0'.repeat(64)}`

function jpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#406080' } })
    .jpeg()
    .toBuffer()
}

/** Decoded media with its renditions removed, as if it were decoded before renditions existed. */
async function retainedFixture() {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-backfill-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const name = `intake_backfill_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
  )
  await grantProjection(db.pool, name)
  await grantCaptureRead(db.pool, name)
  await grantMedia(db.pool, name, 'decoder')
  const url = new URL(db.url)
  url.username = name
  url.password = password
  const decoder = database(url.toString())
  const repository = mediaRepository(db.pool, binding, store)
  const capture = captureRepository(db.pool, binding)
  const batch = (await capture.create(randomUUID(), {
    title: 'Retained',
    note: '',
  })) as CaptureSnapshotDto
  let revision = 1
  async function upload(label: string, bytes: Buffer) {
    await repository.upload(batch.id, randomUUID(), String(revision++), label, bytes)
    assert.equal(await processMediaCommand(decoder.pool, store, binding, image!), true)
  }
  async function forgetRenditions() {
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'ALTER TABLE media_preview_rendition DISABLE TRIGGER media_preview_rendition_immutable',
      )
      await client.query('DELETE FROM media_preview_rendition')
      await client.query(
        'ALTER TABLE media_preview_rendition ENABLE TRIGGER media_preview_rendition_immutable',
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }
  async function counts() {
    const result = await db.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM media_version) AS versions,
              (SELECT count(*)::int FROM media_decode_command) AS commands,
              (SELECT count(*)::int FROM media_decode_result) AS results,
              (SELECT count(*)::int FROM media_preview) AS previews,
              (SELECT count(*)::int FROM media_preview_rendition) AS renditions`,
    )
    return result.rows[0]
  }
  async function attempts() {
    return (
      await db.pool.query<{ outcome: string; attempt: number }>(
        'SELECT outcome,attempt FROM media_rendition_backfill ORDER BY attempt',
      )
    ).rows
  }
  async function dispose() {
    await decoder.pool.end()
    await db.pool.query(`DROP OWNED BY ${name}`)
    await db.pool.query(`DROP ROLE ${name}`)
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
  return {
    db,
    store,
    root,
    binding,
    identity,
    batch,
    repository,
    decoder: decoder.pool,
    upload,
    forgetRenditions,
    counts,
    attempts,
    dispose,
  }
}

const later = (minutes: number) => () => new Date(Date.now() + minutes * 60 * 1000)

test(
  'a retained page gains its renditions without touching previews, versions or commands',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload('Photo', await jpeg(2400, 1600))
      await fixture.forgetRenditions()
      const before = await fixture.repository.snapshot(fixture.batch.id)
      const page = before.evidence[0].versions[0].pages[0]
      const content = mediaContent(fixture.db.pool, fixture.binding, fixture.store)
      const fallback = await content.preview(fixture.batch.id, page.preview_id, 'thumb')
      assert.equal(fallback.rendition, false)
      const counted = await fixture.counts()

      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        'completed',
      )
      const after = await fixture.repository.snapshot(fixture.batch.id)
      assert.deepEqual(after.evidence[0].versions[0].pages, before.evidence[0].versions[0].pages)
      assert.deepEqual(await fixture.counts(), { ...counted, renditions: 3 })
      assert.deepEqual(await fixture.attempts(), [{ outcome: 'completed', attempt: 1 }])
      // The same size request now serves the WebP rendition instead of the full page.
      const sized = await content.preview(fixture.batch.id, page.preview_id, 'thumb')
      assert.equal(sized.rendition, true)
      assert.equal((await sharp(sized.bytes).metadata()).format, 'webp')
      const full = await content.preview(fixture.batch.id, page.preview_id, 'full')
      assert.equal(full.digest, fallback.digest)
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        null,
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'small pages are never selected, and each page is judged by its own dimensions',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload(
        'Small',
        await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } })
          .png()
          .toBuffer(),
      )
      await fixture.upload('Medium', await jpeg(900, 600))
      await fixture.forgetRenditions()
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        'completed',
      )
      for (let index = 0; index < 3; index++) {
        assert.equal(
          await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
          null,
        )
      }
      assert.deepEqual(await fixture.attempts(), [{ outcome: 'completed', attempt: 1 }])
      const sizes = await fixture.db.pool.query<{ size: string }>(
        'SELECT size FROM media_preview_rendition',
      )
      assert.deepEqual(
        sizes.rows.map((row) => row.size),
        ['thumb'],
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test('a waiting decode always runs before a backfill', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Retained', await jpeg(2400, 1600))
    await fixture.forgetRenditions()
    await fixture.repository.upload(
      fixture.batch.id,
      randomUUID(),
      '2',
      'New upload',
      await jpeg(1200, 800),
    )
    assert.equal(
      await mediaWorkerStep(fixture.decoder, fixture.store, fixture.binding, image!),
      'decoded',
    )
    assert.equal(
      await mediaWorkerStep(fixture.decoder, fixture.store, fixture.binding, image!),
      'completed',
    )
    assert.equal(
      await mediaWorkerStep(fixture.decoder, fixture.store, fixture.binding, image!),
      'idle',
    )
  } finally {
    await fixture.dispose()
  }
})

test(
  'an interruption backs off, retries on a later run, and stops after three attempts',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload('Photo', await jpeg(2400, 1600))
      await fixture.forgetRenditions()
      const run = (target: string, now?: () => Date) =>
        backfillRenditions(fixture.decoder, fixture.store, fixture.binding, target, { now })
      assert.equal(await run(missingImage), 'interrupted')
      // Repeated polling inside the backoff never re-claims the page.
      assert.equal(await run(image!), null)
      assert.equal(await run(image!, later(5)), null)
      assert.equal(await run(missingImage, later(11)), 'interrupted')
      assert.equal(await run(image!, later(30)), null)
      assert.equal(await run(missingImage, later(75)), 'interrupted')
      // Three attempts used: never claimed again automatically, still served by the full page.
      assert.equal(await run(image!, later(60 * 24)), null)
      assert.deepEqual(
        (await fixture.attempts()).map((row) => [row.attempt, row.outcome]),
        [
          [1, 'interrupted'],
          [2, 'interrupted'],
          [3, 'interrupted'],
        ],
      )
      assert.equal((await fixture.counts()).renditions, 0)
    } finally {
      await fixture.dispose()
    }
  },
)

test('an interrupted page is upgraded on its retry once the backoff passes', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Photo', await jpeg(2400, 1600))
    await fixture.forgetRenditions()
    const run = (target: string, now?: () => Date) =>
      backfillRenditions(fixture.decoder, fixture.store, fixture.binding, target, { now })
    assert.equal(await run(missingImage), 'interrupted')
    assert.equal(await run(image!, later(11)), 'completed')
    assert.equal((await fixture.counts()).renditions, 3)
  } finally {
    await fixture.dispose()
  }
})

test('two concurrent workers never claim one page', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Photo', await jpeg(2400, 1600))
    await fixture.forgetRenditions()
    const outcomes = await Promise.all([
      backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
      backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
    ])
    assert.deepEqual(outcomes.sort(), ['completed', null].sort())
    assert.deepEqual(await fixture.attempts(), [{ outcome: 'completed', attempt: 1 }])
    assert.equal((await fixture.counts()).renditions, 3)
  } finally {
    await fixture.dispose()
  }
})

test(
  'a claim abandoned by a killed worker is recovered and retried; a live claim is left alone',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload('Photo', await jpeg(2400, 1600))
      await fixture.forgetRenditions()
      const preview = (
        await fixture.db.pool.query<{ id: string; batch_id: string }>(
          'SELECT id,batch_id FROM media_preview',
        )
      ).rows[0]
      const killed = randomUUID()
      await fixture.db.pool.query(
        `INSERT INTO media_rendition_backfill(id,batch_id,preview_id,attempt,outcome,owner_id,claimed_at)
       VALUES($1,$2,$3,1,'claimed',$4,now())`,
        [randomUUID(), preview.batch_id, preview.id, killed],
      )
      // Still inside its expiry, the claim belongs to a live worker.
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        null,
      )
      // Past expiry it is recovered as interrupted, then retried once its backoff passes.
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!, {
          now: later(3),
        }),
        null,
      )
      assert.deepEqual(await fixture.attempts(), [{ outcome: 'interrupted', attempt: 1 }])
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!, {
          now: later(15),
        }),
        'completed',
      )
      assert.deepEqual(
        (await fixture.attempts()).map((row) => [row.attempt, row.outcome]),
        [
          [1, 'interrupted'],
          [2, 'completed'],
        ],
      )
      // A settled attempt never changes again.
      await assert.rejects(
        fixture.db.pool.query(`UPDATE media_rendition_backfill SET outcome='claimed'`),
        /media_rendition_backfill_settled/,
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test('pages in another workspace are never claimed, recovered or upgraded', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Photo', await jpeg(2400, 1600))
    await fixture.forgetRenditions()
    const other = { ...fixture.binding, targetContextId: randomUUID() }
    assert.equal(await backfillRenditions(fixture.decoder, fixture.store, other, image!), null)
    assert.deepEqual(await fixture.attempts(), [])
    const preview = (
      await fixture.db.pool.query<{ id: string; batch_id: string }>(
        'SELECT id,batch_id FROM media_preview',
      )
    ).rows[0]
    await fixture.db.pool.query(
      `INSERT INTO media_rendition_backfill(id,batch_id,preview_id,attempt,outcome,owner_id,claimed_at)
       VALUES($1,$2,$3,1,'claimed',$4,now() - interval '1 hour')`,
      [randomUUID(), preview.batch_id, preview.id, randomUUID()],
    )
    assert.equal(await backfillRenditions(fixture.decoder, fixture.store, other, image!), null)
    assert.deepEqual(await fixture.attempts(), [{ outcome: 'claimed', attempt: 1 }])
  } finally {
    await fixture.dispose()
  }
})

test(
  'a corrupt retained page is skipped for good; a transient read failure is retried',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload('Corrupt', await jpeg(2400, 1600))
      await fixture.upload('Unreadable', await jpeg(1200, 800))
      await fixture.forgetRenditions()
      const pages = (
        await fixture.db.pool.query<{ width: number; digest: string }>(
          `SELECT width, encode(blob_digest,'hex') AS digest FROM media_preview ORDER BY width`,
        )
      ).rows
      const path = (digest: string) => join(fixture.root, 'objects', digest.slice(0, 2), digest)
      const unreadable = pages[0].digest
      const corrupt = pages[1].digest
      await chmod(path(corrupt), 0o600)
      await writeFile(path(corrupt), 'not the retained page')
      await chmod(path(unreadable), 0o000)
      const outcomes: (string | null)[] = []
      for (let index = 0; index < 3; index++) {
        outcomes.push(
          await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        )
      }
      assert.deepEqual(outcomes.sort(), ['interrupted', 'skipped_mismatch', null].sort())
      await chmod(path(unreadable), 0o400)
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!, {
          now: later(11),
        }),
        'completed',
      )
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!, {
          now: later(120),
        }),
        null,
      )
      const outcomesByWidth = await fixture.db.pool.query<{ width: number; outcome: string }>(
        `SELECT p.width, a.outcome FROM media_rendition_backfill a JOIN media_preview p ON p.id=a.preview_id
       ORDER BY p.width, a.attempt`,
      )
      assert.deepEqual(
        outcomesByWidth.rows.map((row) => [row.width, row.outcome]),
        [
          [1200, 'interrupted'],
          [1200, 'completed'],
          [2400, 'skipped_mismatch'],
        ],
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test('the restricted worker can claim and settle but not rewrite attempts', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Photo', await jpeg(2400, 1600))
    const restricted = fixture.decoder as pg.Pool
    await assert.rejects(restricted.query('DELETE FROM public.media_rendition_backfill'), {
      code: '42501',
    })
    await assert.rejects(
      restricted.query('UPDATE public.media_rendition_backfill SET owner_id=owner_id'),
      { code: '42501' },
    )
  } finally {
    await fixture.dispose()
  }
})

test('a worker whose claim was recovered meanwhile publishes nothing', { skip }, async () => {
  const fixture = await retainedFixture()
  try {
    await fixture.upload('Photo', await jpeg(2400, 1600))
    await fixture.forgetRenditions()
    let release!: () => void
    let reading!: () => void
    const held = new Promise<void>((done) => (release = done))
    const started = new Promise<void>((done) => (reading = done))
    // The first worker pauses after claiming, while reading the page.
    const paused = new Proxy(fixture.store, {
      get(target, property) {
        if (property === 'read') {
          return async (digest: string) => {
            reading()
            await held
            return target.read(digest)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const first = backfillRenditions(fixture.decoder, paused, fixture.binding, image!)
    await started
    // A second worker, past the claim's expiry, recovers it as abandoned.
    assert.equal(
      await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!, {
        now: later(3),
      }),
      null,
    )
    release()
    assert.equal(await first, 'interrupted')
    assert.equal((await fixture.counts()).renditions, 0)
    assert.deepEqual(await fixture.attempts(), [{ outcome: 'interrupted', attempt: 1 }])
  } finally {
    await fixture.dispose()
  }
})

function twoPagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 25 >>\nstream\n0 0 1 rg 0 0 600 800 re f\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << >> /Contents 6 0 R >>',
    '<< /Length 25 >>\nstream\n1 0 0 rg 0 0 500 700 re f\nendstream',
  ]
  let bytes = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(bytes))
    bytes += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(bytes)
  bytes += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    bytes += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  bytes += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(bytes)
}

test(
  'an interrupted multi-page document keeps its finished pages and falls back on the rest',
  { skip },
  async () => {
    const fixture = await retainedFixture()
    try {
      await fixture.upload('Document', twoPagePdf())
      await fixture.forgetRenditions()
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, image!),
        'completed',
      )
      assert.equal(
        await backfillRenditions(fixture.decoder, fixture.store, fixture.binding, missingImage),
        'interrupted',
      )
      const pages = await fixture.db.pool.query<{ page: number; renditions: number }>(
        `SELECT p.page, (SELECT count(*)::int FROM media_preview_rendition r WHERE r.preview_id=p.id) AS renditions
       FROM media_preview p ORDER BY p.page`,
      )
      // One page is finished with both its sizes; the other has none and falls back to its page.
      assert.deepEqual(pages.rows.map((row) => row.renditions).sort(), [0, 2])
    } finally {
      await fixture.dispose()
    }
  },
)
