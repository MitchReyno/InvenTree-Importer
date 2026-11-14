import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { manualFixture } from '../support/manual.ts'
import { transaction } from '#/db/database.ts'
import { claimProcessingCommand } from '#/processing/runner.ts'
import { releaseProcessingLane } from '#/processing/state.ts'
import { lockLane } from '#/processing/scope.ts'
import { retainOriginalSource } from '#/execution/authority.ts'
import { verifyBytes } from '#/db/authority.ts'

const EXACT_REVISION = '9007199254740993'
const NEXT_REVISION = '9007199254740994'
const REOPENED_REVISION = '9007199254740995'

test('atomic job increments stay exact and stale lane release/conflict insertion cannot clear a newer claim', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const start = async () => {
      const response = await fixture.http(
        `/batches/${capture.batch.id}/processing`,
        {
          schema_version: 'bench-intake-processing/1',
          expected_capture_revision: capture.batch.revision,
          subject_ids: [capture.packetA.id],
          stages: ['reading'],
        },
        randomUUID(),
      )
      assert.equal(response.status, 202)
      const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(snapshot.status, 200)
      return (snapshot.value as ProcessingSnapshotDto).jobs[0]
    }
    const first = await start()
    await fixture.db.pool.query('UPDATE processing_job SET revision=$2 WHERE id=$1', [
      first.id,
      EXACT_REVISION,
    ])
    const second = await start()
    assert.equal(second.id, first.id)
    assert.equal(second.revision, NEXT_REVISION)
    assert.notEqual(second.attempt_id, first.attempt_id)
    const commands = await fixture.db.pool.query(
      `SELECT c.workflow_id,c.payload_bytes FROM command c
       JOIN processing_attempt a ON a.command_id=c.id WHERE a.id=$1`,
      [second.attempt_id],
    )
    const command = commands.rows[0]
    const claimed = await claimProcessingCommand(
      fixture.runner.pool,
      fixture.config,
      command.workflow_id,
      strictJson(command.payload_bytes.toString('utf8')),
      'processing/2',
    )
    assert.ok(claimed)
    await transaction(fixture.runner.pool, (client) =>
      releaseProcessingLane(client, first.attempt_id),
    )
    const stillHeld = await transaction(fixture.api.pool, (client) =>
      lockLane(client, fixture.config.actorId),
    )
    assert.equal(stillHeld.attempt_id, second.attempt_id)
    const observed = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.config.actorId],
    )
    assert.equal(observed.rows[0].attempt_id, second.attempt_id)
    await transaction(fixture.runner.pool, (client) =>
      releaseProcessingLane(client, second.attempt_id),
    )
    const released = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.config.actorId],
    )
    assert.equal(released.rows[0].attempt_id, null)
  } finally {
    await fixture.dispose()
  }
})

test('source conflict preserves its original binding; omitted title and explicit false keep exact capture history and JSON selections', async () => {
  const fixture = await manualFixture()
  try {
    const capture = await fixture.seedCapture()
    const source = {
      targetId: fixture.config.targetId,
      sourceId: capture.batch.source_id,
      originalSourceKey: capture.batch.source_id,
    }
    await transaction(fixture.db.pool, (client) => retainOriginalSource(client, source))
    await assert.rejects(
      () =>
        transaction(fixture.db.pool, (client) =>
          retainOriginalSource(client, { ...source, originalSourceKey: randomUUID() }),
        ),
      /original_source_binding_conflict/,
    )
    const retained = await fixture.db.pool.query(
      'SELECT original_key FROM executor_source WHERE target_id=$1 AND source_id=$2',
      [source.targetId, source.sourceId],
    )
    assert.equal(retained.rows[0].original_key, source.originalSourceKey)
    await fixture.db.pool.query('UPDATE capture_batch SET revision=$2 WHERE id=$1', [
      capture.batch.id,
      EXACT_REVISION,
    ])
    const archive = { expected_revision: EXACT_REVISION, change: { kind: 'batch', archived: true } }
    const archived = await fixture.http(`/batches/${capture.batch.id}/edits`, archive)
    assert.equal(archived.status, 200)
    assert.equal(archived.value.revision, NEXT_REVISION)
    assert.equal(archived.value.archived, true)
    assert.equal(archived.value.title, capture.batch.title)
    const reopen = { expected_revision: NEXT_REVISION, change: { kind: 'batch', archived: false } }
    const reopened = await fixture.http(`/batches/${capture.batch.id}/edits`, reopen)
    assert.equal(reopened.status, 200)
    assert.equal(reopened.value.revision, REOPENED_REVISION)
    assert.equal(reopened.value.archived, false)
    assert.equal(reopened.value.title, capture.batch.title)
    assert.deepEqual(reopened.value.lots, capture.batch.lots)
    assert.deepEqual(reopened.value.parts, capture.batch.parts)
    const history = await fixture.db.pool.query(
      'SELECT revision,command_bytes,command_digest FROM capture_revision WHERE batch_id=$1 AND revision>=$2 ORDER BY revision',
      [capture.batch.id, NEXT_REVISION],
    )
    assert.deepEqual(
      history.rows.map((row) => row.revision),
      [NEXT_REVISION, REOPENED_REVISION],
    )
    for (const [index, row] of history.rows.entries()) {
      verifyBytes(row.command_bytes, row.command_digest)
      assert.equal(row.command_bytes.toString('utf8'), canonical(index === 0 ? archive : reopen))
    }
  } finally {
    await fixture.dispose()
  }
})
