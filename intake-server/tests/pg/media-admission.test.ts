import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { reserveLocalDecoder } from '#/media/local-launcher.ts'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { captureRepository } from '#/capture/repository.ts'
import { mediaRepository } from '#/media/repository.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { createDecoderDispatcher } from '#/media/decoder-dispatcher.ts'
import { launchDecoder } from '#/media/docker-decoder.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE

test(
  'parallel claims leave a saturated third photo eligible and publish duplicate originals independently',
  { skip: !image },
  async () => {
    const db = await isolatedDatabase()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'media-admit-')))
    const previousSocket = process.env.INTAKE_MEDIA_DISPATCH_SOCKET
    const started = barrier()
    const release = barrier()
    let dispatched = 0
    const server = createDecoderDispatcher(image!, 2, async (pinned, packet) => {
      dispatched++
      if (dispatched === 1) {
        started.resolve()
        await release.promise
      }
      return launchDecoder(pinned, packet)
    })
    const pending: Promise<boolean>[] = []
    try {
      const identity = await seedAuthority(db.pool)
      const binding = {
        actorId: identity.actor,
        targetId: identity.target,
        targetContextId: identity.context,
      }
      const socket = join(root, 'worker.sock')
      server.listen(socket)
      await once(server, 'listening')
      process.env.INTAKE_MEDIA_DISPATCH_SOCKET = socket
      const store = await BlobStore.initialize(
        join(root, 'blobs'),
        await readMediaStoreIdentity(db.pool),
      )
      const batch = (await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'Parallel',
        note: '',
      })) as CaptureSnapshotDto
      const repo = mediaRepository(db.pool, binding, store)
      const photo = await sharp({
        create: { width: 720, height: 480, channels: 3, background: 'red' },
      })
        .jpeg()
        .toBuffer()
      for (let i = 1; i <= 3; i++)
        await repo.upload(batch.id, randomUUID(), String(i), `Photo ${i}`, photo)
      const run = () => processMediaCommand(db.pool, store, binding, image!)
      const first = run()
      pending.push(first)
      await Promise.race([
        started.promise,
        first.then(() => {
          throw new Error('first decode never started')
        }),
      ])
      // Hold the other slot without claiming. The next worker has no authority to claim any photo.
      const { reserveDispatcher } = await import('#/media/dispatcher-client.ts')
      const held = await reserveDispatcher(socket, image!, 'figure')
      assert.ok(held)
      try {
        const cli = (endpoint: string) =>
          promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/media/worker-main.ts'], {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            timeout: 15000,
            env: {
              PATH: process.env.PATH,
              INTAKE_DATABASE_URL: db.url,
              INTAKE_BLOB_ROOT: join(root, 'blobs'),
              INTAKE_MEDIA_DISPATCH_SOCKET: endpoint,
              INTAKE_MEDIA_DECODER_IMAGE: image,
              INTAKE_ACTOR_ID: binding.actorId,
              INTAKE_TARGET_ID: binding.targetId,
              INTAKE_TARGET_CONTEXT_ID: binding.targetContextId,
            },
          })
        const local = join(root, 'direct')
        const directFigure = await reserveLocalDecoder(image!, 'figure', local)
        assert.ok(directFigure)
        try {
          assert.equal(await reserveLocalDecoder(image!, 'decode', local), null)
          const outcomes = await Promise.all([
            cli(socket),
            cli(socket),
            cli(join(local, 'worker.sock')),
          ])
          assert.ok(outcomes.every((result) => result.stdout.includes('No command acquired')))
        } finally {
          directFigure.release()
        }
        assert.equal(await run(), false)
        assert.equal(
          (await db.pool.query('SELECT count(*)::int AS n FROM media_decode_claim')).rows[0].n,
          1,
        )
      } finally {
        held.release()
      }
      assert.equal(await run(), true)
      assert.equal(
        (await db.pool.query('SELECT count(*)::int AS n FROM media_decode_result')).rows[0].n,
        1,
      )
      release.resolve()
      assert.equal(await first, true)
      assert.equal(await run(), true)
      const snapshot = await repo.snapshot(batch.id)
      assert.equal(snapshot.evidence.length, 3)
      assert.ok(snapshot.evidence.every((e) => e.versions[0]?.pages.length === 1))
      assert.equal(new Set(snapshot.evidence.map((e) => e.versions[0].pages[0].preview_id)).size, 3)
      assert.equal(dispatched, 3)
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
      if (previousSocket === undefined) delete process.env.INTAKE_MEDIA_DISPATCH_SOCKET
      else process.env.INTAKE_MEDIA_DISPATCH_SOCKET = previousSocket
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)
