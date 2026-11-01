import { readMediaStoreIdentity } from '../../src/media/store-identity.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  validate,
  type CaptureSnapshotDto,
  type MediaReceiptDto,
  type MediaSnapshotDto,
} from '@invimport/contracts'
import { createServer } from '../../src/api/server.ts'
import { registerCapture } from '../../src/capture/routes.ts'
import { registerMediaRoutes } from '../../src/media/routes.ts'
import { blobReferenced, retainBlob } from '../../src/media/blob-reference.ts'
import { lockMediaBatch, lockMediaRevision } from '../../src/media/commands.ts'
import { BlobStore } from '../../src/media/blob-store.ts'
import { grantMedia } from '../../src/media/grants.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantProjection } from '../../src/operations/grants.ts'
import { grantCaptureRead } from '../../src/capture/grants.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import { lockMediaInputs } from '../../src/media/locked-inputs.ts'
import { canonical } from '@invimport/contracts/json'
import { canonicalMedia } from '../../src/media/encoding.ts'
import { sha256 } from '../../src/db/authority.ts'
import { mediaSnapshot } from '../../src/media/read.ts'
import { mediaRepository } from '../../src/media/repository.ts'
import { processMediaCommand } from '../../src/media/worker.ts'
import { editMedia } from '../../src/media/edit.ts'
import sharp from 'sharp'
import { grantCapture } from '../../src/capture/grants.ts'
import { database } from '../../src/db/database.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'

function captureValue(value: unknown): CaptureSnapshotDto {
  validate('CaptureSnapshot', value)
  return value as CaptureSnapshotDto
}

function receiptValue(value: unknown): MediaReceiptDto {
  validate('MediaReceipt', value)
  return value as MediaReceiptDto
}

function snapshotValue(value: unknown): MediaSnapshotDto {
  validate('MediaSnapshot', value)
  return value as MediaSnapshotDto
}

