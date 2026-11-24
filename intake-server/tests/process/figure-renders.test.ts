import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { processingCheckpoint } from '../support/processing-process.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { lotSession } from '../support/sessions.ts'
import {
  expectedLayout,
  figure,
  figureQuestion,
  linkToLot,
  mediaRole,
  patternedPage,
  seedPages,
} from '../support/question-figures.ts'
import { database, transaction } from '#/db/database.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { launchDecoder } from '#/media/decoder-runner.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProjection } from '#/operations/grants.ts'
import { grantCapture, grantCaptureRead } from '#/capture/grants.ts'
import { grantFoundation } from '#/operations/grants.ts'
import { grantProcessing } from '#/processing/grants.ts'
import { captureRepository } from '#/capture/repository.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools, type SessionToolOutput } from '#/agents/tools/handlers.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const skip = image ? false : 'Set INTAKE_MEDIA_DECODER_IMAGE to the explicitly built owned image'
const serverRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * A decoder dispatcher on a private socket with `dispatcher-main.ts`'s protocol: one POST /decode
 * for the pinned image, launched by the same `launchDecoder`. The deployed entry listens only on
 * the container's fixed `/run/decoder/worker.sock`, which a host test can't create.
 */
async function startDispatcher(pinned: string) {
  const directory = await mkdtemp('/tmp/fr-dispatch-')
  const socket = join(directory, 'worker.sock')
  let launched = 0
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (
        req.method !== 'POST' ||
        req.url !== '/decode' ||
        req.headers['x-decoder-image'] !== pinned
      ) {
        res.writeHead(403, { connection: 'close' }).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Buffer)
      }
      launched += 1
      const output = await launchDecoder(pinned, Buffer.concat(chunks))
      res.writeHead(200, { 'content-length': output.length }).end(output)
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(502)
      }
      res.end()
    })
  })
  server.listen(socket)
  await once(server, 'listening')
  return {
    socket,
    launched: () => launched,
    async close() {
      server.close()
      server.closeAllConnections()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function accepted(output: SessionToolOutput) {
  if (!output.result.ok) {
    throw new Error(`expected success: ${JSON.stringify(output.result)}`)
  }
  return output.result
}

/** Starts an intake-server entry as its own process and collects its output. */
function child(entry: string, env: Record<string, string>) {
  let output = ''
  const process_: ChildProcess = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: serverRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [process_.stdout!, process_.stderr!]) {
    stream.on('data', (bytes) => {
      output = (output + bytes.toString()).slice(-65536)
    })
  }
  return {
    process: process_,
    output: () => output,
    async stop() {
      if (process_.exitCode !== null || process_.signalCode !== null) {
        return
      }
      const closed = once(process_, 'close', { signal: AbortSignal.timeout(30000) })
      process_.kill('SIGTERM')
      await closed
    },
  }
}

const renders = (output: string) =>
  output.split('\n').filter((line) => line.includes('"figure_render"') && line.includes('rendered'))
    .length

test(
  'the supervised render consumer renders a five-figure preview through the dispatcher and recovers an expired lease',
  { skip, timeout: 240000 },
  async () => {
    const fixture = await processingFixture()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'figure-consumer-')))
    const dispatcher = await startDispatcher(image!)
    const media = await mediaRole(fixture)
    let consumer: ReturnType<typeof child> | undefined
    try {
      const store = await BlobStore.initialize(
        join(root, 'blobs'),
        await readMediaStoreIdentity(fixture.db.pool),
      )
      const capture = await fixture.seedCapture()
      const batchId = capture.batch.id
      const photo = await seedPages(fixture, store, batchId, {
        label: 'IMG_3020',
        mediaType: 'image/png',
        pages: [await patternedPage(640, 480, 1)],
      })
      const document = await seedPages(fixture, store, batchId, {
        label: 'Datasheet',
        mediaType: 'application/pdf',
        pages: [await patternedPage(600, 800, 2), await patternedPage(800, 600, 3)],
      })
      await linkToLot(fixture, batchId, photo.evidence, capture.packetA.id, 1)
      await linkToLot(fixture, batchId, document.evidence, capture.packetA.id, 2)
      const session = await lotSession(fixture, capture, capture.packetA)
      const token = await transaction(fixture.runner.pool, (client) =>
        issueSessionCapability(client, session.attempt),
      )
      const tools = sessionTools({
        pool: fixture.runner.pool,
        config: fixture.config,
        store,
        statusIntervalMs: 0,
        imageBudget: new Map(),
        deliveredMedia: new Map(),
        cropCacheDir: join(root, 'crops'),
        figurePreviewWaitMs: 150000,
      })
      for (const [item, page] of [
        [photo, 1],
        [document, 2],
      ] as const) {
        accepted(
          await tools.fetch_evidence(token, {
            evidence_id: item.evidence,
            version_id: item.version,
            page,
          }),
        )
      }
      const lot = capture.packetA.id
      const photoRegion = { x: 120, y: 80, width: 300, height: 200 }
      const asked = accepted(
        await tools.ask(
          token,
          figureQuestion(lot, [
            figure({
              evidence_id: photo.evidence,
              version_id: photo.version,
              page: 1,
              region: photoRegion,
            }),
          ]),
        ),
      )
      // A consumer died while rendering the question's view; its lease has since expired.
      await fixture.db.pool.query(
        `UPDATE processing_figure_render r SET lease_owner=$2, lease_expires_at=now()-interval '1 minute',
           attempts=1
         FROM processing_question_figure f
         WHERE f.question_id=$1 AND r.purpose='view' AND r.recipe_digest=f.recipe_digest`,
        [asked.id, randomUUID()],
      )

      consumer = child('src/media/render-worker-main.ts', {
        INTAKE_DATABASE_URL: media.url,
        INTAKE_BLOB_ROOT: join(root, 'blobs'),
        INTAKE_ACTOR_ID: fixture.identity.actor,
        INTAKE_TARGET_ID: fixture.identity.target,
        INTAKE_TARGET_CONTEXT_ID: fixture.identity.context,
        INTAKE_MEDIA_DECODER_IMAGE: image!,
        INTAKE_MEDIA_DISPATCH_SOCKET: dispatcher.socket,
      })
      await processingCheckpoint(
        async () => {
          assert.equal(consumer!.process.exitCode, null, consumer!.output())
          return consumer!.output()
        },
        (text) => text.includes('FIGURE_RENDER_READY'),
        30000,
      )

      const recovered = await processingCheckpoint(
        async () => {
          assert.equal(consumer!.process.exitCode, null, consumer!.output())
          const rows = await fixture.db.pool.query<{
            state: string
            attempts: number
            view: string | null
            view_width: number | null
            view_height: number | null
          }>(
            `SELECT r.state, r.attempts, encode(r.view_digest,'hex') AS view, r.view_width, r.view_height
             FROM processing_figure_render r JOIN processing_question_figure f
               ON r.purpose='view' AND r.recipe_digest=f.recipe_digest
             WHERE f.question_id=$1`,
            [asked.id],
          )
          return rows.rows[0]!
        },
        (row) => row.state !== 'queued',
        90000,
      )
      const photoRecipe = {
        version: 'bench-intake-view/1' as const,
        source_version_id: photo.version,
        source_digest: photo.source.sha256,
        page: 1,
        page_width: 640,
        page_height: 480,
        view: { region: photoRegion, quarter_turns: 0, straighten_millidegrees: 0 },
      }
      assert.deepEqual([recovered.state, recovered.attempts], ['ready', 2])
      assert.deepEqual(
        [recovered.view_width, recovered.view_height],
        Object.values(expectedLayout(photoRecipe)),
      )
      const view = await sharp(await store.read(recovered.view!)).metadata()
      assert.deepEqual(
        [view.format, view.width, view.height],
        ['webp', recovered.view_width, recovered.view_height],
      )

      // Four views of the photo and one of the document's second page, previewed with marks.
      const specs = [
        { region: photoRegion, quarterTurns: 1 },
        { region: { x: 0, y: 0, width: 640, height: 480 }, quarterTurns: 0 },
        { region: { x: 400, y: 300, width: 200, height: 150 }, quarterTurns: 2 },
        { region: { x: 10, y: 10, width: 100, height: 300 }, quarterTurns: 3 },
      ]
      const figures = [
        ...specs.map((spec, n) =>
          figure({
            evidence_id: photo.evidence,
            version_id: photo.version,
            page: 1,
            label: `Lead ${n + 1}`,
            ...spec,
          }),
        ),
        figure({
          evidence_id: document.evidence,
          version_id: document.version,
          page: 2,
          region: { x: 100, y: 50, width: 500, height: 400 },
          quarterTurns: 1,
        }),
      ]
      const before = dispatcher.launched()
      const output = await tools.ask(token, figureQuestion(lot, figures, true))
      const previewed = accepted(output)
      assert.equal(output.images?.length, 5)
      const expected = [
        ...specs.map((spec) =>
          expectedLayout({
            ...photoRecipe,
            view: {
              region: spec.region,
              quarter_turns: spec.quarterTurns,
              straighten_millidegrees: 0,
            },
          }),
        ),
        expectedLayout({
          version: 'bench-intake-view/1',
          source_version_id: document.version,
          source_digest: document.source.sha256,
          page: 2,
          page_width: 800,
          page_height: 600,
          view: {
            region: { x: 100, y: 50, width: 500, height: 400 },
            quarter_turns: 1,
            straighten_millidegrees: 0,
          },
        }),
      ]
      assert.deepEqual(
        previewed.preview?.map((entry) => ({ width: entry.width, height: entry.height })),
        expected,
      )
      assert.equal(dispatcher.launched() - before, 5, 'each preview rendered in the decoder')
      assert.ok(renders(consumer.output()) >= 6, consumer.output())
      const stored = await fixture.db.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM processing_question WHERE job_id=$1',
        [session.job],
      )
      assert.equal(stored.rows[0]!.count, 1, 'the preview posted no question')
    } finally {
      await consumer?.stop()
      await dispatcher.close()
      await media.close()
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)

