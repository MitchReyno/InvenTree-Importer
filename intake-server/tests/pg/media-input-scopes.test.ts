import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import type { PoolClient } from 'pg'
import { assertMediaInputManifest } from '@invimport/contracts/media'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import {
  captureRepository,
  lockCaptureForInputs,
  lockCaptureForInputSettlement,
} from '../../src/capture/repository.ts'
import { CaptureError } from '../../src/capture/model.ts'
import { sha256 } from '../../src/db/authority.ts'
import { blobLockCoordinates, lockBlob } from '../../src/media/blob-store.ts'
import { readCommandMediaInputs } from '../../src/media/command-inputs.ts'
import { editMedia } from '../../src/media/edit.ts'
import { canonicalMedia } from '../../src/media/encoding.ts'
import { MediaInputUnavailableError } from '../../src/media/input-errors.ts'
import {
  readMediaInputScopeResults,
  readMediaInputs,
  readMediaInputScopes,
} from '../../src/media/inputs.ts'
import { lockMediaInputScopes } from '../../src/media/locked-inputs.ts'
import {
  insertScopeCommand,
  mediaScopeFixture,
  type ScopeEvidence,
} from '../support/media-input-scopes.ts'

// Independent published byte budget, not imported from the implementation guard.
const PUBLISHED_INPUT_MAX_BYTES = 256 * 1024

function captureFailure(code: string) {
  return (error: unknown) => error instanceof CaptureError && error.code === code
}

function unavailable(reason: 'not_ready' | 'capacity') {
  return (error: unknown) => error instanceof MediaInputUnavailableError && error.reason === reason
}

async function readOnly(client: PoolClient) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
}

async function rollback(client: PoolClient) {
  await client.query('ROLLBACK').catch(() => undefined)
}

function expectedPins(evidence: readonly ScopeEvidence[]) {
  return evidence
    .map((item) => ({ version_id: item.versionId, digest: item.digest }))
    .sort((left, right) => left.version_id.localeCompare(right.version_id))
}

test('media scope reads stay read-only and snapshot-consistent while a writer changes relevant links', async () => {
  const fixture = await mediaScopeFixture()
  const reader = await fixture.pool.connect()
  try {
    const [evidence] = await fixture.seedEvidence([fixture.firstLotId])
    await readOnly(reader)
    const before = await readMediaInputs(reader, fixture.binding, fixture.batch.id, [
      fixture.firstLotId,
    ])
    assert.deepEqual(
      before.versions.map((version) => version.versionId),
      [evidence.versionId],
    )
    const locks = await reader.query(
      `SELECT locktype FROM pg_catalog.pg_locks
       WHERE pid=pg_catalog.pg_backend_pid() AND locktype IN ('advisory','tuple')`,
    )
    assert.deepEqual(
      locks.rows,
      [],
      'A read must not retain capture-row or media advisory exclusion',
    )

    await editMedia(fixture.pool, fixture.binding, fixture.batch.id, randomUUID(), {
      expected_revision: '1',
      change: {
        kind: 'link',
        evidence_id: evidence.evidenceId,
        subject_id: fixture.firstLotId,
        linked: false,
      },
    })
    const repeated = await readMediaInputs(reader, fixture.binding, fixture.batch.id, [
      fixture.firstLotId,
    ])
    assert.deepEqual(repeated.bytes, before.bytes)
    await reader.query('COMMIT')

    await readOnly(reader)
    const current = await readMediaInputs(reader, fixture.binding, fixture.batch.id, [
      fixture.firstLotId,
    ])
    assert.deepEqual(current.versions, [])
    assert.notDeepEqual(current.digest, before.digest)
    await reader.query('COMMIT')

    for (const wrongBinding of [
      { ...fixture.binding, actorId: randomUUID() },
      { ...fixture.binding, targetId: randomUUID() },
      { ...fixture.binding, targetContextId: randomUUID() },
    ]) {
      await readOnly(reader)
      await assert.rejects(
        readMediaInputs(reader, wrongBinding, fixture.batch.id, [fixture.firstLotId]),
        captureFailure('not_found'),
      )
      await rollback(reader)
    }
    const foreignCapture = captureRepository(fixture.pool, fixture.binding)
    const otherCreated = await foreignCapture.create(randomUUID(), {
      title: 'Other owned batch',
      note: '',
    })
    validate('CaptureSnapshot', otherCreated)
    const otherBatch = otherCreated as CaptureSnapshotDto
    const otherEdited = await foreignCapture.edit(otherBatch.id, randomUUID(), {
      expected_revision: otherBatch.revision,
      change: { kind: 'add_lot', label: 'Foreign subject', note: '', part_subject_id: null },
    })
    validate('CaptureSnapshot', otherEdited)
    const otherLotId = (otherEdited as CaptureSnapshotDto).lots[0].id
    await readOnly(reader)
    await assert.rejects(
      readMediaInputs(reader, fixture.binding, fixture.batch.id, [otherLotId]),
      captureFailure('not_found'),
    )
    await assert.rejects(
      readMediaInputs(reader, fixture.binding, randomUUID(), []),
      captureFailure('not_found'),
    )
    await assert.rejects(
      readMediaInputs(reader, fixture.binding, fixture.batch.id, [randomUUID()]),
      captureFailure('not_found'),
    )
  } finally {
    await rollback(reader)
    reader.release()
    await fixture.dispose()
  }
})

