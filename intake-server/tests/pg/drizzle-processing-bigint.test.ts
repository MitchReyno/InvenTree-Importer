import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { ProcessingEnvelopeDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import { loadProcessingAuthority } from '#/processing/authority.ts'
import { processingAttempts, processingMessages } from '#/processing/schema.ts'

const ABOVE_SAFE_INTEGER = '9007199254740993'
const NEXT_ATTEMPT = '9007199254740994'
const PRIOR_SEQUENCE = '9007199254740992'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function read(fixture: Fixture, batchId: string): Promise<ProcessingSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(response.status, 200)
  return response.value
}

async function claim(fixture: Fixture, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id,command.payload_bytes FROM command
     JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
    [attemptId],
  )
  const retained = commands.rows[0]
  return claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.workflow_id,
    strictJson(retained.payload_bytes.toString('utf8')),
    'processing/2',
  )
}

test('processing keeps attempt number, capture revision and message sequence above the safe integer range', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    await fixture.db.pool.query('UPDATE capture_batch SET revision=$2 WHERE id=$1', [
      capture.batch.id,
      ABOVE_SAFE_INTEGER,
    ])
    const started = await fixture.http(
      `/batches/${capture.batch.id}/processing`,
      {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: ABOVE_SAFE_INTEGER,
        subject_ids: [capture.packetA.id],
        stages: ['reading'],
      },
      randomUUID(),
    )
    assert.equal(started.status, 202, JSON.stringify(started.value))
    const first = (await read(fixture, capture.batch.id)).jobs[0]
    const firstAuthority = await transaction(fixture.db.pool, (client) =>
      loadProcessingAuthority(client, fixture.config, first.attempt_id),
    )
    assert.equal(firstAuthority.row.captureRevision.toString(), ABOVE_SAFE_INTEGER)
    assert.equal(firstAuthority.row.number.toString(), '1')

    await fixture.db.pool.query('UPDATE processing_attempt SET number=$2 WHERE id=$1', [
      first.attempt_id,
      ABOVE_SAFE_INTEGER,
    ])
    const restarted = await fixture.http(
      `/batches/${capture.batch.id}/processing`,
      {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: ABOVE_SAFE_INTEGER,
        subject_ids: [capture.packetA.id],
        stages: ['reading'],
      },
      randomUUID(),
    )
    assert.equal(restarted.status, 202, JSON.stringify(restarted.value))
    const current = (await read(fixture, capture.batch.id)).jobs[0]
    assert.equal(current.attempt_number, NEXT_ATTEMPT)
    const restartedAuthority = await transaction(fixture.db.pool, (client) =>
      loadProcessingAuthority(client, fixture.config, current.attempt_id),
    )
    assert.equal(restartedAuthority.row.number.toString(), NEXT_ATTEMPT)
    assert.equal(restartedAuthority.row.captureRevision.toString(), ABOVE_SAFE_INTEGER)

    const command = await claim(fixture, current.attempt_id)
    assert.ok(command)
    await fixture.db.pool.query('UPDATE processing_attempt SET last_sequence=$2 WHERE id=$1', [
      current.attempt_id,
      PRIOR_SEQUENCE,
    ])
    const message: ProcessingEnvelopeDto = {
      schema_version: 'bench-intake-runner/2',
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      command_id: command.payload.command_id,
      input_sha256: command.payload.input_sha256,
      profile_id: 'synthetic-research/2',
      handler_version: 'processing/2',
      sequence: ABOVE_SAFE_INTEGER,
      kind: 'terminal',
      payload: { state: 'ready' },
    }
    assert.equal(
      await acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, message),
      'accepted',
    )
    assert.equal(
      await acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, message),
      'duplicate',
    )
    const stored = await executeDatabaseQuery(
      queryDatabase(fixture.db.pool)
        .select({
          sequence: processingMessages.sequence,
          lastSequence: processingAttempts.lastSequence,
        })
        .from(processingMessages)
        .innerJoin(processingAttempts, eq(processingAttempts.id, processingMessages.attemptId))
        .where(eq(processingMessages.attemptId, current.attempt_id)),
    )
    assert.equal(stored[0]?.sequence.toString(), ABOVE_SAFE_INTEGER)
    assert.equal(stored[0]?.lastSequence.toString(), ABOVE_SAFE_INTEGER)

    await assert.rejects(
      () =>
        executeDatabaseQuery(
          queryDatabase(fixture.runner.pool)
            .insert(processingMessages)
            .values({
              id: randomUUID(),
              attemptId: current.attempt_id,
              sequence: BigInt(ABOVE_SAFE_INTEGER),
              envelopeBytes: Buffer.from('x'),
              envelopeDigest: Buffer.alloc(32),
              disposition: 'stale',
            }),
        ),
      { code: '23505' },
    )
  } finally {
    await fixture.dispose()
  }
})
