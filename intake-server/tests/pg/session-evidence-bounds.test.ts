import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { validate } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession, leadSession, seedPhoto } from '../support/sessions.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import {
  AGENT_IMAGE_MAX_BYTES,
  sessionTools,
  type SessionToolOutput,
} from '#/agents/tools/handlers.ts'
import { mediaEditor } from '../support/media-removal.ts'
import { grantMedia } from '#/media/grants.ts'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// Larger than the 2,576 px bound on its long edge, in the 3:4 shape of the photos that failed.
const PAGE = { width: 3000, height: 4000 }

/** A flat photo, or with `noisy` one that compresses as badly as a detailed real photo. */
async function picture(width: number, height: number, noisy = false) {
  const base = { width, height, channels: 3 as const, background: { r: 40, g: 90, b: 160 } }
  return sharp({
    create: noisy ? { ...base, noise: { type: 'gaussian', mean: 128, sigma: 60 } } : base,
  })
    .png()
    .toBuffer()
}

/** A lot or Examine session with one large photo it may fetch, and its tools. */
async function largePhotoSession(stage: 'lot' | 'examine', options: { noisy?: boolean } = {}) {
  const fixture = await processingFixture()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'evidence-bounds-')))
  const dispose = async () => {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
  try {
    return { ...(await prepareSession(fixture, root, stage, options)), fixture, dispose }
  } catch (error) {
    // A failed setup must still release the database, or the test process never exits.
    await dispose()
    throw error
  }
}

async function prepareSession(
  fixture: Awaited<ReturnType<typeof processingFixture>>,
  root: string,
  stage: 'lot' | 'examine',
  options: { noisy?: boolean },
) {
  const capture = await fixture.seedCapture()
  const original = await picture(PAGE.width, PAGE.height, options.noisy)
  // The decoder's preview of a photo has the photo's own size.
  const preview = await sharp(original).png({ compressionLevel: 1 }).toBuffer()
  const store = await BlobStore.initialize(
    join(root, 'blobs'),
    await readMediaStoreIdentity(fixture.db.pool),
  )
  await transaction(fixture.db.pool, async (client) => {
    await store.publish(client, original)
    await store.publish(client, preview)
  })
  const photo = await seedPhoto(fixture, capture.batch.id, PAGE, 'Large photo', 0, {
    original,
    preview,
  })
  await fixture.db.pool.query(
    'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
    [randomUUID(), capture.batch.id, photo.evidence, capture.packetA.id, fixture.identity.actor],
  )
  const session =
    stage === 'examine'
      ? await leadSession(fixture, capture)
      : await lotSession(fixture, capture, capture.packetA)
  if (stage === 'examine') {
    await fixture.db.pool.query(
      "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
      [
        randomUUID(),
        session.job,
        { evidence_id: photo.evidence, version_id: photo.version },
        photo.version,
      ],
    )
  }
  const token = await transaction(fixture.runner.pool, (client) =>
    issueSessionCapability(client, session.attempt),
  )
  const context = {
    pool: fixture.runner.pool,
    config: fixture.config,
    store,
    statusIntervalMs: 0,
    imageBudget: new Map<string, number>(),
    deliveredMedia: new Map<string, Set<string>>(),
    cropCacheDir: join(root, 'crops'),
  }
  return { context, tools: sessionTools(context), token, photo, session, original, store, capture }
}

/** The one delivered image, its decoded size, and the result's description of it. */
async function delivery(output: SessionToolOutput) {
  validate('SessionToolResult', output.result)
  assert.ok(output.result.ok, JSON.stringify(output.result))
  assert.equal(output.images?.length, 1)
  const image = output.images![0]!
  const bytes = Buffer.from(image.base64, 'base64')
  const { width, height } = await sharp(bytes).metadata()
  // Every delivery stays inside the per-image cap, whatever its content.
  assert.ok(bytes.length <= AGENT_IMAGE_MAX_BYTES, `${bytes.length} bytes`)
  if (!output.result.ok) {
    throw new Error('expected a delivery')
  }
  return { image, bytes, width, height, described: output.result.delivered }
}

