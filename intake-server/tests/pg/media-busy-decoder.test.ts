import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProjection } from '#/operations/grants.ts'
import { grantCaptureRead } from '#/capture/grants.ts'
import { captureRepository } from '#/capture/repository.ts'
import { mediaRepository } from '#/media/repository.ts'
import { launchDecoder } from '#/media/docker-decoder.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { database } from '#/db/database.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const skip = image ? false : 'Explicit decoder image needed for PG/decoder boundary'
/** A well-formed image reference for cases that never reach a decoder. */
const unusedImage = `sha256:${'0'.repeat(64)}`

/**
 * What the stand-in dispatcher answers: `busy` is another decode holding its one slot (503 before
 * anything runs), `free` runs the real decoder, and `fail` refuses after the request was read.
 */
type DispatcherMode = 'busy' | 'free' | 'fail'

/** A dispatcher on a private socket speaking `dispatcher-main.ts`'s protocol. */
async function standInDispatcher() {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-'))
  const socket = join(root, 'worker.sock')
  const replies: DispatcherMode[] = []
  let mode: DispatcherMode = 'busy'
  const answer = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/reserve' || req.url === '/activate') {
      req.resume()
      if (req.url === '/reserve')
        res.writeHead(200, { 'x-decoder-reservation': randomUUID(), 'content-length': 0 }).end()
      else res.writeHead(204).end()
      return
    }
    const current = mode
    replies.push(current)
    if (current === 'busy') {
      req.resume()
      res.writeHead(503, { connection: 'close' }).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    if (current === 'fail') {
      res.writeHead(502).end()
      return
    }
    const output = await launchDecoder(image!, Buffer.concat(chunks))
    res.writeHead(200, { 'content-length': output.length }).end(output)
  }
  const server = createServer((req, res) => {
    answer(req, res).catch(() => res.destroy())
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  return {
    socket,
    replies,
    set(next: DispatcherMode) {
      mode = next
    },
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * A batch with uploaded photos and media workers under their own login, limited to as many
 * connections as workers, so a worker that needs a second connection fails.
 */
async function busyFixture(workers: number, run: (fixture: BusyFixture) => Promise<void>) {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-busy-decoder-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const name = `intake_busy_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${workers}`,
  )
  await grantProjection(db.pool, name)
  await grantCaptureRead(db.pool, name)
  await grantMedia(db.pool, name, 'decoder')
  const url = new URL(db.url)
  url.username = name
  url.password = password
  const pools = Array.from({ length: workers }, () => database(url.toString()))
  const dispatcher = await standInDispatcher()
  const previousSocket = process.env.INTAKE_MEDIA_DISPATCH_SOCKET
  process.env.INTAKE_MEDIA_DISPATCH_SOCKET = dispatcher.socket
  const repository = mediaRepository(db.pool, binding, store)
  try {
    const batch = (await captureRepository(db.pool, binding).create(randomUUID(), {
      title: 'Busy decoder',
      note: '',
    })) as CaptureSnapshotDto
    let revision = 1
    await run({
      dispatcher,
      async upload(label: string) {
        const bytes = await sharp({
          create: { width: 6, height: 4, channels: 3, background: '#406080' },
        })
          .png()
          .toBuffer()
        await repository.upload(batch.id, randomUUID(), String(revision++), label, bytes)
      },
      work(worker = 0) {
        return processMediaCommand(pools[worker]!.pool, store, binding, image ?? unusedImage)
      },
      async version(label: string) {
        const snapshot = await repository.snapshot(batch.id)
        const evidence = snapshot.evidence.find((item) => item.label === label)!
        return evidence.versions[0]!
      },
      async results() {
        const rows = await db.pool.query<{ state: string }>(
          'SELECT state FROM media_decode_result ORDER BY created_at',
        )
        return rows.rows.map((row) => row.state)
      },
    })
  } finally {
    if (previousSocket === undefined) {
      delete process.env.INTAKE_MEDIA_DISPATCH_SOCKET
    } else {
      process.env.INTAKE_MEDIA_DISPATCH_SOCKET = previousSocket
    }
    await dispatcher.close()
    for (const worker of pools) {
      await worker.pool.end()
    }
    await db.pool.query(`DROP OWNED BY ${name}`)
    await db.pool.query(`DROP ROLE ${name}`)
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

interface BusyFixture {
  dispatcher: Awaited<ReturnType<typeof standInDispatcher>>
  upload: (label: string) => Promise<void>
  work: (worker?: number) => Promise<boolean>
  version: (label: string) => Promise<{ state: string; pages: unknown[] }>
  results: () => Promise<string[]>
}

test(
  'a decode that finds the dispatcher busy throughout stays queued, and the next worker run decodes it',
  { skip },
  async () => {
    await busyFixture(1, async ({ dispatcher, upload, work, version, results }) => {
      await upload('IMG_4100')
      assert.equal(await work(), true, 'the worker took the command')
      assert.equal(dispatcher.replies.length, 1, 'one explicit refusal after admission')
      assert.ok(dispatcher.replies.every((reply) => reply === 'busy'))
      assert.equal((await version('IMG_4100')).state, 'queued')
      assert.deepEqual(await results(), [], 'nothing ran, so nothing is recorded as its outcome')

      dispatcher.set('free')
      assert.equal(await work(), true)
      const decoded = await version('IMG_4100')
      assert.equal(decoded.state, 'ready')
      assert.equal(decoded.pages.length, 1)
      assert.deepEqual(await results(), ['ready'])
      assert.equal(await work(), false, 'a decoded command is not taken again')
    })
  },
)

test('a decode whose dispatcher fails after a busy reply still ends interrupted for good', async () => {
  await busyFixture(1, async ({ dispatcher, upload, work, version, results }) => {
    await upload('IMG_4101')
    assert.equal(await work(), true)
    dispatcher.set('fail')
    assert.equal(await work(), true)
    assert.equal(dispatcher.replies[0], 'busy')
    assert.equal(dispatcher.replies.at(-1), 'fail')
    assert.equal((await version('IMG_4101')).state, 'interrupted')
    assert.deepEqual(await results(), ['interrupted'])

    dispatcher.set('free')
    assert.equal(await work(), false, 'an interrupted decode is never replayed')
  })
})

test('two workers looking at once never both take a deferred decode', { skip }, async () => {
  await busyFixture(2, async ({ dispatcher, upload, work, version, results }) => {
    await upload('IMG_4102')
    assert.equal(await work(0), true)
    assert.equal((await version('IMG_4102')).state, 'queued')

    dispatcher.set('free')
    const before = dispatcher.replies.length
    const outcomes = await Promise.all([work(0), work(1)])
    assert.deepEqual(outcomes.sort(), [false, true])
    assert.deepEqual(dispatcher.replies.slice(before), ['free'], 'one decode ran')
    assert.equal((await version('IMG_4102')).state, 'ready')
    assert.deepEqual(await results(), ['ready'])
  })
})
