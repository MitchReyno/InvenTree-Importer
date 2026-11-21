import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import type { Pool, PoolClient } from 'pg'
import { manualFixture } from '../support/manual.ts'
import { captureInTransaction, lockCaptureForInputs } from '#/capture/repository.ts'
import { transaction } from '#/db/database.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { DECODER_BUILD } from '#/media/repository.ts'

const EXACT_REVISION = '9007199254740993'

async function backendPid(client: PoolClient) {
  const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  return result.rows[0].pid
}

async function observeBlocked(pool: Pool, waiter: number, holder: number) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      'SELECT $2::integer=ANY(pg_blocking_pids($1)) AS blocked',
      [waiter, holder],
    )
    if (result.rows[0].blocked) {
      return
    }
    await setTimeout(10)
  }
  assert.fail('Expected PostgreSQL to report the exact competing backend as blocked')
}

async function release(client: PoolClient) {
  await client.query('ROLLBACK').catch(() => undefined)
  client.release()
}

test('capture lock keeps exact revisions, permits ordinary reads and blocks a competing update until commit', async () => {
  const fixture = await manualFixture()
  const holder = await fixture.api.pool.connect()
  const waiter = await fixture.db.pool.connect()
  let update: Promise<unknown> | undefined
  try {
    const capture = await fixture.seedCapture()
    await fixture.db.pool.query('UPDATE capture_batch SET revision=$2 WHERE id=$1', [
      capture.batch.id,
      EXACT_REVISION,
    ])
    await holder.query('BEGIN')
    await waiter.query('BEGIN')
    const holderPid = await backendPid(holder)
    const waiterPid = await backendPid(waiter)
    const locked = await lockCaptureForInputs(
      holder,
      fixture.config,
      capture.batch.id,
      EXACT_REVISION,
    )
    assert.equal(locked.snapshot.revision, EXACT_REVISION)

    update = waiter.query('UPDATE capture_batch SET title=$2 WHERE id=$1', [
      capture.batch.id,
      'Competing edit',
    ])
    void update.catch(() => undefined)
    await observeBlocked(fixture.db.pool, waiterPid, holderPid)
    const observed = await transaction(fixture.api.pool, (client) =>
      captureInTransaction(client, fixture.config, capture.batch.id),
    )
    assert.equal(observed.snapshot.revision, EXACT_REVISION)
    assert.equal(observed.snapshot.title, 'Two physical packets')

    await holder.query('COMMIT')
    await update
    await waiter.query('COMMIT')
    const retained = await fixture.db.pool.query(
      'SELECT title,revision FROM capture_batch WHERE id=$1',
      [capture.batch.id],
    )
    assert.equal(retained.rows[0].title, 'Competing edit')
    assert.equal(retained.rows[0].revision, EXACT_REVISION)
  } finally {
    await release(holder)
    await update?.catch(() => undefined)
    await release(waiter)
    await fixture.dispose()
  }
})

test('capture read without locking and refused actor/target/context scopes leave another batch unlocked', async () => {
  const fixture = await manualFixture()
  const reader = await fixture.api.pool.connect()
  const probe = await fixture.db.pool.connect()
  try {
    const capture = await fixture.seedCapture()
    await reader.query('BEGIN')
    await captureInTransaction(reader, fixture.config, capture.batch.id)
    for (const key of ['actorId', 'targetId', 'targetContextId'] as const) {
      await assert.rejects(
        () =>
          captureInTransaction(
            reader,
            { ...fixture.config, [key]: randomUUID() },
            capture.batch.id,
            true,
          ),
        { code: 'not_found', statusCode: 404 },
      )
    }
    await probe.query('BEGIN')
    const result = await probe.query('SELECT id FROM capture_batch WHERE id=$1 FOR UPDATE NOWAIT', [
      capture.batch.id,
    ])
    assert.equal(result.rowCount, 1)
  } finally {
    await release(reader)
    await release(probe)
    await fixture.dispose()
  }
})