test('retained originals cross actual HTTP/PG/files/restart boundaries with no false receipt', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-pg-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const role = `intake_media_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
  )
  await grantFoundation(db.pool, role)
  await grantCapture(db.pool, role)
  await grantMedia(db.pool, role, 'api')
  const runtimeUrl = new URL(db.url)
  runtimeUrl.username = role
  runtimeUrl.password = password
  const runtime = database(runtimeUrl.toString())
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    credentialRef: 'owned_media_fixture',
    apiKey: 'fake-only',
  }
  let loseReceipt = false

  async function start() {
    const app = createServer(config, { mediaEnabled: true })
    registerCapture(app, runtime.pool, config)
    registerMediaRoutes(app, runtime.pool, config, store)
    app.addHook('onSend', async (request, reply, payload) => {
      if (loseReceipt && request.url.endsWith('/media/originals')) {
        loseReceipt = false
        reply.raw.destroy()
      }
      return payload
    })
    config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
    return app
  }

  let app = await start()
  const initialBootstrap = await (await fetch(`${config.origin}/api/v1/bootstrap`)).json()
  assert.equal(initialBootstrap.media_enabled, true)
  assert.equal(JSON.stringify(initialBootstrap).includes(root), false)
  let token = initialBootstrap.csrf_token as string

  async function command(path: string, body: unknown) {
    return fetch(config.origin + path, {
      method: 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  function upload(batchId: string, revision: string, key: string, bytes: Buffer) {
    return fetch(`${config.origin}/api/v1/batches/${batchId}/media/originals`, {
      method: 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': key,
        'content-type': 'application/octet-stream',
        'x-intake-media-revision': revision,
        'x-intake-media-label': encodeURIComponent('Packet <private>.jpg'),
      },
      body: new Uint8Array(bytes),
    })
  }

  try {
    const created = await command('/api/v1/batches', { title: 'Media fixture', note: '' })
    assert.equal(created.status, 201)
    const batch = captureValue(await created.json())
    const key = randomUUID()
    const original = Buffer.from('abc')
    const retained = await upload(batch.id, '1', key, original)
    assert.equal(retained.status, 200)
    const receipt = receiptValue(await retained.json())
    assert.equal(receipt.status, 'retained')
    assert.equal(receipt.version.state, 'queued')
    assert.equal(
      receipt.version.digest,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    assert.equal(receipt.version.media_type, 'application/octet-stream')
    const shadowClient = await runtime.pool.connect()
    try {
      await shadowClient.query('BEGIN')
      await shadowClient.query('CREATE TEMP TABLE capture_batch (LIKE public.capture_batch)')
      await shadowClient.query(
        'INSERT INTO pg_temp.capture_batch SELECT * FROM public.capture_batch',
      )
      await shadowClient.query('UPDATE pg_temp.capture_batch SET actor_id=$1', [randomUUID()])
      await shadowClient.query('CREATE TEMP TABLE media_evidence (LIKE public.media_evidence)')
      await shadowClient.query(
        'INSERT INTO pg_temp.media_evidence SELECT * FROM public.media_evidence',
      )
      await shadowClient.query(
        "UPDATE pg_temp.media_evidence SET label='Forged temporary evidence'",
      )
      await shadowClient.query('SET LOCAL search_path = pg_temp, public')
      const transactionBefore = await shadowClient.query<{ id: string }>(
        'SELECT pg_catalog.pg_current_xact_id()::text AS id',
      )
      const trusted = await mediaSnapshot(shadowClient, config, batch.id)
      assert.equal(trusted.evidence[0].label, 'Packet <private>.jpg')
      const transactionAfter = await shadowClient.query<{ id: string }>(
        'SELECT pg_catalog.pg_current_xact_id()::text AS id',
      )
      assert.equal(transactionAfter.rows[0].id, transactionBefore.rows[0].id)
      const path = await shadowClient.query<{ path: string }>(
        "SELECT pg_catalog.current_setting('search_path') AS path",
      )
      assert.equal(path.rows[0].path, 'pg_catalog, public, pg_temp')
    } finally {
      await shadowClient.query('ROLLBACK')
      shadowClient.release()
    }

    assert.deepEqual(await store.read(receipt.version.digest), original)

    const replay = await upload(batch.id, '1', key, original)
    assert.deepEqual(receiptValue(await replay.json()), receipt)
    assert.equal((await upload(batch.id, '1', key, Buffer.from('abd'))).status, 409)
    const stale = await upload(batch.id, '1', randomUUID(), original)
    assert.equal(stale.status, 412)

    const downloadUrl = `/api/v1/batches/${batch.id}/media/versions/${receipt.version.id}`
    const downloaded = await fetch(config.origin + downloadUrl)
    assert.equal(downloaded.headers.get('content-type'), 'application/octet-stream')
    assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment;/)
    assert.equal(downloaded.headers.get('content-security-policy'), "default-src 'none'; sandbox")
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original)
    const otherResponse = await command('/api/v1/batches', { title: 'Other batch', note: '' })
    const other = captureValue(await otherResponse.json())
    assert.equal((await fetch(config.origin + downloadUrl.replace(batch.id, other.id))).status, 404)

    loseReceipt = true
    const lostKey = randomUUID()
    await assert.rejects(upload(batch.id, '2', lostKey, Buffer.from('retained despite EOF')))
    await app.close()
    app = await start()
    token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json()).csrf_token as string
    const adopted = await upload(batch.id, '2', lostKey, Buffer.from('retained despite EOF'))
    assert.equal(adopted.status, 200)
    const adoptedReceipt = receiptValue(await adopted.json())
    const snapshotResponse = await fetch(`${config.origin}/api/v1/batches/${batch.id}/media`)
    const snapshot = snapshotValue(await snapshotResponse.json())
    assert.equal(snapshot.evidence.length, 2)
    assert.equal(snapshot.revision, '3')
    assert.ok(snapshot.evidence.some((evidence) => evidence.id === adoptedReceipt.evidence_id))
    await assert.rejects(runtime.pool.query('UPDATE media_version SET media_type=media_type'))
    await assert.rejects(
      runtime.pool.query(
        'INSERT INTO media_decode_claim(command_id,owner_id) SELECT id,$1 FROM media_decode_command LIMIT 1',
        [randomUUID()],
      ),
    )
  } finally {
    await app.close()
    await runtime.close()
    await db.pool.query(`DROP OWNED BY ${role}`)
    await db.pool.query(`DROP ROLE ${role}`)
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test(
  'restricted decoder publishes actual bytes but cannot edit drafts or choose effects',
  {
    skip: process.env.INTAKE_MEDIA_DECODER_IMAGE
      ? false
      : 'Explicit decoder image needed for PG/decoder boundary',
  },
  async () => {
    const db = await isolatedDatabase()
    const identity = await seedAuthority(db.pool)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-decoder-pg-')))
    const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const role = `intake_decoder_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    await db.pool.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 2`,
    )
    await grantProjection(db.pool, role)
    await grantCaptureRead(db.pool, role)
    await grantMedia(db.pool, role, 'decoder')
    const runtimeUrl = new URL(db.url)
    runtimeUrl.username = role
    runtimeUrl.password = password
    const runtime = database(runtimeUrl.toString())
    try {
      const capture = captureRepository(db.pool, binding)
      const batch = captureValue(
        await capture.create(randomUUID(), { title: 'Decoder role', note: '' }),
      )
      const original = await sharp(
        Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0]),
        { raw: { width: 3, height: 2, channels: 3 } },
      )
        .png()
        .toBuffer()
      const repository = mediaRepository(db.pool, binding, store)
      const receipt = receiptValue(
        await repository.upload(batch.id, randomUUID(), '1', 'Actual PNG', original),
      )
      const image = process.env.INTAKE_MEDIA_DECODER_IMAGE!
      assert.equal(await processMediaCommand(runtime.pool, store, binding, image), true)
      let snapshot = await repository.snapshot(batch.id)
      const version = snapshot.evidence[0].versions[0]
      assert.equal(version.state, 'ready')
      assert.deepEqual([version.pages[0].width, version.pages[0].height], [3, 2])
      assert.equal(await processMediaCommand(runtime.pool, store, binding, image), false)
      await editMedia(db.pool, binding, batch.id, randomUUID(), {
        expected_revision: snapshot.revision,
        change: {
          kind: 'derive',
          evidence_id: receipt.evidence_id,
          recipe: {
            version: 'documentary-crop/1',
            source_version_id: version.id,
            source_digest: version.digest,
            page: 1,
            source_width: 3,
            source_height: 2,
            x: 1,
            y: 0,
            width: 2,
            height: 2,
            quarter_turns: 1,
          },
        },
      })
      assert.equal(await processMediaCommand(runtime.pool, store, binding, image), true)
      snapshot = await repository.snapshot(batch.id)
      assert.equal(snapshot.evidence[0].versions.length, 2)
      const derived = snapshot.evidence[0].versions.find((item) => item.kind === 'derived')!
      assert.equal(derived.state, 'ready')
      assert.equal(derived.recipe?.source_digest, receipt.version.digest)
      const pixels = await sharp(await store.read(derived.digest))
        .removeAlpha()
        .raw()
        .toBuffer()
      assert.deepEqual([...pixels], [255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 0, 255])
      const interruptedReceipt = receiptValue(
        await repository.upload(
          batch.id,
          randomUUID(),
          snapshot.revision,
          'Interrupted original',
          original,
        ),
      )
      assert.equal(
        await processMediaCommand(runtime.pool, store, binding, 'sha256:' + '0'.repeat(64)),
        true,
      )
      const interruptedSnapshot = await repository.snapshot(batch.id)
      const interrupted = interruptedSnapshot.evidence
        .flatMap((item) => item.versions)
        .find((item) => item.id === interruptedReceipt.version.id)!
      assert.equal(interrupted.state, 'interrupted')
      assert.deepEqual(interrupted.pages, [])
      assert.equal(await processMediaCommand(runtime.pool, store, binding, image), false)
      assert.deepEqual(await store.read(interrupted.digest), original)
      await assert.rejects(runtime.pool.query('UPDATE capture_batch SET revision=revision+1'))
      await assert.rejects(runtime.pool.query('INSERT INTO command SELECT * FROM command LIMIT 1'))
      await assert.rejects(runtime.pool.query('UPDATE media_decode_command SET id=id'))
      await assert.rejects(runtime.pool.query('DELETE FROM media_version'))
      await assert.rejects(
        runtime.pool.query('INSERT INTO media_attachment_selection DEFAULT VALUES'),
      )
    } finally {
      await runtime.close()
      await db.pool.query(`DROP OWNED BY ${role}`)
      await db.pool.query(`DROP ROLE ${role}`)
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('digest publication excludes GC until committed references are visible; rollback leaves collectible orphan only', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-gc-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const publisher = await db.pool.connect()
  const collector = await db.pool.connect()
  let collection: Promise<boolean> | null = null
  try {
    const batch = captureValue(
      await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'Publication race',
        note: '',
      }),
    )
    await publisher.query('BEGIN')
    const orphan = await store.publish(publisher, Buffer.from('abc'))
    await publisher.query('ROLLBACK')
    const objectPath = join(root, 'objects', orphan.digest.slice(0, 2), orphan.digest)
    const aged = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    await utimes(objectPath, aged, aged)
    assert.equal((await db.pool.query('SELECT count(*) FROM media_version')).rows[0].count, '0')

    await publisher.query('BEGIN')
    const published = await store.publish(publisher, Buffer.from('abc'))
    await retainBlob(publisher, published)
    const evidenceId = randomUUID()
    await publisher.query(
      'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
      [evidenceId, batch.id, 'Retained after race', identity.actor],
    )
    await publisher.query(
      `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
      VALUES($1,$2,$3,'original',$4,'application/octet-stream',$5)`,
      [randomUUID(), batch.id, evidenceId, Buffer.from(published.digest, 'hex'), identity.actor],
    )
    await collector.query('BEGIN')
    const process = await collector.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    collection = store.collect(
      collector,
      published.digest,
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      blobReferenced,
    )
    let blocked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const wait = await db.pool.query<{ wait_event: string }>(
        'SELECT wait_event FROM pg_stat_activity WHERE pid=$1',
        [process.rows[0].pid],
      )
      if (wait.rows[0].wait_event === 'advisory') {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(blocked, true, 'Collector must wait on the publisher digest exclusion')
    await publisher.query('COMMIT')
    assert.equal(await collection, false)
    await collector.query('COMMIT')
    assert.equal((await store.read(published.digest)).toString(), 'abc')

    await publisher.query('BEGIN')
    const unreferenced = await store.publish(publisher, Buffer.from('unreferenced'))
    await publisher.query('ROLLBACK')
    const orphanPath = join(root, 'objects', unreferenced.digest.slice(0, 2), unreferenced.digest)
    await utimes(orphanPath, aged, aged)
    await collector.query('BEGIN')
    assert.equal(
      await store.collect(
        collector,
        unreferenced.digest,
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        blobReferenced,
      ),
      true,
    )
    await collector.query('COMMIT')
    await assert.rejects(store.read(unreferenced.digest))
    assert.equal((await store.read(published.digest)).toString(), 'abc')
  } finally {
    await publisher.query('ROLLBACK').catch(() => undefined)
    if (collection) {
      await collection.catch(() => undefined)
    }
    await collector.query('ROLLBACK').catch(() => undefined)
    publisher.release()
    collector.release()
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test(
  'opaque input handle locks digests before processing and rejects ownership, scope and transaction changes',
  {
    skip: process.env.INTAKE_MEDIA_DECODER_IMAGE
      ? false
      : 'Explicit decoder image needed for ready retained input fixture',
  },
  async () => {
    const db = await isolatedDatabase()
    const identity = await seedAuthority(db.pool)
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-handle-')))
    const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
    const caller = await db.pool.connect()
    const collector = await db.pool.connect()
    let collection: Promise<boolean> | null = null

    async function insertCommand(
      actorId: string,
      batchId: string,
      subjectId: string,
      manifestDigest: string,
    ) {
      const commandId = randomUUID()
      const payload = Buffer.from(
        canonical({ batchId, subjectId, mediaManifestDigest: manifestDigest }),
      )
      await caller.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
       VALUES($1,$2,$3,$4,'process','owned-media-pin-fixture/1',$5,'owned-media-pin-fixture',$6,$7)`,
        [
          commandId,
          actorId,
          identity.target,
          identity.context,
          `media-pin:${commandId}`,
          payload,
          sha256(payload),
        ],
      )
      return commandId
    }

    try {
      const capture = captureRepository(db.pool, binding)
      let batch = captureValue(
        await capture.create(randomUUID(), { title: 'Locked media', note: '' }),
      )
      batch = captureValue(
        await capture.edit(batch.id, randomUUID(), {
          expected_revision: batch.revision,
          change: { kind: 'add_lot', label: 'One retained lot', note: '', part_subject_id: null },
        }),
      )
      const lotId = batch.lots[0].id
      const png = await sharp(Buffer.from([12, 34, 56]), {
        raw: { width: 1, height: 1, channels: 3 },
      })
        .png()
        .toBuffer()
      const repository = mediaRepository(db.pool, binding, store)
      const receipt = receiptValue(
        await repository.upload(batch.id, randomUUID(), '1', 'Pin fixture', png),
      )
      await processMediaCommand(db.pool, store, binding, process.env.INTAKE_MEDIA_DECODER_IMAGE!)
      await editMedia(db.pool, binding, batch.id, randomUUID(), {
        expected_revision: '2',
        change: { kind: 'link', evidence_id: receipt.evidence_id, subject_id: lotId, linked: true },
      })
      await caller.query('BEGIN')
      const handle = await lockMediaInputs(caller, binding, batch.id, [lotId])
      assert.equal(handle.versions.length, 1)
      assert.equal(Reflect.set(handle.versions[0], 'digest', '0'.repeat(64)), false)
      assert.equal(Reflect.set(handle, 'manifest', '{}'), false)
      assert.throws(() => (handle.versions as unknown as unknown[]).push({}))

      await utimes(
        join(root, 'objects', receipt.version.digest.slice(0, 2), receipt.version.digest),
        new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      )
      await collector.query('BEGIN')
      const collectorPid = await collector.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      collection = store.collect(
        collector,
        receipt.version.digest,
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        blobReferenced,
      )
      let blocked = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await db.pool.query<{ wait_event: string }>(
          'SELECT wait_event FROM pg_stat_activity WHERE pid=$1',
          [collectorPid.rows[0].pid],
        )
        if (waiting.rows[0].wait_event === 'advisory') {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(blocked, true, 'Digest exclusion is held BEFORE the processing lane is acquired')
      await caller.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('owned-processing-fixture-lane',0))",
      )
      const commandId = await insertCommand(identity.actor, batch.id, lotId, handle.manifestDigest)
      await handle.pinCommand(commandId)
      await handle.pinCommand(commandId)
      const pins = await caller.query(
        'SELECT version_id FROM media_command_pin WHERE command_id=$1',
        [commandId],
      )
      assert.deepEqual(pins.rows, [{ version_id: receipt.version.id }])

      await caller.query('SAVEPOINT wrong_owner')
      const wrongActor = randomUUID()
      await caller.query("INSERT INTO operator VALUES($1,'development',$2)", [
        wrongActor,
        `fixture-${wrongActor}`,
      ])
      const wrongCommand = await insertCommand(wrongActor, batch.id, lotId, handle.manifestDigest)
      await assert.rejects(handle.pinCommand(wrongCommand), /media_pin_owner_binding_invalid/)
      await caller.query('ROLLBACK TO SAVEPOINT wrong_owner')
      await caller.query('COMMIT')
      assert.equal(await collection, false)
      await collector.query('COMMIT')

      await caller.query('BEGIN')
      await assert.rejects(handle.pinCommand(commandId), /media_input_transaction_changed/)
      await caller.query('ROLLBACK')
      await caller.query('BEGIN')
      await caller.query('SAVEPOINT before_handle')
      const rolledBack = await lockMediaInputs(caller, binding, batch.id, [lotId])
      await caller.query('ROLLBACK TO SAVEPOINT before_handle')
      await assert.rejects(rolledBack.pinCommand(commandId), /media_input_lock_lost/)
      await caller.query('ROLLBACK')
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM media_command_binding')).rows[0].count,
        '1',
      )
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM media_command_pin')).rows[0].count,
        '1',
      )
    } finally {
      await caller.query('ROLLBACK').catch(() => undefined)
      if (collection) {
        await collection.catch(() => undefined)
      }
      await collector.query('ROLLBACK').catch(() => undefined)
      caller.release()
      collector.release()
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('media edits wait on shared revision exclusion before publishing any blob', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-order-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const publisher = await db.pool.connect()
  const editor = await db.pool.connect()
  let waiting: Promise<unknown> | null = null
  try {
    const batch = captureValue(
      await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'Media ordering',
        note: '',
      }),
    )
    await publisher.query('BEGIN')
    await lockMediaRevision(publisher, batch.id)
    await editor.query('BEGIN')
    const backend = await editor.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    let acquired = false
    waiting = lockMediaBatch(editor, binding, batch.id, '1').then(() => {
      acquired = true
    })
    void waiting.catch(() => undefined)
    let blockedAtMedia = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await db.pool.query<{ wait_event: string | null; query: string }>(
        'SELECT wait_event,query FROM pg_stat_activity WHERE pid=$1',
        [backend.rows[0].pid],
      )
      const observed = state.rows[0]
      if (observed.wait_event === 'advisory' && observed.query.includes('bench-media-batch/1:')) {
        blockedAtMedia = true
        break
      }
      if (acquired) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(
      blockedAtMedia,
      true,
      'An ordinary media edit must wait for the decoder/media exclusion',
    )
    assert.equal(acquired, false)
    const files = await db.pool.query('SELECT count(*)::int AS count FROM media_blob')
    assert.equal(files.rows[0].count, 0)
    await publisher.query('COMMIT')
    await waiting
    const blob = await store.publish(editor, Buffer.from('abc'))
    assert.equal(blob.digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    await editor.query('ROLLBACK')
  } finally {
    await publisher.query('ROLLBACK').catch(() => undefined)
    if (waiting) {
      await waiting.catch(() => undefined)
    }
    await editor.query('ROLLBACK').catch(() => undefined)
    publisher.release()
    editor.release()
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('SELECT-only GC CLI collects one aged orphan and preserves retained bytes and history', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { Pool } = await import('pg')
  const run = promisify(execFile)
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-gc-cli-')))
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const role = `intake_gc_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 2`,
  )
  await grantMedia(db.pool, role, 'gc')
  const url = new URL(db.url)
  url.username = role
  url.password = password
  const restricted = new Pool({ connectionString: url.toString(), max: 1 })
  try {
    const batch = captureValue(
      await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'GC candidates',
        note: '',
      }),
    )
    const receipt = receiptValue(
      await mediaRepository(db.pool, binding, store).upload(
        batch.id,
        randomUUID(),
        '1',
        'Retained original',
        Buffer.from('abc'),
      ),
    )
    const client = await db.pool.connect()
    let orphan
    try {
      await client.query('BEGIN')
      orphan = await store.publish(client, Buffer.from('bounded orphan'))
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    const aged = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    for (const digest of [receipt.version.digest, orphan.digest]) {
      await utimes(join(root, 'objects', digest.slice(0, 2), digest), aged, aged)
    }
    async function collect(digest: string) {
      const result = await run(process.execPath, ['--import', 'tsx', 'src/media/gc-main.ts'], {
        cwd: new URL('../../', import.meta.url),
        timeout: 5000,
        maxBuffer: 8192,
        env: {
          PATH: process.env.PATH,
          INTAKE_DATABASE_URL: url.toString(),
          INTAKE_BLOB_ROOT: root,
          INTAKE_MEDIA_GC_DIGEST: digest,
          INTAKE_MEDIA_GC_BEFORE: cutoff,
        },
      })
      assert.equal(result.stderr, '')
      return JSON.parse(result.stdout)
    }
    assert.deepEqual(await collect(receipt.version.digest), {
      digest: receipt.version.digest,
      cutoff,
      collected: false,
    })
    assert.deepEqual(await collect(orphan.digest), {
      digest: orphan.digest,
      cutoff,
      collected: true,
    })
    assert.deepEqual(await collect(orphan.digest), {
      digest: orphan.digest,
      cutoff,
      collected: false,
    })
    assert.deepEqual(await store.read(receipt.version.digest), Buffer.from('abc'))
    await assert.rejects(store.read(orphan.digest))
    assert.equal(
      (await db.pool.query('SELECT count(*)::int AS count FROM media_version')).rows[0].count,
      1,
    )
    const grants = await db.pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name,privilege_type FROM information_schema.role_table_grants
       WHERE grantee=$1 AND table_schema='public' ORDER BY table_name,privilege_type`,
      [role],
    )
    assert.deepEqual(
      grants.rows,
      [
        'media_approval_pin',
        'media_command_pin',
        'media_preview',
        'media_store_identity',
        'media_version',
      ].map((table_name) => ({ table_name, privilege_type: 'SELECT' })),
    )
    await assert.rejects(
      restricted.query('UPDATE public.media_store_identity SET store_id=store_id'),
      { code: '42501' },
    )
    await assert.rejects(restricted.query('SELECT * FROM public.capture_batch'), { code: '42501' })
    await assert.rejects(restricted.query('SELECT * FROM public.command'), { code: '42501' })
    await assert.rejects(restricted.query('DELETE FROM public.media_version'), { code: '42501' })
  } finally {
    await restricted.end()
    await db.pool.query(`DROP OWNED BY ${role}`)
    await db.pool.query(`DROP ROLE ${role}`)
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('empty media handles reject rollback before acquisition but survive later savepoint rollback', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const caller = await db.pool.connect()
  try {
    const batch = captureValue(
      await captureRepository(db.pool, binding).create(randomUUID(), {
        title: 'Empty scope',
        note: '',
      }),
    )
    async function insertCommand() {
      const id = randomUUID()
      const payload = Buffer.from('{}')
      await caller.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
         VALUES($1,$2,$3,$4,'process','empty-scope-fixture/1',$5,'empty-scope-fixture',$6,$7)`,
        [
          id,
          identity.actor,
          identity.target,
          identity.context,
          `empty:${id}`,
          payload,
          sha256(payload),
        ],
      )
      return id
    }

    await caller.query('BEGIN')
    await caller.query('SAVEPOINT before_handle')
    const discarded = await lockMediaInputs(caller, binding, batch.id, [])
    assert.equal(discarded.versions.length, 0)
    await caller.query('ROLLBACK TO SAVEPOINT before_handle')
    // Reacquiring the same batch/media locks must not revive the old handle.
    const current = await lockMediaInputs(caller, binding, batch.id, [])
    const commandId = await insertCommand()
    await assert.rejects(discarded.pinCommand(commandId), /media_input_lock_lost/)
    assert.equal(
      (await caller.query('SELECT count(*) FROM media_command_binding')).rows[0].count,
      '0',
    )
    await caller.query('SAVEPOINT after_handle')
    await caller.query('ROLLBACK TO SAVEPOINT after_handle')
    await current.pinCommand(commandId)
    await current.pinCommand(commandId)
    assert.equal(
      (await caller.query('SELECT count(*) FROM media_command_binding')).rows[0].count,
      '1',
    )
    assert.equal((await caller.query('SELECT count(*) FROM media_command_pin')).rows[0].count, '0')
    await caller.query('COMMIT')
  } finally {
    await caller.query('ROLLBACK').catch(() => undefined)
    caller.release()
    await db.dispose()
  }
})