test('per-closure blockers preserve ready scopes and command capacity refuses the whole reservation', async () => {
  const fixture = await mediaScopeFixture()
  const client = await fixture.pool.connect()
  try {
    const ready = await fixture.seedEvidence([fixture.firstLotId])
    await fixture.seedEvidence([fixture.secondLotId], 1, false)
    await fixture.seedEvidence([fixture.emptyLotId], 65)
    await readOnly(client)
    const results = await readMediaInputScopeResults(client, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
      [fixture.secondLotId],
      [fixture.emptyLotId],
      [],
    ])
    assert.equal(results[0].kind, 'ready')
    if (results[0].kind !== 'ready' || results[3].kind !== 'ready') {
      throw new Error('Expected independently ready closures')
    }
    assert.deepEqual(
      results[0].inputs.versions.map((version) => version.versionId),
      [ready[0].versionId],
    )
    assert.deepEqual(results[1], { kind: 'blocked', code: 'media_not_ready' })
    assert.deepEqual(results[2], { kind: 'blocked', code: 'media_input_capacity' })
    assert.deepEqual(results[3].inputs.versions, [])
    const tooManyScopes = Array.from({ length: 101 }, () => [fixture.firstLotId])
    await assert.rejects(
      readMediaInputScopeResults(client, fixture.binding, fixture.batch.id, tooManyScopes),
      unavailable('capacity'),
    )
    await assert.rejects(
      readMediaInputScopes(client, fixture.binding, fixture.batch.id, [
        [fixture.firstLotId],
        [fixture.secondLotId],
      ]),
      unavailable('not_ready'),
    )
    await client.query('COMMIT')

    await client.query('BEGIN')
    await lockCaptureForInputs(client, fixture.binding, fixture.batch.id)
    await assert.rejects(
      lockMediaInputScopes(client, fixture.binding, fixture.batch.id, [
        [fixture.firstLotId],
        [fixture.emptyLotId],
      ]),
      unavailable('capacity'),
    )
    await rollback(client)
    const retained = await fixture.pool.query(
      'SELECT count(*)::text AS count FROM media_command_binding',
    )
    assert.equal(retained.rows[0].count, '0')
  } finally {
    await rollback(client)
    client.release()
    await fixture.dispose()
  }
})

test('media input byte capacity rejects a broad closure while the same 64 versions fit a narrower scope', async () => {
  const fixture = await mediaScopeFixture()
  const client = await fixture.pool.connect()
  try {
    const capture = captureRepository(fixture.pool, fixture.binding)
    let currentBatch = fixture.batch
    for (let index = 0; index < 97; index++) {
      const edited = await capture.edit(currentBatch.id, randomUUID(), {
        expected_revision: currentBatch.revision,
        change: {
          kind: 'add_lot',
          label: `Byte capacity lot ${index}`,
          note: '',
          part_subject_id: null,
        },
      })
      validate('CaptureSnapshot', edited)
      currentBatch = edited as CaptureSnapshotDto
    }
    const allSubjects = currentBatch.lots.map((lot) => lot.id)
    assert.equal(allSubjects.length, 100)
    await fixture.seedEvidence(allSubjects, 64)
    await readOnly(client)
    const narrow = await readMediaInputs(client, fixture.binding, fixture.batch.id, [
      fixture.firstLotId,
    ])
    assert.equal(narrow.versions.length, 64)
    assert.ok(narrow.bytes.length < PUBLISHED_INPUT_MAX_BYTES)
    await assert.rejects(
      readMediaInputs(client, fixture.binding, fixture.batch.id, allSubjects),
      unavailable('capacity'),
    )
    const results = await readMediaInputScopeResults(client, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
      allSubjects,
    ])
    assert.equal(results[0].kind, 'ready')
    assert.deepEqual(results[1], { kind: 'blocked', code: 'media_input_capacity' })
  } finally {
    await rollback(client)
    client.release()
    await fixture.dispose()
  }
})

