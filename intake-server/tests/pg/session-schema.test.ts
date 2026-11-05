import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type { PoolClient } from 'pg'
import { processingFixture } from '../support/processing.ts'
import { isolatedDatabase } from '../support/database.ts'
import { sealed } from '../../src/processing/model.ts'
import { transaction } from '../../src/db/database.ts'
import { migrate } from '../../src/operations/migrate.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const pgError = (code: string) => (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code

/** Inserts a job, its input, command and first attempt as the migration owner. */
async function insertJob(
  fixture: Fixture,
  client: PoolClient,
  job: { batchId: string; subjectId: string | null; stage: string; profileId?: string },
) {
  const ids = {
    job: randomUUID(),
    attempt: randomUUID(),
    input: randomUUID(),
    command: randomUUID(),
  }
  const profileId = job.profileId ?? 'synthetic-session/1'
  const manifest = sealed({ fixture: 'session-schema', stage: job.stage })
  const payload = sealed({ fixture: 'session-schema-command', attempt_id: ids.attempt })
  await client.query(
    'INSERT INTO processing_input(id,batch_id,capture_revision,manifest_bytes,manifest_digest) VALUES($1,$2,1,$3,$4)',
    [ids.input, job.batchId, manifest.bytes, manifest.digest],
  )
  await client.query(
    `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
     VALUES($1,$2,$3,$4,'process','processing/5',$5,'bench-sessions',$6,$7)`,
    [
      ids.command,
      fixture.identity.actor,
      fixture.identity.target,
      fixture.identity.context,
      `processing:${ids.attempt}`,
      payload.bytes,
      payload.digest,
    ],
  )
  await client.query(
    "INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state) VALUES($1,$2,$3,$4,$5,'queued')",
    [ids.job, job.batchId, job.subjectId, job.stage, ids.attempt],
  )
  await client.query(
    `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
     VALUES($1,$2,$3,1,$4,$5,$6,$7,'queued')`,
    [ids.attempt, job.batchId, ids.job, ids.input, profileId, ids.command, manifest.digest],
  )
  return ids
}

async function leadSession(fixture: Fixture, batchId: string) {
  return transaction(fixture.db.pool, async (client) => {
    const ids = await insertJob(fixture, client, { batchId, subjectId: null, stage: 'examine' })
    await client.query(
      "INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,'queued',$2)",
      [ids.attempt, ids.job],
    )
    return ids
  })
}

async function newBatch(fixture: Fixture) {
  const created = await fixture.http('/batches', {
    title: 'Second batch',
    note: 'Separate packet.',
  })
  assert.equal(created.status, 201)
  return (created.value as { id: string }).id
}

test('both session profiles are stored with instruction bytes matching their digests', async () => {
  const fixture = await processingFixture({ autoStart: false })
  try {
    const rows = await fixture.db.pool.query<{
      id: string
      handler_version: string
      tool_profile_version: string
      qualification: string
      instruction_bytes: Buffer
      instruction_digest: Buffer
    }>("SELECT * FROM processing_profile WHERE handler_version='processing/5' ORDER BY id")
    assert.deepEqual(
      rows.rows.map((row) => [row.id, row.qualification, row.tool_profile_version]),
      [
        ['native-agent/2', 'native_unverified', 'native-session-tools/1'],
        ['synthetic-session/1', 'fixture_only', 'native-session-tools/1'],
      ],
    )
    for (const row of rows.rows) {
      assert.deepEqual(
        createHash('sha256').update(row.instruction_bytes).digest(),
        row.instruction_digest,
      )
    }
    assert.equal(
      rows.rows[0].instruction_digest.toString('hex'),
      '75bd67342904a9578eaa04aceffd664d10dedf0d65743071aed95a36b644dc70',
    )
    await assert.rejects(
      fixture.db.pool.query(
        "INSERT INTO processing_profile VALUES('native-agent/3','native_unverified','processing/5','\\x00',decode(repeat('00',32),'hex'),'native-session-tools/1')",
      ),
      pgError('23514'),
    )
  } finally {
    await fixture.dispose()
  }
})

test('only the examine stage has a null subject, and each batch has at most one lead job', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const lead = await leadSession(fixture, batchId)
    assert.ok(lead.job)
    await assert.rejects(
      transaction(fixture.db.pool, (client) =>
        insertJob(fixture, client, { batchId, subjectId: null, stage: 'examine' }),
      ),
      pgError('23505'),
    )
    await assert.rejects(
      transaction(fixture.db.pool, (client) =>
        insertJob(fixture, client, { batchId, subjectId: null, stage: 'research' }),
      ),
      pgError('23514'),
    )
    await assert.rejects(
      transaction(fixture.db.pool, (client) =>
        insertJob(fixture, client, { batchId, subjectId: capture.packetA.id, stage: 'examine' }),
      ),
      pgError('23514'),
    )
    // Controls: a lot job still needs its subject, and another batch gets its own lead job.
    await transaction(fixture.db.pool, (client) =>
      insertJob(fixture, client, { batchId, subjectId: capture.packetA.id, stage: 'research' }),
    )
    await leadSession(fixture, await newBatch(fixture))
  } finally {
    await fixture.dispose()
  }
})

