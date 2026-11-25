import { cameraPhotos, recordPublicationTimes } from './media-load-fixtures.ts'
// Explicit disposable workload. Invoke once per profile so each run gets fresh database and RSS counters.
import { decoderResources } from './decoder-resources.ts'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as httpServer } from 'node:http'
import sharp from 'sharp'
import type { CaptureSnapshotDto, MediaReceiptDto } from '@invimport/contracts'
import { createServer } from '#/api/server.ts'
import { registerCapture } from '#/capture/routes.ts'
import { registerMediaRoutes } from '#/media/routes.ts'
import { database, transaction } from '#/db/database.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { scopedConnectionStatus } from '#/header/binding.ts'
import { createDecoderDispatcher } from '#/media/decoder-dispatcher.ts'
import { launchDecoder } from '#/media/docker-decoder.ts'
import { drainMedia } from '#/media/drain.ts'
import {
  enqueueFigureRenders,
  renderFigureStep,
  sweepFigureRenders,
} from '#/media/figure-renders.ts'
import { isolatedViewRenderer } from '#/media/figure-render-consumer.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantFoundation, grantProjection } from '#/operations/grants.ts'
import { grantCapture, grantCaptureRead } from '#/capture/grants.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/)
const profile = process.argv[2]
assert.ok(['original', 'shared', 'one', 'two', 'adverse'].includes(profile))
const slots = profile === 'two' || profile === 'adverse' ? 2 : 1
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const p95 = (values: number[]) =>
  values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]