test('bulk handles support a union over 64 versions and retain exact independent subsets and empty binding', async () => {
  const fixture = await mediaScopeFixture()
  const caller = await fixture.pool.connect()
  try {
    const first = await fixture.seedEvidence([fixture.firstLotId], 32)
    const second = await fixture.seedEvidence([fixture.secondLotId], 33)
    await caller.query('BEGIN')
    await lockCaptureForInputs(caller, fixture.binding, fixture.batch.id)
    const handles = await lockMediaInputScopes(caller, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
      [fixture.secondLotId],
      [fixture.emptyLotId],
    ])
    assert.deepEqual(
      handles.map((handle) => handle.versions.length),
      [32, 33, 0],
    )
    const commandIds: string[] = []
    for (const handle of handles) {
      const commandId = await insertScopeCommand(
        caller,
        fixture.binding,
        fixture.batch.id,
        handle.manifestDigest,
      )
      await handle.pinCommand(commandId)
      commandIds.push(commandId)
    }
    await caller.query('COMMIT')

    for (const [index, expected] of [first, second, []].entries()) {
      const pins = await fixture.pool.query(
        `SELECT version_id,encode(blob_digest,'hex') AS digest FROM media_command_pin
         WHERE command_id=$1 ORDER BY version_id`,
        [commandIds[index]],
      )
      assert.deepEqual(pins.rows, expectedPins(expected))
      await readOnly(caller)
      const retained = await readCommandMediaInputs(
        caller,
        fixture.binding,
        fixture.batch.id,
        commandIds[index],
      )
      assert.equal(retained.bytes.toString('utf8'), handles[index].manifest)
      assert.equal(retained.digest.toString('hex'), handles[index].manifestDigest)
      await caller.query('COMMIT')
    }
    const bindings = await fixture.pool.query(
      'SELECT count(*)::text AS count FROM media_command_binding',
    )
    assert.equal(
      bindings.rows[0].count,
      '3',
      'An exact-empty scope still has retained command authority',
    )
  } finally {
    await rollback(caller)
    caller.release()
    await fixture.dispose()
  }
})

test('the complete globally sorted digest union is held before high-first scope handles are returned', async () => {
  const fixture = await mediaScopeFixture()
  const caller = await fixture.pool.connect()
  const blocker = await fixture.pool.connect()
  let reservation: Promise<unknown> | undefined
  try {
    const first = await fixture.seedEvidence([fixture.firstLotId])
    const second = await fixture.seedEvidence([fixture.secondLotId])
    const entries = [
      { subjectId: fixture.firstLotId, evidence: first[0] },
      { subjectId: fixture.secondLotId, evidence: second[0] },
    ].sort((left, right) => left.evidence.digest.localeCompare(right.evidence.digest))
    const [low, high] = entries
    await caller.query('BEGIN')
    const pid = await caller.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    await lockCaptureForInputs(caller, fixture.binding, fixture.batch.id)
    await blocker.query('BEGIN')
    await lockBlob(blocker, high.evidence.digest)
    reservation = lockMediaInputScopes(caller, fixture.binding, fixture.batch.id, [
      [high.subjectId],
      [low.subjectId],
    ])

    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await fixture.pool.query<{ wait_event: string }>(
        'SELECT wait_event FROM pg_stat_activity WHERE pid=$1',
        [pid.rows[0].pid],
      )
      if (state.rows[0].wait_event === 'advisory') {
        waiting = true
        break
      }
      await delay(20)
    }
    assert.equal(waiting, true, 'The reservation reaches the deliberately blocked high digest')
    const coordinate = blobLockCoordinates(low.evidence.digest)
    const lowerLock = await fixture.pool.query(
      `SELECT 1 FROM pg_catalog.pg_locks
       WHERE pid=$1 AND locktype='advisory' AND granted
         AND classid=$2::oid AND objid=$3::oid AND objsubid=1`,
      [pid.rows[0].pid, coordinate.classId, coordinate.objectId],
    )
    assert.equal(
      lowerLock.rowCount,
      1,
      'The lower digest must be held despite the high-first request order',
    )
    const noPins = await fixture.pool.query(
      'SELECT count(*)::text AS count FROM media_command_binding',
    )
    assert.equal(noPins.rows[0].count, '0')
    await blocker.query('COMMIT')
    const handles = await reservation
    assert.equal(Array.isArray(handles), true)
  } finally {
    await rollback(blocker)
    if (reservation) {
      await reservation.catch(() => undefined)
    }
    await rollback(caller)
    blocker.release()
    caller.release()
    await fixture.dispose()
  }
})

