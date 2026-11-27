import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { processingFixture } from '../support/processing.ts'
import { inputManifest, sealed } from '#/processing/model.ts'
import { claimProcessingCommand } from '#/processing/runner.ts'
import { channelToken } from '#/processing/attempts.ts'
import { transaction } from '#/db/database.ts'
import { readCommandMediaInputs } from '#/media/command-inputs.ts'
import { strictJson } from '@invimport/contracts/json'

/** Explicit historical fixture, not execution of an old build under the new worker. */
test('legacy bytes remain inspectable but queued /1 commands need an explicit V2 attempt with a real empty binding', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const manifest = sealed(inputManifest(capture.batch, capture.packetB.id, 'reading', [], null))
    const jobId = randomUUID()
    const attemptId = randomUUID()
    const inputId = randomUUID()
    const commandId = randomUUID()
    const payload = sealed({
      schema_version: 'bench-intake-processing-command/1',
      job_id: jobId,
      attempt_id: attemptId,
      input_id: inputId,
      input_sha256: manifest.digest.toString('hex'),
      profile_id: 'synthetic-research/1',
      handler_version: 'processing/1',
      command_id: commandId,
    })
    await transaction(fixture.db.pool, async (client) => {
      await client.query(
        'INSERT INTO processing_input(id,batch_id,capture_revision,manifest_bytes,manifest_digest) VALUES($1,$2,$3,$4,$5)',
        [inputId, capture.batch.id, capture.batch.revision, manifest.bytes, manifest.digest],
      )
      await client.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
        VALUES($1,$2,$3,$4,'process','processing/1',$5,'bench-research',$6,$7)`,
        [
          commandId,
          fixture.identity.actor,
          fixture.identity.target,
          fixture.identity.context,
          `processing:${attemptId}`,
          payload.bytes,
          payload.digest,
        ],
      )
      await client.query(
        "INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,$3,'reading',$4,'queued')",
        [jobId, capture.batch.id, capture.packetB.id, attemptId],
      )
      await client.query(
        `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
        VALUES($1,$2,$3,1,$4,'synthetic-research/1',$5,$6,'queued')`,
        [
          attemptId,
          capture.batch.id,
          jobId,
          inputId,
          commandId,
          sealed(channelToken(fixture.config, attemptId)).digest,
        ],
      )
      await client.query('INSERT INTO outbox(command_id) VALUES($1)', [commandId])
    })
    const read = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(read.status, 200)
    assert.equal(read.value.jobs[0].state, 'queued')
    assert.equal(read.value.jobs[0].blocked_code, 'worker_version_conflict')
    await assert.rejects(
      () =>
        claimProcessingCommand(
          fixture.runner.pool,
          fixture.config,
          `processing:${attemptId}`,
          strictJson(payload.bytes.toString()),
          'processing/2',
        ),
      /worker_version_conflict/,
    )
    const replacement = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetB.id],
      stages: ['reading'],
    })
    assert.equal(replacement.status, 202)
    assert.notEqual(replacement.value.attempt_ids[0], attemptId)
    const fresh = await fixture.db.pool.query(
      'SELECT command_id FROM processing_attempt WHERE id=$1',
      [replacement.value.attempt_ids[0]],
    )
    await transaction(fixture.runner.pool, async (client) => {
      const retained = await readCommandMediaInputs(
        client,
        fixture.config,
        capture.batch.id,
        fresh.rows[0].command_id,
      )
      assert.deepEqual(retained.versions, [])
      assert.deepEqual(retained.subjectIds, [capture.packetB.id])
    })
    const oldBytes = await fixture.db.pool.query(
      'SELECT manifest_bytes, manifest_digest FROM processing_input WHERE id=$1',
      [inputId],
    )
    assert.deepEqual(oldBytes.rows[0], {
      manifest_bytes: manifest.bytes,
      manifest_digest: manifest.digest,
    })
    const current = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(current.value.jobs[0].attempt_number, '2')
    assert.equal(current.value.jobs[0].blocked_code, undefined)
  } finally {
    await fixture.dispose()
  }
})

test('a V2 command without an owning retained media binding fails closed before any runner claim', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetB.id],
      stages: ['reading'],
    })
    assert.equal(started.status, 202)
    const originals = await fixture.db.pool.query('SELECT * FROM processing_attempt WHERE id=$1', [
      started.value.attempt_ids[0],
    ])
    const original = originals.rows[0]
    const inputs = await fixture.db.pool.query(
      'SELECT manifest_digest FROM processing_input WHERE id=$1',
      [original.input_id],
    )
    const attemptId = randomUUID()
    const commandId = randomUUID()
    const payload = sealed({
      schema_version: 'bench-intake-processing-command/2',
      job_id: original.job_id,
      attempt_id: attemptId,
      input_id: original.input_id,
      input_sha256: inputs.rows[0].manifest_digest.toString('hex'),
      profile_id: 'synthetic-research/2',
      handler_version: 'processing/2',
      command_id: commandId,
    })
    await transaction(fixture.db.pool, async (client) => {
      await client.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
        VALUES($1,$2,$3,$4,'process','processing/2',$5,'bench-research',$6,$7)`,
        [
          commandId,
          fixture.identity.actor,
          fixture.identity.target,
          fixture.identity.context,
          `processing:${attemptId}`,
          payload.bytes,
          payload.digest,
        ],
      )
      await client.query(
        `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
        VALUES($1,$2,$3,99,$4,'synthetic-research/2',$5,$6,'queued')`,
        [
          attemptId,
          capture.batch.id,
          original.job_id,
          original.input_id,
          commandId,
          sealed(channelToken(fixture.config, attemptId)).digest,
        ],
      )
    })
    await assert.rejects(
      () =>
        claimProcessingCommand(
          fixture.runner.pool,
          fixture.config,
          `processing:${attemptId}`,
          strictJson(payload.bytes.toString()),
          'processing/2',
        ),
      /media_command_binding_missing/,
    )
    const lane = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.identity.actor],
    )
    assert.ok(lane.rows.every((row) => row.attempt_id === null))
    const input = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(input.status, 200)
    assert.equal(input.value.jobs[0].attempt_id, original.id)
  } finally {
    await fixture.dispose()
  }
})