/** Creates a role on `db` with the given grants, as the dev setup provisions it. */
async function devRole(
  db: Awaited<ReturnType<typeof isolatedDatabase>>,
  grant: (name: string) => Promise<void>,
) {
  const name = `intake_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 6`,
  )
  await grant(name)
  const url = new URL(db.url)
  url.username = name
  url.password = password
  url.hostname = '127.0.0.1'
  return { name, url: url.toString() }
}

test(
  'the dev media child renders a preview through the local launcher',
  { skip, timeout: 180000 },
  async () => {
    const db = await isolatedDatabase({ retainedDev: true })
    const root = await realpath(await mkdtemp(join(tmpdir(), 'figure-dev-media-')))
    const roles: string[] = []
    const pools: { close: () => Promise<void> }[] = []
    let mediaChild: ReturnType<typeof child> | undefined
    try {
      const identity = await seedAuthority(db.pool)
      const binding = {
        actorId: identity.actor,
        targetId: identity.target,
        targetContextId: identity.context,
      }
      const api = await devRole(db, async (name) => {
        await grantFoundation(db.pool, name)
        await grantCapture(db.pool, name)
        await grantProcessing(db.pool, name, 'api')
      })
      const runner = await devRole(db, (name) => grantProcessing(db.pool, name, 'runner'))
      const mediaUser = await devRole(db, async (name) => {
        await grantMedia(db.pool, name, 'decoder')
        await grantProjection(db.pool, name)
        await grantCaptureRead(db.pool, name)
        await db.pool.query(`GRANT UPDATE(revision) ON media_batch TO ${name}`)
      })
      roles.push(...[api, runner, mediaUser].map((role) => role.name))
      const blobRoot = join(root, 'retained/blobs')
      await mkdir(join(root, 'retained'), { mode: 0o700 })
      await writeFile(
        join(root, 'app.json'),
        JSON.stringify({
          version: 2,
          databaseName: db.name,
          identity,
          apiUrl: api.url,
          processingUrl: runner.url,
          mediaUrl: mediaUser.url,
          schedulerUrl: runner.url,
          blobRoot,
          channelSecret: randomBytes(32).toString('hex'),
          target: {
            kind: 'read-only',
            origin: 'http://127.0.0.1:9',
            credentialRef: 'figure_fixture',
          },
        }),
        { mode: 0o600 },
      )
      const store = await BlobStore.initialize(blobRoot, await readMediaStoreIdentity(db.pool))

      // A batch with a lot, a photo linked to it and the lot's running session.
      const captures = captureRepository(db.pool, binding)
      let batch = (await captures.create(randomUUID(), {
        title: 'Dev figures',
        note: '',
      })) as CaptureSnapshotDto
      batch = (await captures.edit(batch.id, randomUUID(), {
        expected_revision: batch.revision,
        change: { kind: 'add_lot', label: 'Packet A', note: '', part_subject_id: null },
      })) as CaptureSnapshotDto
      const packetA = batch.lots[0]!
      const owner = { db, identity, config: binding }
      const fixtureLike = owner as unknown as Parameters<typeof seedPages>[0]
      const photo = await seedPages(fixtureLike, store, batch.id, {
        label: 'IMG_3020',
        mediaType: 'image/png',
        pages: [await patternedPage(320, 240, 7)],
      })
      await linkToLot(fixtureLike, batch.id, photo.evidence, packetA.id, 1)
      const session = await lotSession(owner, { batch, packetA }, packetA)
      const runnerDb = database(runner.url)
      pools.push(runnerDb)
      const token = await transaction(runnerDb.pool, (client) =>
        issueSessionCapability(client, session.attempt),
      )
      const tools = sessionTools({
        pool: runnerDb.pool,
        config: {
          origin: 'http://127.0.0.1:1',
          ...binding,
          channelSecret: `synthetic-channel-${randomUUID()}`,
          credentialRef: 'figure_fixture',
          apiKey: 'synthetic-unused-no-target-transport',
        } as Parameters<typeof sessionTools>[0]['config'],
        store,
        statusIntervalMs: 0,
        imageBudget: new Map(),
        deliveredMedia: new Map(),
        cropCacheDir: join(root, 'crops'),
        figurePreviewWaitMs: 120000,
      })
      accepted(
        await tools.fetch_evidence(token, {
          evidence_id: photo.evidence,
          version_id: photo.version,
        }),
      )

      mediaChild = child('src/dev/media-main.ts', {
        INTAKE_APP_STATE: root,
        INTAKE_MEDIA_DECODER_IMAGE: image!,
      })
      await processingCheckpoint(
        async () => {
          assert.equal(mediaChild!.process.exitCode, null, mediaChild!.output())
          return mediaChild!.output()
        },
        (text) => text.includes('DEV_MEDIA_READY'),
        30000,
      )
      const region = { x: 30, y: 20, width: 200, height: 150 }
      const output = await tools.ask(
        token,
        figureQuestion(
          packetA.id,
          [
            figure({
              evidence_id: photo.evidence,
              version_id: photo.version,
              page: 1,
              region,
              quarterTurns: 1,
            }),
          ],
          true,
        ),
      )
      const previewed = accepted(output)
      assert.equal(output.images?.length, 1)
      assert.deepEqual(
        previewed.preview?.map((entry) => ({ width: entry.width, height: entry.height })),
        [
          expectedLayout({
            version: 'bench-intake-view/1',
            source_version_id: photo.version,
            source_digest: photo.source.sha256,
            page: 1,
            page_width: 320,
            page_height: 240,
            view: { region, quarter_turns: 1, straighten_millidegrees: 0 },
          }),
        ],
      )
      assert.equal(renders(mediaChild.output()), 1, mediaChild.output())
    } finally {
      await mediaChild?.stop()
      for (const pool of pools) {
        await pool.close()
      }
      for (const name of roles) {
        await db.pool.query(`DROP OWNED BY ${name}`)
      }
      await db.dispose()
      for (const name of roles) {
        const admin = database(process.env.INTAKE_TEST_ADMIN_URL!)
        await admin.pool.query(`DROP ROLE IF EXISTS ${name}`)
        await admin.close()
      }
      await rm(root, { recursive: true, force: true })
    }
  },
)