test('outbox and inbox sequences are gap-free and append-only', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture.batch.id)
    const outbox = (seq: number, kind = 'status') =>
      fixture.runner.pool.query(
        'INSERT INTO agent_session_outbox(session_id,seq,kind,payload) VALUES($1,$2,$3,$4)',
        [lead.attempt, seq, kind, { text: `step ${seq}` }],
      )
    await outbox(1)
    await outbox(2)
    await assert.rejects(outbox(2), pgError('23505'))
    await assert.rejects(outbox(4), pgError('23505'))
    await assert.rejects(outbox(3, 'thinking'), pgError('23514'))
    await outbox(3, 'proposal')
    await assert.rejects(
      fixture.db.pool.query("UPDATE agent_session_outbox SET kind='reply' WHERE session_id=$1", [
        lead.attempt,
      ]),
      pgError('23000'),
    )

    const inbox = (seq: number, key: string, kind = 'chat') =>
      fixture.api.pool.query(
        'INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          randomUUID(),
          lead.job,
          seq,
          kind,
          { text: 'Check the back label.' },
          key,
          fixture.identity.actor,
        ],
      )
    await inbox(1, 'key-a')
    await assert.rejects(inbox(2, 'key-a'), pgError('23505'))
    await assert.rejects(inbox(2, 'key-b', 'approval'), pgError('23514'))
    await inbox(2, 'key-b')
    await assert.rejects(
      fixture.db.pool.query('DELETE FROM agent_session_inbox WHERE session_lineage_id=$1', [
        lead.job,
      ]),
      pgError('23000'),
    )
  } finally {
    await fixture.dispose()
  }
})

test('cursors only move forward and a session keeps its lineage', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture.batch.id)
    await fixture.runner.pool.query(
      'INSERT INTO agent_session_cursor(session_lineage_id,acked_seq,acked_at) VALUES($1,2,now())',
      [lead.job],
    )
    await fixture.runner.pool.query(
      'UPDATE agent_session_cursor SET acked_seq=5,acked_at=now() WHERE session_lineage_id=$1',
      [lead.job],
    )
    await assert.rejects(
      fixture.runner.pool.query(
        'UPDATE agent_session_cursor SET acked_seq=4 WHERE session_lineage_id=$1',
        [lead.job],
      ),
      pgError('23514'),
    )
    await fixture.runner.pool.query(
      "UPDATE agent_session SET session_state='running',capability_sha256=$2 WHERE attempt_id=$1",
      [lead.attempt, createHash('sha256').update('capability').digest()],
    )
    const other = await leadSession(fixture, await newBatch(fixture))
    await assert.rejects(
      fixture.db.pool.query('UPDATE agent_session SET session_lineage_id=$2 WHERE attempt_id=$1', [
        lead.attempt,
        other.job,
      ]),
      /agent_session_identity_immutable/,
    )
    await assert.rejects(
      fixture.db.pool.query('UPDATE agent_session SET session_state=NULL WHERE attempt_id=$1', [
        lead.attempt,
      ]),
      pgError('23514'),
    )
  } finally {
    await fixture.dispose()
  }
})

test('staleness is recorded once per proposal and never edited', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture.batch.id)
    const messageId = randomUUID()
    const proposalId = randomUUID()
    const envelope = sealed({ fixture: 'session-schema-message' })
    const value = sealed({ fixture: 'session-schema-proposal' })
    await fixture.db.pool.query(
      "INSERT INTO processing_message(id,attempt_id,sequence,envelope_bytes,envelope_digest,disposition) VALUES($1,$2,1,$3,$4,'accepted')",
      [messageId, lead.attempt, envelope.bytes, envelope.digest],
    )
    await fixture.runner.pool.query(
      'INSERT INTO processing_proposal(id,attempt_id,message_id,value_bytes,value_digest,relies_on) VALUES($1,$2,$3,$4,$5,$6)',
      [
        proposalId,
        lead.attempt,
        messageId,
        value.bytes,
        value.digest,
        { fields: ['identity'], sources: [] },
      ],
    )
    await fixture.api.pool.query(
      "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'operator_correction')",
      [proposalId],
    )
    await assert.rejects(
      fixture.runner.pool.query(
        "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'lot_regrouped')",
        [proposalId],
      ),
      pgError('23505'),
    )
    await assert.rejects(
      fixture.db.pool.query('DELETE FROM processing_proposal_stale WHERE proposal_id=$1', [
        proposalId,
      ]),
      pgError('23000'),
    )
    await assert.rejects(
      fixture.db.pool.query(
        "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'because')",
        [randomUUID()],
      ),
      pgError('23514'),
    )
  } finally {
    await fixture.dispose()
  }
})