test('capture input locks subjects in ID order and rollback releases the acquired prefix', async () => {
  const fixture = await manualFixture()
  const middleHolder = await fixture.db.pool.connect()
  const waiter = await fixture.api.pool.connect()
  const probe = await fixture.db.pool.connect()
  let locking: ReturnType<typeof lockCaptureForInputs> | undefined
  try {
    const capture = await fixture.seedCapture()
    const ids = [capture.partId, capture.a.id, capture.b.id].sort()
    await middleHolder.query('BEGIN')
    await middleHolder.query('SELECT id FROM capture_subject WHERE id=$1 FOR UPDATE', [ids[1]])
    await waiter.query('BEGIN')
    const waiterPid = await backendPid(waiter)
    locking = lockCaptureForInputs(waiter, fixture.config, capture.batch.id)
    void locking.catch(() => undefined)
    await observeBlocked(fixture.db.pool, waiterPid, await backendPid(middleHolder))

    await probe.query('BEGIN')
    await assert.rejects(
      () => probe.query('SELECT id FROM capture_subject WHERE id=$1 FOR UPDATE NOWAIT', [ids[0]]),
      { code: '55P03' },
    )
    await probe.query('ROLLBACK')
    await probe.query('BEGIN')
    assert.equal(
      (await probe.query('SELECT id FROM capture_subject WHERE id=$1 FOR UPDATE NOWAIT', [ids[2]]))
        .rowCount,
      1,
    )
    await probe.query('ROLLBACK')

    await middleHolder.query('ROLLBACK')
    await locking
    await waiter.query('ROLLBACK')
    await probe.query('BEGIN')
    assert.equal(
      (
        await probe.query(
          'SELECT id FROM capture_subject WHERE batch_id=$1 ORDER BY id FOR UPDATE NOWAIT',
          [capture.batch.id],
        )
      ).rowCount,
      3,
    )
  } finally {
    await release(middleHolder)
    await release(probe)
    await locking?.catch(() => undefined)
    await release(waiter)
    await fixture.dispose()
  }
})

test('media claim skips a locked command and locks only its chosen command, not joined authority rows', async () => {
  const fixture = await manualFixture({ media: true })
  const blocker = await fixture.db.pool.connect()
  const probe = await fixture.db.pool.connect()
  let processing: Promise<boolean> | undefined
  try {
    const capture = await fixture.seedCapture()
    const store = fixture.store
    assert.ok(store)
    const evidenceId = randomUUID()
    const versions = [randomUUID(), randomUUID()]
    const commands = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]
    const digest = Buffer.alloc(32, 7)
    await fixture.db.pool.query('INSERT INTO media_blob(digest,byte_size) VALUES($1,1)', [digest])
    await fixture.db.pool.query(
      "INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,'Claim fixture',$3)",
      [evidenceId, capture.batch.id, fixture.config.actorId],
    )
    for (let index = 0; index < 2; index++) {
      await fixture.db.pool.query(
        "INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id) VALUES($1,$2,$3,'original',$4,'image/png',$5)",
        [versions[index], capture.batch.id, evidenceId, digest, fixture.config.actorId],
      )
      await fixture.db.pool.query(
        "INSERT INTO media_decode_command(id,batch_id,version_id,build,created_at) VALUES($1,$2,$3,$4,'2026-01-01T00:00:00Z')",
        [commands[index], capture.batch.id, versions[index], DECODER_BUILD],
      )
    }
    await blocker.query('BEGIN')
    await blocker.query('SELECT id FROM media_decode_command WHERE id=$1 FOR UPDATE', [commands[0]])
    await blocker.query('SAVEPOINT second_command')
    await blocker.query('SELECT id FROM media_decode_command WHERE id=$1 FOR UPDATE', [commands[1]])
    assert.equal(
      await processMediaCommand(
        fixture.db.pool,
        store,
        fixture.config,
        'unused-image-no-blob-present',
      ),
      false,
    )
    await blocker.query('ROLLBACK TO SAVEPOINT second_command')
    await blocker.query('LOCK TABLE media_decode_claim IN SHARE MODE')
    const holderPid = await backendPid(blocker)
    processing = processMediaCommand(
      fixture.db.pool,
      store,
      fixture.config,
      'unused-image-no-blob-present',
    )
    void processing.catch(() => undefined)
    const deadline = Date.now() + 3000
    let waiterPid: number | undefined
    while (Date.now() < deadline) {
      const waiting = await fixture.db.pool.query<{ pid: number }>(
        'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))',
        [holderPid],
      )
      if (waiting.rows.length) {
        waiterPid = waiting.rows[0].pid
        break
      }
      await setTimeout(10)
    }
    assert.ok(waiterPid, 'The selected claim insert must reach the deliberate table barrier')
    await probe.query('BEGIN')
    await probe.query('SELECT id FROM capture_batch WHERE id=$1 FOR UPDATE NOWAIT', [
      capture.batch.id,
    ])
    await probe.query('SELECT id FROM media_version WHERE id=$1 FOR UPDATE NOWAIT', [versions[1]])
    await assert.rejects(
      () =>
        probe.query('SELECT id FROM media_decode_command WHERE id=$1 FOR UPDATE NOWAIT', [
          commands[1],
        ]),
      { code: '55P03' },
    )
    await probe.query('ROLLBACK')
    await blocker.query('ROLLBACK')
    assert.equal(await processing, true)
    const claims = await fixture.db.pool.query('SELECT command_id FROM media_decode_claim')
    assert.deepEqual(claims.rows, [{ command_id: commands[1] }])
    const results = await fixture.db.pool.query(
      'SELECT state FROM media_decode_result WHERE command_id=$1',
      [commands[1]],
    )
    assert.equal(results.rows[0].state, 'interrupted')
  } finally {
    await release(blocker)
    await release(probe)
    await processing?.catch(() => undefined)
    await fixture.dispose()
  }
})