test('retained input reads reject missing pins and correctly hashed false version facts without repair', async () => {
  const fixture = await mediaScopeFixture()
  const client = await fixture.pool.connect()
  try {
    const [first] = await fixture.seedEvidence([fixture.firstLotId])
    const [other] = await fixture.seedEvidence([fixture.secondLotId])
    await client.query('BEGIN')
    await lockCaptureForInputs(client, fixture.binding, fixture.batch.id)
    const [handle] = await lockMediaInputScopes(client, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
    ])
    const valid = await insertScopeCommand(
      client,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    await handle.pinCommand(valid)
    const absent = await insertScopeCommand(
      client,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    const missingPins = await insertScopeCommand(
      client,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    await client.query(
      `INSERT INTO media_command_binding(command_id,batch_id,actor_id,target_id,target_context_id,manifest_bytes,manifest_digest)
       SELECT $1,batch_id,actor_id,target_id,target_context_id,manifest_bytes,manifest_digest
       FROM media_command_binding WHERE command_id=$2`,
      [missingPins, valid],
    )
    const changed = strictJson(handle.manifest)
    assertMediaInputManifest(changed)
    changed.versions[0].evidenceId = other.evidenceId
    const falseBytes = Buffer.from(canonicalMedia(changed))
    const falseFacts = await insertScopeCommand(
      client,
      fixture.binding,
      fixture.batch.id,
      sha256(falseBytes).toString('hex'),
    )
    await client.query(
      `INSERT INTO media_command_binding(command_id,batch_id,actor_id,target_id,target_context_id,manifest_bytes,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        falseFacts,
        fixture.batch.id,
        fixture.binding.actorId,
        fixture.binding.targetId,
        fixture.binding.targetContextId,
        falseBytes,
        sha256(falseBytes),
      ],
    )
    await client.query(
      'INSERT INTO media_command_pin(command_id,batch_id,version_id,blob_digest) VALUES($1,$2,$3,$4)',
      [falseFacts, fixture.batch.id, first.versionId, Buffer.from(first.digest, 'hex')],
    )
    const extraPin = await insertScopeCommand(
      client,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    await handle.pinCommand(extraPin)
    await client.query(
      'INSERT INTO media_command_pin(command_id,batch_id,version_id,blob_digest) VALUES($1,$2,$3,$4)',
      [extraPin, fixture.batch.id, other.versionId, Buffer.from(other.digest, 'hex')],
    )
    await client.query('COMMIT')
    const otherCreated = await captureRepository(fixture.pool, fixture.binding).create(
      randomUUID(),
      {
        title: 'Other retained-command scope',
        note: '',
      },
    )
    validate('CaptureSnapshot', otherCreated)
    const otherBatchId = (otherCreated as CaptureSnapshotDto).id

    await readOnly(client)
    await assert.rejects(
      readCommandMediaInputs(client, fixture.binding, otherBatchId, valid),
      captureFailure('media_command_binding_missing'),
    )
    assert.equal(
      (await readCommandMediaInputs(client, fixture.binding, fixture.batch.id, valid)).versions[0]
        .versionId,
      first.versionId,
    )
    await assert.rejects(
      readCommandMediaInputs(client, fixture.binding, fixture.batch.id, absent),
      captureFailure('media_command_binding_missing'),
    )
    for (const commandId of [missingPins, falseFacts, extraPin]) {
      await assert.rejects(
        readCommandMediaInputs(client, fixture.binding, fixture.batch.id, commandId),
        captureFailure('media_command_binding_corrupt'),
      )
    }
    await assert.rejects(
      readCommandMediaInputs(
        client,
        { ...fixture.binding, actorId: randomUUID() },
        fixture.batch.id,
        valid,
      ),
      captureFailure('not_found'),
    )
    await client.query('COMMIT')
    const missing = await fixture.pool.query(
      'SELECT count(*)::text AS count FROM media_command_pin WHERE command_id=$1',
      [missingPins],
    )
    assert.equal(missing.rows[0].count, '0')
    const noBinding = await fixture.pool.query(
      'SELECT count(*)::text AS count FROM media_command_binding WHERE command_id=$1',
      [absent],
    )
    assert.equal(noBinding.rows[0].count, '0')
  } finally {
    await rollback(client)
    client.release()
    await fixture.dispose()
  }
})

test('minimum reader grants permit archived settlement but deny human edits, media writes and pin creation', async () => {
  const fixture = await mediaScopeFixture()
  const administrator = await fixture.pool.connect()
  let reader: PoolClient | undefined
  try {
    await fixture.seedEvidence([fixture.firstLotId])
    await administrator.query('BEGIN')
    await lockCaptureForInputs(administrator, fixture.binding, fixture.batch.id)
    const [handle] = await lockMediaInputScopes(administrator, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
    ])
    const commandId = await insertScopeCommand(
      administrator,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    await handle.pinCommand(commandId)
    const unpinnedCommand = await insertScopeCommand(
      administrator,
      fixture.binding,
      fixture.batch.id,
      handle.manifestDigest,
    )
    await administrator.query('COMMIT')
    const runtime = await fixture.createReader()
    reader = await runtime.pool.connect()
    await readOnly(reader)
    const current = await readMediaInputs(reader, fixture.binding, fixture.batch.id, [
      fixture.firstLotId,
    ])
    const retained = await readCommandMediaInputs(
      reader,
      fixture.binding,
      fixture.batch.id,
      commandId,
    )
    assert.deepEqual(retained.bytes, current.bytes)
    await reader.query('COMMIT')
    await reader.query('BEGIN')
    await lockCaptureForInputs(reader, fixture.binding, fixture.batch.id, fixture.batch.revision)
    const [readHandle] = await lockMediaInputScopes(reader, fixture.binding, fixture.batch.id, [
      [fixture.firstLotId],
    ])
    await assert.rejects(readHandle.pinCommand(unpinnedCommand), { code: '42501' })
    await rollback(reader)

    for (const sql of [
      'UPDATE capture_subject SET label=label',
      'UPDATE capture_batch SET title=title',
      'INSERT INTO capture_note SELECT * FROM capture_note LIMIT 1',
      'INSERT INTO capture_selection SELECT * FROM capture_selection LIMIT 1',
      'INSERT INTO media_version SELECT * FROM media_version LIMIT 1',
      'UPDATE media_batch SET revision=revision',
      'INSERT INTO media_command_pin SELECT * FROM media_command_pin LIMIT 1',
    ]) {
      await assert.rejects(reader.query(sql), { code: '42501' })
    }
    await assert.rejects(
      reader.query('UPDATE capture_subject SET id=$1 WHERE id=$2', [
        randomUUID(),
        fixture.firstLotId,
      ]),
      { code: '23000' },
    )
    await captureRepository(fixture.pool, fixture.binding).edit(fixture.batch.id, randomUUID(), {
      expected_revision: fixture.batch.revision,
      change: { kind: 'batch', archived: true },
    })
    await reader.query('BEGIN')
    await assert.rejects(
      lockCaptureForInputs(reader, fixture.binding, fixture.batch.id),
      captureFailure('batch_archived'),
    )
    await rollback(reader)
    await reader.query('BEGIN')
    const settled = await lockCaptureForInputSettlement(reader, fixture.binding, fixture.batch.id)
    assert.equal(settled.snapshot.archived, true)
    await reader.query('COMMIT')
  } finally {
    if (reader) {
      await rollback(reader)
      reader.release()
    }
    await rollback(administrator)
    administrator.release()
    await fixture.dispose()
  }
})