test('a lot session gets a large photo bounded to 2,576 px, citing the original', async () => {
  const run = await largePhotoSession('lot')
  try {
    const reads: string[] = []
    const read = run.store.read.bind(run.store)
    run.store.read = async (blob: string) => {
      reads.push(blob)
      return read(blob)
    }
    const output = await run.tools.fetch_evidence(run.token, {
      evidence_id: run.photo.evidence,
      version_id: run.photo.version,
    })
    // The image comes from the decoded preview; the original upload's blob is never read.
    assert.ok(reads.length > 0 && !reads.includes(digest(run.original)), JSON.stringify(reads))
    const { image, bytes, width, height, described } = await delivery(output)
    assert.deepEqual([width, height], [1932, 2576])
    assert.equal(image.mediaType, 'image/jpeg')
    assert.deepEqual(described, {
      page: 1,
      width: 1932,
      height: 2576,
      scale: 0.644,
      media_type: 'image/jpeg',
      sha256: digest(bytes),
    })
    assert.ok(output.result.ok)
    if (output.result.ok) {
      assert.deepEqual(output.result.source, {
        kind: 'media_version',
        evidence_id: run.photo.evidence,
        version_id: run.photo.version,
        sha256: digest(run.original),
      })
    }
    assert.equal(run.context.deliveredMedia.get(run.session.job)?.has(run.photo.version), true)
  } finally {
    await run.dispose()
  }
})

test('a large region is scaled to fit and a small one stays lossless at scale 1', async () => {
  const run = await largePhotoSession('lot')
  try {
    const args = { evidence_id: run.photo.evidence, version_id: run.photo.version, page: 1 }
    const large = await delivery(
      await run.tools.fetch_evidence(run.token, {
        ...args,
        region: { x: 0, y: 0, width: 2800, height: 3600, ...sourceSize() },
      }),
    )
    assert.deepEqual([large.width, large.height], [2004, 2576])
    assert.equal(large.image.mediaType, 'image/jpeg')
    assert.equal(large.described?.scale, 0.7156)
    assert.deepEqual(large.described?.region, { x: 0, y: 0, width: 2800, height: 3600 })
    const small = await delivery(
      await run.tools.fetch_evidence(run.token, {
        ...args,
        region: { x: 100, y: 200, width: 300, height: 400, ...sourceSize() },
      }),
    )
    assert.deepEqual([small.width, small.height], [300, 400])
    assert.equal(small.image.mediaType, 'image/png')
    assert.equal(small.described?.scale, 1)
  } finally {
    await run.dispose()
  }
})

test('the Examine overview stays at 768 px and says so', async () => {
  const run = await largePhotoSession('examine')
  try {
    const overview = await delivery(
      await run.tools.fetch_evidence(run.token, {
        evidence_id: run.photo.evidence,
        version_id: run.photo.version,
      }),
    )
    assert.deepEqual([overview.width, overview.height], [576, 768])
    assert.equal(overview.described?.width, 576)
    assert.equal(overview.described?.scale, 0.192)
  } finally {
    await run.dispose()
  }
})

test('a requested page without a preview is refused and grants no delivery', async () => {
  const run = await largePhotoSession('lot')
  try {
    // The photo has one page; there is no page 2 preview to cut from.
    const output = await run.tools.fetch_evidence(run.token, {
      evidence_id: run.photo.evidence,
      version_id: run.photo.version,
      page: 2,
    })
    assert.deepEqual(
      [output.result.ok, !output.result.ok && output.result.error],
      [false, 'validation_failed'],
    )
    assert.equal(output.images, undefined)
    assert.equal(run.context.deliveredMedia.size, 0)
  } finally {
    await run.dispose()
  }
})

test('a detailed region too large as PNG comes back as JPEG under the size cap', async () => {
  const run = await largePhotoSession('lot', { noisy: true })
  try {
    const crop = await delivery(
      await run.tools.fetch_evidence(run.token, {
        evidence_id: run.photo.evidence,
        version_id: run.photo.version,
        page: 1,
        region: { x: 0, y: 0, width: 2000, height: 2000, ...sourceSize() },
      }),
    )
    assert.deepEqual([crop.width, crop.height], [2000, 2000])
    assert.equal(crop.described?.scale, 1)
    assert.equal(crop.image.mediaType, 'image/jpeg')
  } finally {
    await run.dispose()
  }
})

test('evidence removed while its preview is read is refused and grants nothing', async () => {
  const run = await largePhotoSession('lot')
  try {
    await grantMedia(run.fixture.db.pool, run.fixture.api.name, 'api')
    const read = run.store.read.bind(run.store)
    run.store.read = async (digest: string) => {
      const bytes = await read(digest)
      await mediaEditor(run.fixture.api.pool, run.fixture.config, run.capture.batch.id).applied({
        kind: 'remove',
        evidence_ids: [run.photo.evidence],
      })
      return bytes
    }
    const output = await run.tools.fetch_evidence(run.token, {
      evidence_id: run.photo.evidence,
      version_id: run.photo.version,
    })
    assert.deepEqual(
      [output.result.ok, !output.result.ok && output.result.error],
      [false, 'media_evidence_removed'],
    )
    assert.equal(output.images, undefined)
    assert.equal(run.context.deliveredMedia.size, 0)
    assert.equal(run.context.imageBudget.size, 0)
  } finally {
    await run.dispose()
  }
})

function sourceSize() {
  return { source_width: PAGE.width, source_height: PAGE.height }
}