test(
  'derivation admission reserves queued capacity and publishes at most the schema version limit',
  { skip: process.env.INTAKE_MEDIA_DECODER_IMAGE ? false : 'Explicit decoder image required' },
  async () => {
    const db = await isolatedDatabase()
    const identity = await seedAuthority(db.pool)
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-capacity-')))
    try {
      const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
      const batch = captureValue(
        await captureRepository(db.pool, binding).create(randomUUID(), {
          title: 'Capacity',
          note: '',
        }),
      )
      const repository = mediaRepository(db.pool, binding, store)
      const png = await sharp(Buffer.from([40, 50, 60]), {
        raw: { width: 1, height: 1, channels: 3 },
      })
        .png()
        .toBuffer()
      const receipt = receiptValue(
        await repository.upload(batch.id, randomUUID(), '1', 'Capacity source', png),
      )
      await processMediaCommand(db.pool, store, binding, process.env.INTAKE_MEDIA_DECODER_IMAGE!)
      const recipe = {
        version: 'documentary-crop/1' as const,
        source_version_id: receipt.version.id,
        source_digest: receipt.version.digest,
        page: 1,
        source_width: 1,
        source_height: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        quarter_turns: 0,
      }
      const recipeBytes = Buffer.from(canonicalMedia(recipe))
      async function seedCompleted(state: 'ready' | 'interrupted') {
        const versionId = randomUUID()
        const commandId = randomUUID()
        await db.pool.query(
          `INSERT INTO media_derivation(id,batch_id,evidence_id,source_version_id,recipe_bytes,recipe_digest,actor_id)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            versionId,
            batch.id,
            receipt.evidence_id,
            receipt.version.id,
            recipeBytes,
            sha256(recipeBytes),
            identity.actor,
          ],
        )
        await db.pool.query(
          `INSERT INTO media_decode_command(id,batch_id,version_id,derivation_id,build)
           VALUES($1,$2,$3,$4,'bench-media-decoder/1')`,
          [commandId, batch.id, receipt.version.id, versionId],
        )
        await db.pool.query('INSERT INTO media_decode_claim(command_id,owner_id) VALUES($1,$2)', [
          commandId,
          randomUUID(),
        ])
        await db.pool.query(
          `INSERT INTO media_decode_result(command_id,state,decoder_build) VALUES($1,$2,'capacity-fixture/1')`,
          [commandId, state],
        )
        if (state === 'ready') {
          await db.pool.query(
            `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,source_version_id,recipe_bytes,recipe_digest,actor_id)
             VALUES($1,$2,$3,'derived',$4,'image/png',$5,$6,$7,$8)`,
            [
              versionId,
              batch.id,
              receipt.evidence_id,
              Buffer.from(receipt.version.digest, 'hex'),
              receipt.version.id,
              recipeBytes,
              sha256(recipeBytes),
              identity.actor,
            ],
          )
        }
      }
      // Seed bounded completed history; the final two publications use actual decoder bytes.
      for (let index = 0; index < 97; index++) {
        await seedCompleted('ready')
      }
      await seedCompleted('interrupted')
      async function derive(revision: string) {
        return editMedia(db.pool, binding, batch.id, randomUUID(), {
          expected_revision: revision,
          change: { kind: 'derive', evidence_id: receipt.evidence_id, recipe },
        })
      }
      await derive('2')
      await processMediaCommand(db.pool, store, binding, process.env.INTAKE_MEDIA_DECODER_IMAGE!)
      assert.equal(
        snapshotValue(await repository.snapshot(batch.id)).evidence[0].versions.length,
        99,
      )
      // Published derivations count once; the failed immutable attempt releases its reservation.
      await derive('3')
      await assert.rejects(derive('4'), /media_capacity/)
      await processMediaCommand(db.pool, store, binding, process.env.INTAKE_MEDIA_DECODER_IMAGE!)
      const retained = snapshotValue(await repository.snapshot(batch.id))
      assert.equal(retained.evidence[0].versions.length, 100)
      assert.equal(retained.derivations.filter((item) => item.state === 'queued').length, 0)
      assert.equal(retained.derivations.filter((item) => item.state === 'interrupted').length, 1)
      await assert.rejects(derive('4'), /media_capacity/)
    } finally {
      await db.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
)