async function run() {
  const db = await isolatedDatabase()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'media-load-')))
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const roleNames: string[] = []
  async function role(purpose: 'api' | 'decoder') {
    const name = 'intake_load_' + randomUUID().replaceAll('-', '')
    const password = randomUUID()
    await db.pool.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' CONNECTION LIMIT 4`)
    roleNames.push(name)
    await grantProjection(db.pool, name)
    await grantCaptureRead(db.pool, name)
    if (purpose === 'api') {
      await grantFoundation(db.pool, name)
      await grantCapture(db.pool, name)
    }
    await grantMedia(db.pool, name, purpose)
    const url = new URL(db.url)
    url.username = name
    url.password = password
    return url.toString()
  }
  const apiUrl = await role('api')
  const ordinary = database(apiUrl, profile === 'shared' || profile === 'original' ? 4 : 3)
  const health = profile === 'shared' || profile === 'original' ? ordinary : database(apiUrl, 1)
  const media = database(await role('decoder'), 4)
  const config = {
    ...binding,
    origin: 'http://127.0.0.1:1',
    credentialRef: 'synthetic',
    apiKey: 'synthetic',
  }
  const app = createServer(config, { mediaEnabled: true })
  const store = await BlobStore.initialize(
    join(root, 'blobs'),
    await readMediaStoreIdentity(db.pool),
  )
  registerCapture(app, ordinary.pool, config)
  registerMediaRoutes(app, ordinary.pool, config, store)
  const stop = new AbortController()
  let targetDown = profile === 'adverse'
  const target = httpServer((_req, res) =>
    res.writeHead(targetDown ? 503 : 200, { 'content-type': 'application/json' }).end('{}'),
  )
  target.listen(0, '127.0.0.1')
  await once(target, 'listening')
  const address = target.address()
  assert.ok(address && typeof address === 'object')
  const targetOrigin = 'http://127.0.0.1:' + address.port
  const outcomes: { outcome: string; ms: number; at: number }[] = []
  const status = scopedConnectionStatus(
    health.pool,
    binding,
    targetOrigin,
    (signal) => fetch(targetOrigin + '/api/part/?limit=1', { signal }),
    (signal) => fetch(targetOrigin + '/api/', { signal }),
    undefined,
    (outcome, ms) => outcomes.push({ outcome, ms, at: Date.now() }),
  )
  const engine = process.env.INTAKE_BENCH_ENGINE_SOCKET
  assert.ok(engine, 'Select the local engine socket for synthetic container metrics')
  const resources = decoderResources(engine)
  const durations: number[] = []
  const resourceTasks: Promise<void>[] = []
  let metricFailure: unknown
  let active = 0
  let peakActive = 0
  const dispatcher = createDecoderDispatcher(image!, slots, async (pinned, packet) => {
    active++
    peakActive = Math.max(active, peakActive)
    const start = performance.now()
    const id = randomUUID()
    const monitor = new AbortController()
    resourceTasks.push(
      resources.observe('bench-media-' + id, monitor.signal).catch((error) => {
        metricFailure = error
      }),
    )
    try {
      return await launchDecoder(pinned, packet, id)
    } finally {
      monitor.abort()
      active--
      durations.push(performance.now() - start)
    }
  })
  const socket = join(root, 'worker.sock')
  dispatcher.listen(socket)
  await once(dispatcher, 'listening')
  process.env.INTAKE_MEDIA_DISPATCH_SOCKET = socket
  const reads: number[] = [],
    liveness: number[] = [],
    ordinaryWait: number[] = [],
    healthWait: number[] = []
  let peakWaiters = 0
  let readers: Promise<void> | undefined
  let worker: Promise<void> | undefined
  let workerFailure: unknown
  try {
    config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
    async function request(path: string, options?: RequestInit) {
      const response = await fetch(config.origin + path, options)
      assert.ok(response.ok, path + ' returned ' + response.status)
      return response.json()
    }
    const csrf = (await request('/api/v1/bootstrap')).csrf_token
    const headers = () => ({
      origin: config.origin,
      'x-intake-csrf': csrf,
      'idempotency-key': randomUUID(),
    })
    async function batch(title: string) {
      return (await request('/api/v1/batches', {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ title, note: '' }),
      })) as CaptureSnapshotDto
    }
    async function upload(id: string, revision: number, bytes: Buffer) {
      return (await request('/api/v1/batches/' + id + '/media/originals', {
        method: 'POST',
        headers: {
          ...headers(),
          'content-type': 'application/octet-stream',
          'x-intake-media-revision': String(revision),
          'x-intake-media-label': 'Benchmark',
        },
        body: new Uint8Array(bytes),
      })) as MediaReceiptDto
    }
    const maintenance = await batch('Maintenance')
    const data = await sharp({
      create: { width: 800, height: 600, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer()
    const seed = await upload(maintenance.id, 1, data)
    assert.equal(await processMediaCommand(media.pool, store, binding, image!), true)
    await transaction(db.pool, async (client) => {
      await client.query(
        'ALTER TABLE media_preview_rendition DISABLE TRIGGER media_preview_rendition_immutable',
      )
      await client.query('DELETE FROM media_preview_rendition')
      await client.query(
        'ALTER TABLE media_preview_rendition ENABLE TRIGGER media_preview_rendition_immutable',
      )
      await enqueueFigureRenders(client, maintenance.id, [
        {
          recipe: {
            version: 'bench-intake-view/1',
            source_version_id: seed.version.id,
            source_digest: seed.version.digest,
            page: 1,
            page_width: 800,
            page_height: 600,
            view: {
              region: { x: 1, y: 1, width: 100, height: 100 },
              quarter_turns: 0,
              straighten_millidegrees: 0,
            },
          },
        },
      ])
    })
    await recordPublicationTimes(db.pool)
    const captures = await batch('Twelve retained photos')
    const inputs = await cameraPhotos()
    const probeErrors: Record<string, number> = {}
    async function timed(samples: number[], fn: () => Promise<unknown>, probe?: string) {
      const at = performance.now()
      try {
        await fn()
      } catch (error) {
        if (!probe) throw error
        probeErrors[probe] = (probeErrors[probe] ?? 0) + 1
      } finally {
        samples.push(performance.now() - at)
      }
    }
    let firstPreview = 0,
      lastPreview = 0
    const readErrors: Record<string, number> = {}
    async function captureRead() {
      const response = await fetch(config.origin + '/api/v1/batches/' + captures.id)
      await response.arrayBuffer()
      if (!response.ok) readErrors[response.status] = (readErrors[response.status] ?? 0) + 1
    }
    let issuedGroups = 0
    let missedGroups = 0
    async function traffic() {
      const pending = new Set<Promise<void>>()
      let next = performance.now()
      while (!stop.signal.aborted) {
        if (pending.size >= 4) missedGroups++
        else {
          issuedGroups++
          const group = Promise.all([
            ...Array.from({ length: 4 }, () => timed(reads, captureRead, 'capture_transport')),
            timed(liveness, () => request('/api/v1/health'), 'liveness'),
            status().catch(() => {
              probeErrors.scoped_snapshot = (probeErrors.scoped_snapshot ?? 0) + 1
            }),
            timed(
              ordinaryWait,
              async () => {
                const c = await ordinary.pool.connect()
                c.release()
              },
              'ordinary_checkout',
            ),
            timed(
              healthWait,
              async () => {
                const c = await health.pool.connect()
                c.release()
              },
              'health_checkout',
            ),
          ]).then(() => undefined)
          const handled = group
            .catch((error) => {
              workerFailure ??= error
              stop.abort()
            })
            .finally(() => pending.delete(handled))
          pending.add(handled)
        }
        next += 300
        await delay(Math.max(0, next - performance.now()))
      }
      await Promise.all(pending)
    }
    async function observePreviews() {
      while (!stop.signal.aborted && !lastPreview) {
        const snap = await db.pool.query(
          'SELECT count(*)::int AS n FROM media_preview WHERE batch_id=$1',
          [captures.id],
        )
        const observed = Date.now()
        if (snap.rows[0].n && !firstPreview) firstPreview = observed
        if (snap.rows[0].n === 12) lastPreview = observed
        else await delay(50)
      }
    }
    async function loadLegacy() {
      assert.ok(process.env.INTAKE_BENCH_BASELINE_ROOT)
      const module = pathToFileURL(
        join(process.env.INTAKE_BENCH_BASELINE_ROOT, 'intake-server/src/media/backfill.ts'),
      ).href
      const previous: typeof import('#/media/backfill.ts') = await import(module)
      return previous
    }
    const previous = profile === 'original' ? await loadLegacy() : undefined
    async function legacy() {
      assert.ok(previous)
      const render = isolatedViewRenderer(image!)
      await sweepFigureRenders(media.pool, store, binding)
      while (!stop.signal.aborted) {
        const step = await previous.mediaWorkerStep(media.pool, store, binding, image!)
        const figure = await renderFigureStep(media.pool, store, binding, render)
        if (previous.pauseAfter(step) && figure === 'idle') await delay(500)
      }
    }
    status.start()
    readers = Promise.all([traffic(), observePreviews()])
      .then(() => undefined)
      .catch((e) => {
        workerFailure ??= e
        stop.abort()
      })
    worker = (
      profile === 'original'
        ? legacy()
        : drainMedia(media.pool, store, binding, image!, slots, stop.signal)
    ).catch((e) => {
      workerFailure ??= e
      stop.abort()
    })
    const start = Date.now(),
      uploadMs: number[] = []
    const retained: MediaReceiptDto[] = []
    const waiting = setInterval(() => {
      peakWaiters = Math.max(peakWaiters, ordinary.pool.waitingCount)
    }, 5)
    waiting.unref()
    const cpu = process.cpuUsage()
    for (let i = 0; i < 12; i++) {
      const at = performance.now()
      retained.push(await upload(captures.id, i + 1, inputs[i % 6]))
      uploadMs.push(performance.now() - at)
    }
    const uploaded = Date.now()
    let recoveryAt = 0,
      recoveredMs: number | undefined
    if (profile === 'adverse') {
      assert.equal((await status.check()).target.state, 'unavailable')
      const held = await Promise.all(Array.from({ length: 3 }, () => ordinary.pool.connect()))
      try {
        await timed(liveness, () => request('/api/v1/health'), 'liveness')
        assert.equal((await status()).target.state, 'unavailable')
        await delay(500)
      } finally {
        for (const c of held) c.release()
      }
      targetDown = false
      recoveryAt = Date.now()
    }
    for (;;) {
      if (workerFailure) throw workerFailure
      assert.ok(Date.now() - start < 180_000, 'workload deadline')
      if (recoveryAt && !recoveredMs && (await status()).target.state === 'reachable')
        recoveredMs = Date.now() - recoveryAt
      const done = await db.pool.query(
        "SELECT EXISTS(SELECT 1 FROM processing_figure_render WHERE state='ready') AND EXISTS(SELECT 1 FROM media_rendition_backfill WHERE outcome='completed') AS ok",
      )
      if (lastPreview && done.rows[0].ok && (!recoveryAt || recoveredMs)) break
      await delay(50)
    }
    clearInterval(waiting)
    const end = Date.now()
    const used = process.cpuUsage(cpu)
    stop.abort()
    await worker
    await readers
    if (workerFailure) throw workerFailure
    await Promise.all(resourceTasks)
    if (metricFailure) throw metricFailure
    assert.ok(resources.result().engineSamples)
    const rows = await db.pool.query(
      `SELECT c.version_id, encode(v.blob_digest,'hex') AS original,encode(p.blob_digest,'hex') AS preview,
      p.width,p.height,t.publication_ms,extract(epoch FROM (h.created_at-c.created_at))*1000 AS queue_ms,extract(epoch FROM (r.created_at-h.created_at))*1000 AS prepare_ms
      FROM media_decode_command c JOIN media_decode_claim h ON h.command_id=c.id JOIN media_decode_result r ON r.command_id=c.id JOIN qualification_publication t ON t.command_id=c.id JOIN media_preview p ON p.command_id=c.id JOIN media_version v ON v.id=c.version_id WHERE c.batch_id=$1 AND r.state='ready'`,
      [captures.id],
    )
    assert.equal(rows.rowCount, 12)
    assert.equal(new Set(rows.rows.map((r) => r.version_id)).size, 12)
    const fingerprints = retained.map((receipt, i) => {
      const row = rows.rows.find((r) => r.version_id === receipt.version.id)
      assert.equal(row?.original, hash(inputs[i % 6]))
      assert.equal(row.width, i % 2 ? 1600 : 2400)
      assert.equal(row.height, i % 2 ? 2400 : 1600)
      return row.preview
    })
    assert.deepEqual(fingerprints.slice(0, 6), fingerprints.slice(6))
    const published = await db.pool.query(
      `SELECT p.version_id,encode(p.blob_digest,'hex') AS page,
      rr.size,encode(rr.blob_digest,'hex') AS rendition FROM media_preview p JOIN media_preview_rendition rr ON rr.preview_id=p.id WHERE p.batch_id=$1 ORDER BY rr.size`,
      [captures.id],
    )
    assert.equal(published.rowCount, 36)
    for (const digest of new Set<string>(published.rows.flatMap((r) => [r.page, r.rendition])))
      assert.equal(hash(await store.read(digest)), digest)
    const renditions = retained.map((r) =>
      published.rows.filter((x) => x.version_id === r.version.id).map((x) => x.rendition),
    )
    assert.deepEqual(renditions.slice(0, 6), renditions.slice(6))
    assert.ok(peakActive <= slots)
    console.log(
      JSON.stringify({
        profile,
        image,
        slots,
        wallMs: end - start,
        firstPreviewMs: firstPreview - start,
        lastPreviewMs: lastPreview - start,
        afterUploadMs: lastPreview - uploaded,
        uploadMs,
        queueMs: rows.rows.map((r) => Number(r.queue_ms)),
        prepareMs: rows.rows.map((r) => Number(r.prepare_ms)),
        decodeMs: durations,
        publicationMs: rows.rows.map((r) => Number(r.publication_ms)),
        readErrors,
        probeErrors,
        issuedGroups,
        missedGroups,
        readSamples: reads.length,
        readP95: p95(reads),
        localP95: p95(liveness),
        ordinaryCheckoutP95: p95(ordinaryWait),
        healthCheckoutP95: p95(healthWait),
        peakWaiters,
        peakActive,
        ...resources.result(),
        processMaxRssKiB: process.resourceUsage().maxRSS,
        processCpuSeconds: (used.user + used.system) / 1e6,
        outcomes,
        recoveredMs,
        fingerprints,
        renditions,
      }),
    )
  } finally {
    stop.abort()
    status.stop()
    await Promise.allSettled([worker, readers])
    await app.close()
    target.close()
    await dispatcher.drain()
    await ordinary.close()
    if (health !== ordinary) await health.close()
    await media.close()
    for (const name of roleNames) {
      await db.pool.query('DROP OWNED BY ' + name)
      await db.pool.query('DROP ROLE ' + name)
    }
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
await run()