test('concurrency and slots stay within 1 to 8', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture.batch.id)
    await fixture.db.pool.query(
      "INSERT INTO agent_settings(actor_id,target_id,target_context_id,revision,provider,authentication,model) VALUES($1,$2,$3,1,'claude','subscription','claude-sonnet-5-5')",
      [fixture.identity.actor, fixture.identity.target, fixture.identity.context],
    )
    const settings = await fixture.db.pool.query<{ session_concurrency: number }>(
      'SELECT session_concurrency FROM agent_settings',
    )
    assert.equal(settings.rows[0].session_concurrency, 3)
    await fixture.api.pool.query('UPDATE agent_settings SET session_concurrency=8')
    await assert.rejects(
      fixture.api.pool.query('UPDATE agent_settings SET session_concurrency=9'),
      pgError('23514'),
    )
    await assert.rejects(
      fixture.api.pool.query('UPDATE agent_settings SET session_concurrency=0'),
      pgError('23514'),
    )
    const slot = (index: number, attemptId: string | null) =>
      fixture.runner.pool.query(
        'INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at) VALUES($1,$2,$3,$4)',
        [fixture.identity.actor, index, attemptId, attemptId ? new Date() : null],
      )
    await slot(0, lead.attempt)
    await slot(7, null)
    await assert.rejects(slot(8, null), pgError('23514'))
    await assert.rejects(slot(1, lead.attempt), pgError('23505'))
    await assert.rejects(
      fixture.runner.pool.query(
        'UPDATE agent_slot SET attempt_id=NULL WHERE actor_id=$1 AND slot_index=0',
        [fixture.identity.actor],
      ),
      pgError('23514'),
    )
    await fixture.runner.pool.query(
      'UPDATE agent_slot SET attempt_id=NULL,claimed_at=NULL WHERE actor_id=$1 AND slot_index=0',
      [fixture.identity.actor],
    )
  } finally {
    await fixture.dispose()
  }
})

test('runtime roles get only their side of the session tables', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture.batch.id)
    await assert.rejects(
      fixture.api.pool.query(
        'INSERT INTO agent_session_outbox(session_id,seq,kind,payload) VALUES($1,1,\'status\',\'{"text":"x"}\')',
        [lead.attempt],
      ),
      pgError('42501'),
    )
    await assert.rejects(
      fixture.api.pool.query('INSERT INTO agent_session_cursor(session_lineage_id) VALUES($1)', [
        lead.job,
      ]),
      pgError('42501'),
    )
    await assert.rejects(
      fixture.api.pool.query('INSERT INTO agent_slot(actor_id,slot_index) VALUES($1,0)', [
        fixture.identity.actor,
      ]),
      pgError('42501'),
    )
    await assert.rejects(
      fixture.runner.pool.query('UPDATE agent_settings SET session_concurrency=2'),
      pgError('42501'),
    )
    await assert.rejects(
      fixture.runner.pool.query('UPDATE agent_session SET queued_at=now() WHERE attempt_id=$1', [
        lead.attempt,
      ]),
      pgError('42501'),
    )
    // Notices the runner generates, such as new evidence, go to the same inbox.
    await fixture.runner.pool.query(
      "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,'evidence:1')",
      [randomUUID(), lead.job, { evidence_id: randomUUID(), version_id: randomUUID() }],
    )
    for (const pool of [fixture.api.pool, fixture.runner.pool]) {
      await pool.query(
        'SELECT 1 FROM agent_session_outbox,agent_session_inbox,agent_session_cursor,agent_slot,processing_proposal_stale LIMIT 1',
      )
    }
  } finally {
    await fixture.dispose()
  }
})

test('the session migration upgrades a database already at the previous migration', async () => {
  const db = await isolatedDatabase({ migrate: false })
  try {
    const directory = new URL('../../migrations/', import.meta.url)
    const names = (await readdir(directory))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort()
    assert.equal(names.at(-1), '0018_agent_session_runtime.sql')
    await transaction(db.pool, async (client) => {
      await client.query(
        'CREATE TABLE schema_migration (name text PRIMARY KEY, sha256 text NOT NULL)',
      )
      for (const name of names.slice(0, -1)) {
        const sql = await readFile(new URL(name, directory), 'utf8')
        await client.query(sql)
        await client.query('INSERT INTO schema_migration VALUES ($1,$2)', [
          name,
          createHash('sha256').update(sql).digest('hex'),
        ])
      }
    })
    const before = await db.pool.query<{ count: string }>('SELECT count(*) FROM processing_profile')
    await migrate(db.pool)
    const after = await db.pool.query<{ id: string }>(
      'SELECT id FROM processing_profile ORDER BY id',
    )
    assert.equal(after.rows.length, Number(before.rows[0].count) + 2)
    const nullable = await db.pool.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='processing_job' AND column_name='subject_id'",
    )
    assert.equal(nullable.rows[0].is_nullable, 'YES')
    await migrate(db.pool)
  } finally {
    await db.dispose()
  }
})