test('runner claim fences a hostile session search path before looking up retained command identity', async () => {
  const fixture = await processingFixture()
  const runner = new Pool({ connectionString: fixture.runner.url, max: 1 })
  try {
    const capture = await fixture.seedCapture()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetB.id],
      stages: ['reading'],
    })
    assert.equal(started.status, 202)
    const retained = await fixture.db.pool.query(
      `SELECT command.workflow_id, command.payload_bytes FROM command
       JOIN processing_attempt attempt ON attempt.command_id = command.id WHERE attempt.id = $1`,
      [started.value.attempt_ids[0]],
    )
    const command = retained.rows[0]
    const forgedId = randomUUID()
    await runner.query('SET search_path TO pg_temp, public')
    await runner.query('CREATE TEMP TABLE command(id uuid, workflow_id text)')
    await runner.query('INSERT INTO pg_temp.command VALUES($1,$2)', [forgedId, command.workflow_id])
    // Negative control: an unfenced authority lookup demonstrably sees the forged identity.
    const shadowed = await runner.query('SELECT id FROM command WHERE workflow_id=$1', [
      command.workflow_id,
    ])
    assert.deepEqual(shadowed.rows, [{ id: forgedId }])
    const claimed = await claimProcessingCommand(
      runner,
      fixture.config,
      command.workflow_id,
      strictJson(command.payload_bytes.toString('utf8')),
      'processing/2',
    )
    assert.ok(claimed)
    assert.equal(claimed.payload.attempt_id, started.value.attempt_ids[0])
    assert.notEqual(claimed.payload.command_id, forgedId)
  } finally {
    await runner.end()
    await fixture.dispose()
  }
})
