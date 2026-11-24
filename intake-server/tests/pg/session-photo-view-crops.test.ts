import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession, nextSessionAttempt, seedPhoto } from '../support/sessions.ts'
import { mediaEditor } from '../support/media-removal.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { mediaContent } from '#/media/content.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools, type SessionToolContext } from '#/agents/tools/handlers.ts'
import { appendSessionOutbox } from '#/agents/tools/outbox.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** A page preview whose every pixel differs from its neighbours, so a misplaced cut shows. */
async function patterned(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3
      pixels[at] = x % 256
      pixels[at + 1] = y % 256
      pixels[at + 2] = (x * 7 + y * 13) % 256
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

async function raw(bytes: Buffer) {
  return sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}

interface Setup {
  fixture: Fixture
  store: BlobStore
  root: string
}

async function withMedia(run: (setup: Setup) => Promise<void>) {
  const fixture = await processingFixture({ autoStart: false })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'photo-view-crops-')))
  try {
    const store = await BlobStore.initialize(
      join(root, 'blobs'),
      await readMediaStoreIdentity(fixture.db.pool),
    )
    await fixture.start({ mediaStore: store })
    await run({ fixture, store, root })
  } finally {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

/** A stored photo whose preview is the given patterned page. */
async function storedPhoto(setup: Setup, batchId: string, size: { width: number; height: number }) {
  const preview = await patterned(size.width, size.height)
  const original = await sharp(preview).jpeg().toBuffer()
  await transaction(setup.fixture.db.pool, async (client) => {
    await setup.store.publish(client, original)
    await setup.store.publish(client, preview)
  })
  const photo = await seedPhoto(setup.fixture, batchId, size, 'Reel label', 0, {
    original,
    preview,
  })
  return { ...photo, preview }
}

function cropPath(batchId: string, jobId: string, attemptId: string, seq: string) {
  return `/api/v1/batches/${batchId}/processing/sessions/${jobId}/photo-views/${attemptId}/${seq}/crop`
}

async function crop(fixture: Fixture, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${fixture.config.origin}${path}`, {
    headers: { origin: fixture.config.origin, ...headers },
  })
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    bytes: Buffer.from(await response.arrayBuffer()),
  }
}

function tools(setup: Setup) {
  const context: SessionToolContext = {
    pool: setup.fixture.runner.pool,
    config: setup.fixture.config,
    store: setup.store,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
    cropCacheDir: join(setup.root, 'crops'),
  }
  return sessionTools(context)
}

async function viewSeq(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ seq: string }>(
    "SELECT seq::text FROM agent_session_outbox WHERE session_id=$1 AND kind='photo_view' ORDER BY seq DESC LIMIT 1",
    [attemptId],
  )
  return rows.rows[0].seq
}

test('a region view is recut as delivered, and a whole page at the size it was bounded to', async () => {
  await withMedia(async (setup) => {
    const { fixture } = setup
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const photo = await storedPhoto(setup, batchId, { width: 1200, height: 800 })
    await fixture.db.pool.query(
      'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
      [randomUUID(), batchId, photo.evidence, capture.packetA.id, fixture.identity.actor],
    )
    const session = await lotSession(fixture, capture, capture.packetA)
    const token = await transaction(fixture.runner.pool, (client) =>
      issueSessionCapability(client, session.attempt),
    )
    const fetched = await tools(setup).fetch_evidence(token, {
      evidence_id: photo.evidence,
      version_id: photo.version,
      region: { x: 40, y: 30, width: 200, height: 120, source_width: 1200, source_height: 800 },
    })
    assert.equal(fetched.images?.length, 1, JSON.stringify(fetched.result))
    const delivered = Buffer.from(fetched.images![0].base64, 'base64')
    const regionCrop = await crop(
      fixture,
      cropPath(batchId, session.job, session.attempt, await viewSeq(fixture, session.attempt)),
    )
    assert.equal(regionCrop.status, 200)
    assert.equal(regionCrop.type, 'image/png')
    // A small region is sent at its own size, as lossless PNG: the recut matches pixel for pixel.
    const [sent, recut] = [await raw(delivered), await raw(regionCrop.bytes)]
    assert.deepEqual([recut.info.width, recut.info.height], [200, 120])
    assert.ok(recut.data.equals(sent.data))
    const unchanged = await crop(
      fixture,
      cropPath(batchId, session.job, session.attempt, await viewSeq(fixture, session.attempt)),
      { 'if-none-match': regionCrop.etag! },
    )
    assert.equal(unchanged.status, 304)

    // The lead session's overview is bounded to 768 px; its recut is bounded the same way.
    const lead = await leadSession(fixture, capture)
    await fixture.db.pool.query(
      `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key)
       VALUES(gen_random_uuid(),$1,1,'evidence',$2,$3)`,
      [lead.job, { evidence_id: photo.evidence, version_id: photo.version }, photo.version],
    )
    const leadToken = await transaction(fixture.runner.pool, (client) =>
      issueSessionCapability(client, lead.attempt),
    )
    const overview = await tools(setup).fetch_evidence(leadToken, {
      evidence_id: photo.evidence,
      version_id: photo.version,
    })
    assert.equal(overview.images?.length, 1, JSON.stringify(overview.result))
    const page = await crop(
      fixture,
      cropPath(batchId, lead.job, lead.attempt, await viewSeq(fixture, lead.attempt)),
    )
    assert.equal(page.status, 200)
    const [shown, rebuilt] = [
      await raw(Buffer.from(overview.images![0].base64, 'base64')),
      await raw(page.bytes),
    ]
    assert.deepEqual([rebuilt.info.width, rebuilt.info.height], [768, 512])
    assert.deepEqual([shown.info.width, shown.info.height], [768, 512])
    let difference = 0
    for (let index = 0; index < shown.data.length; index += 1) {
      difference += Math.abs(shown.data[index] - rebuilt.data[index])
    }
    assert.ok(difference / shown.data.length < 4, 'the reconstruction is close to what was sent')
  })
})

test('two attempts with the same sequence each recut their own view', async () => {
  await withMedia(async (setup) => {
    const { fixture } = setup
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const photo = await storedPhoto(setup, batchId, { width: 400, height: 300 })
    const session = await lotSession(fixture, capture, capture.packetA)
    await fixture.db.pool.query("UPDATE processing_attempt SET state='failed' WHERE id=$1", [
      session.attempt,
    ])
    const retry = await nextSessionAttempt(fixture, capture, session, capture.packetA, 2, {
      id: 'synthetic-session/1',
    })
    const view = (x: number) => ({
      evidence_id: photo.evidence,
      version_id: photo.version,
      page: 1,
      region: { x, y: 0, width: 50, height: 40 },
      delivered: {
        width: 50,
        height: 40,
        media_type: 'image/png' as const,
        sha256: 'b'.repeat(64),
      },
    })
    await transaction(fixture.runner.pool, async (client) => {
      assert.equal(
        await appendSessionOutbox(client, session.attempt, {
          kind: 'photo_view',
          payload: view(0),
        }),
        1n,
      )
      assert.equal(
        await appendSessionOutbox(client, retry.attempt, {
          kind: 'photo_view',
          payload: view(200),
        }),
        1n,
      )
    })
    for (const [attemptId, x] of [
      [session.attempt, 0],
      [retry.attempt, 200],
    ] as const) {
      const response = await crop(fixture, cropPath(batchId, session.job, attemptId, '1'))
      assert.equal(response.status, 200)
      const expected = await raw(
        await sharp(photo.preview)
          .extract({ left: x, top: 0, width: 50, height: 40 })
          .png()
          .toBuffer(),
      )
      assert.ok((await raw(response.bytes)).data.equals(expected.data), `attempt at x=${x}`)
    }
  })
})

test('a removed version is not found, and the crop has the history’s scope', async () => {
  await withMedia(async (setup) => {
    const { fixture, store } = setup
    const capture = await fixture.seedCapture()
    const other = await fixture.seedCapture()
    const batchId = capture.batch.id
    const photo = await storedPhoto(setup, batchId, { width: 400, height: 300 })
    const session = await lotSession(fixture, capture, capture.packetA)
    const neighbour = await lotSession(fixture, capture, capture.packetB)
    await transaction(fixture.runner.pool, (client) =>
      appendSessionOutbox(client, session.attempt, {
        kind: 'photo_view',
        payload: {
          evidence_id: photo.evidence,
          version_id: photo.version,
          page: 1,
          delivered: { width: 200, height: 150, media_type: 'image/png', sha256: 'c'.repeat(64) },
        },
      }),
    )
    const path = cropPath(batchId, session.job, session.attempt, '1')
    const whole = await crop(fixture, path)
    assert.equal(whole.status, 200)
    assert.deepEqual(
      [(await raw(whole.bytes)).info.width, (await raw(whole.bytes)).info.height],
      [200, 150],
    )
    for (const outside of [
      cropPath(other.batch.id, session.job, session.attempt, '1'),
      cropPath(batchId, neighbour.job, session.attempt, '1'),
      cropPath(batchId, session.job, neighbour.attempt, '1'),
      cropPath(batchId, session.job, session.attempt, '2'),
    ]) {
      assert.equal((await crop(fixture, outside)).status, 404, outside)
    }
    // A sequence beyond a signed 64-bit integer is refused before it reaches PostgreSQL.
    const overflow = cropPath(batchId, session.job, session.attempt, '9223372036854775808')
    assert.equal((await crop(fixture, overflow)).status, 400)
    // Another account's binding finds nothing either.
    await assert.rejects(
      mediaContent(
        fixture.api.pool,
        { ...fixture.config, actorId: randomUUID() },
        store,
      ).photoViewCrop(
        batchId,
        { jobId: session.job, attemptId: session.attempt, seq: '1' },
        join(setup.root, 'crops'),
      ),
      { statusCode: 404 },
    )
    await mediaEditor(fixture.api.pool, fixture.config, batchId).applied({
      kind: 'remove',
      evidence_ids: [photo.evidence],
    })
    assert.equal((await crop(fixture, path)).status, 404)
  })
})
