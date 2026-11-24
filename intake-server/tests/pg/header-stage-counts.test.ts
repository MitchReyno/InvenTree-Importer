import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { validate, type BatchRecordsDto, type CaptureSnapshotDto } from '@invimport/contracts'
import { devConfig } from '#/config.ts'
import { headerWork } from '#/header/work.ts'
import { attentionReader } from '#/attention/reader.ts'
import { lockCaptureForEdit } from '#/capture/repository.ts'
import { setBatchPause } from '#/agents/pause.ts'
import { grantManual } from '#/review/grants.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { startProcessing } from '#/processing/commands.ts'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession } from '../support/sessions.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type HeaderRead = Awaited<ReturnType<typeof headerWork>>

const none = {
  jobs: 0,
  ready: 0,
  running: 0,
  waiting: 0,
  queued: 0,
  questions: 0,
  failed: 0,
  ready_lots: 0,
}

function headerConfig(fixture: Fixture) {
  return {
    ...devConfig({
      INTAKE_ORIGIN: 'http://127.0.0.1:4333',
      INTAKE_CREDENTIAL_REF: 'header-fixture',
      INTAKE_DEV_API_KEY: 'fake-only',
    }),
    ...fixture.config,
  }
}

/** Sets a job and its current attempt to a state, as the runner would leave them. */
async function setState(fixture: Fixture, ids: { job: string; attempt: string }, state: string) {
  await fixture.db.pool.query('UPDATE processing_job SET state=$2 WHERE id=$1', [ids.job, state])
  await fixture.db.pool.query('UPDATE processing_attempt SET state=$2 WHERE id=$1', [
    ids.attempt,
    state,
  ])
}

/** The lead session asks one clarification about the whole batch through its tools. */
async function askLead(fixture: Fixture, attemptId: string) {
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 60_000,
  })
  try {
    const token = await transaction(fixture.runner.pool, (client) =>
      issueSessionCapability(client, attemptId),
    )
    const client = new Client({ name: 'stage-count-test', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    try {
      const asked = await client.callTool({
        name: 'ask',
        arguments: {
          schema_version: 'bench-intake-question/2',
          subject_id: null,
          reason: 'Two invoices are in the photos.',
          fields: ['identity'],
          steps: [
            {
              id: 'order',
              prompt: 'Are these all from one order?',
              assumption: 'Treating them as one order.',
              answer: { kind: 'text' },
            },
          ],
        },
      })
      assert.equal((asked.structuredContent as { ok: boolean }).ok, true)
    } finally {
      await client.close()
    }
  } finally {
    await server.close()
  }
}

/** A later attempt replaces the job's current one, which keeps its slot until it is reaped. */
async function replaceAttempt(fixture: Fixture, earlier: { job: string; attempt: string }) {
  const later = randomUUID()
  const commandId = randomUUID()
  await fixture.db.pool.query(
    `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
     SELECT $1,actor_id,target_id,target_context_id,kind,handler_version,$2,queue_name,payload_bytes,payload_digest
     FROM command WHERE id=(SELECT command_id FROM processing_attempt WHERE id=$3)`,
    [commandId, `processing:${later}`, earlier.attempt],
  )
  await fixture.db.pool.query(
    `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
     SELECT $1,batch_id,job_id,number+1,input_id,profile_id,$2,channel_digest,'running'
     FROM processing_attempt WHERE id=$3`,
    [later, commandId, earlier.attempt],
  )
  await fixture.db.pool.query(
    "INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,'running',$2)",
    [later, earlier.job],
  )
  await fixture.db.pool.query(
    "UPDATE processing_job SET current_attempt_id=$2, state='running' WHERE id=$1",
    [earlier.job, later],
  )
  await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
    earlier.attempt,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='cancelled' WHERE attempt_id=$1",
    [earlier.attempt],
  )
  await fixture.db.pool.query(
    'INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at) VALUES($1,0,$2,now())',
    [fixture.identity.actor, earlier.attempt],
  )
  return later
}

/** Retires a lot as a split into another, as the operator's restructure records it. */
async function retire(fixture: Fixture, batch: CaptureSnapshotDto, lotId: string, into: string) {
  await fixture.db.pool.query(
    `INSERT INTO capture_lot_lineage(batch_id,predecessor_lot_id,successor_lot_id,action,revision,actor_id)
     VALUES($1,$2,$3,'split',$4,$5)`,
    [batch.id, lotId, into, batch.revision, fixture.identity.actor],
  )
  await fixture.db.pool.query(
    'INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id) VALUES($1,$2,$3,$4)',
    [batch.id, lotId, batch.revision, fixture.identity.actor],
  )
}

function counted(result: HeaderRead, batchId: string) {
  return result.batch_steps?.find((entry) => entry.batch_id === batchId)
}

function attention(fixture: Fixture) {
  const config = headerConfig(fixture)
  // Only the Processing counts are under test; Records reads its own target.
  const records = async () => ({ records: [] }) as unknown as BatchRecordsDto
  return attentionReader(fixture.api.pool, config, config, lockCaptureForEdit, records)
}

async function batchWithLots(capture: Capture) {
  await capture.edit({ kind: 'add_lot', label: 'Packet C', note: '', part_subject_id: null })
  await capture.edit({ kind: 'add_lot', label: 'Packet D', note: '', part_subject_id: null })
  await capture.edit({ kind: 'add_part', label: 'Shared Part' })
  const lot = (label: string) => capture.batch.lots.find((entry) => entry.label === label)!
  return { c: lot('Packet C'), d: lot('Packet D'), part: capture.batch.parts[0] }
}

test('both reads count each stage’s waiting, queued, running and ready work, its questions and ready lots, and the batch’s pause', async () => {
  const fixture = await processingFixture()
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const open = await fixture.seedCapture()
    const { c, d, part } = await batchWithLots(open)
    const { packetA: a, packetB: b } = open

    // Examine: the lead session asked about the whole batch and waits for the answer.
    const lead = await leadSession(fixture, open)
    await askLead(fixture, lead.attempt)
    await setState(fixture, lead, 'waiting_for_user')
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='waiting_input' WHERE attempt_id=$1",
      [lead.attempt],
    )
    // Research: A ready, B running on a later attempt, the Part ready, C retired, D not yet started.
    await setState(fixture, await lotSession(fixture, open, a), 'ready')
    const earlier = await lotSession(fixture, open, b)
    const later = await replaceAttempt(fixture, earlier)
    const retired = await lotSession(fixture, open, c)
    await setState(fixture, retired, 'ready')
    const partJob = await startProcessing(
      fixture.api.pool,
      fixture.config,
      open.batch.id,
      randomUUID(),
      {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: open.batch.revision,
        subject_ids: [part.id],
        stages: ['research'],
      },
    )
    validate('ProcessingReceipt', partJob)
    await fixture.db.pool.query(
      "UPDATE processing_job SET state='ready' WHERE batch_id=$1 AND subject_id=$2",
      [open.batch.id, part.id],
    )
    // Images: A queued for a slot.
    await lotSession(fixture, open, a, { state: 'queued', stage: 'images' })
    await retire(fixture, open.batch, c.id, d.id)
    await setBatchPause(fixture.db.pool, fixture.config, open.batch.id, true)

    const expected = {
      examine: { ...none, jobs: 1, waiting: 1, questions: 1 },
      // C's job is retired history; the Part's ready job is no lot's.
      research: { ...none, jobs: 3, ready: 2, running: 1, ready_lots: 1 },
      images: { ...none, jobs: 1, queued: 1 },
      // D is live with no job anywhere yet: the stage counts nothing, not done.
      inventory: none,
    }
    const header = await headerWork(fixture.api.pool, headerConfig(fixture), open.batch.id)
    validate('HeaderWork', header)
    const entry = counted(header, open.batch.id)
    assert.deepEqual(
      { paused: entry?.paused, lots: entry?.lots, steps: entry?.steps },
      { paused: true, lots: 3, steps: expected },
    )

    const read = await attention(fixture)(open.batch.id)
    validate('BatchAttention', read)
    assert.equal(read.processing.paused, true)
    assert.equal(read.processing.lots, 3)
    assert.deepEqual(read.processing.steps, expected)

    // The cancelled earlier attempt still holds its slot but is not the job's current one.
    const sessions = header.active_sessions.filter((session) => session.job_id === earlier.job)
    assert.deepEqual(
      sessions
        .map((session) => [session.attempt_id, session.current, session.occupies_lane])
        .sort(),
      [
        [earlier.attempt, false, true],
        [later, true, false],
      ].sort(),
    )
    assert.equal(
      header.active_sessions.find((session) => session.attempt_id === lead.attempt)?.current,
      true,
    )

    await setBatchPause(fixture.db.pool, fixture.config, open.batch.id, false)
    const resumed = await headerWork(fixture.api.pool, headerConfig(fixture), open.batch.id)
    assert.equal(counted(resumed, open.batch.id)?.paused, false)
    assert.equal((await attention(fixture)(open.batch.id)).processing.paused, false)
    assert.deepEqual(resumed.paused_batches, [])
  } finally {
    await fixture.dispose()
  }
})

test('another batch’s failed Research job counts beside its running Images', async () => {
  const fixture = await processingFixture()
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const open = await fixture.seedCapture()
    const other = await fixture.seedCapture()
    await setState(fixture, await lotSession(fixture, other, other.packetA), 'failed')
    await lotSession(fixture, other, other.packetA, { stage: 'images' })

    const header = await headerWork(fixture.api.pool, headerConfig(fixture), open.batch.id)
    validate('HeaderWork', header)
    const entry = counted(header, other.batch.id)
    assert.equal(entry?.paused, false)
    assert.equal(entry?.lots, 2)
    assert.deepEqual(entry?.steps.research, { ...none, jobs: 1, failed: 1 })
    assert.deepEqual(entry?.steps.images, { ...none, jobs: 1, running: 1 })
    // The failed job is not active work, so the work list alone could not show it.
    assert.equal(
      header.work.some((item) => item.batch_id === other.batch.id && item.state === 'failed'),
      false,
    )
  } finally {
    await fixture.dispose()
  }
})

test('paused batches are listed by name, the open one first, with or without work, up to 20', async () => {
  const fixture = await processingFixture()
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const open = await fixture.seedCapture()
    const empty = await fixture.seedCapture()
    const pause = (batchId: string) => setBatchPause(fixture.db.pool, fixture.config, batchId, true)
    await pause(open.batch.id)
    await pause(empty.batch.id)
    const working: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const capture = await fixture.seedCapture()
      await lotSession(fixture, capture, capture.packetA)
      await pause(capture.batch.id)
      working.push(capture.batch.id)
    }

    const seven = await headerWork(fixture.api.pool, headerConfig(fixture), open.batch.id)
    validate('HeaderWork', seven)
    // Five batches fill the step counts, yet every paused batch is listed for Resume.
    assert.equal(seven.batch_steps?.length, 5)
    assert.equal(counted(seven, empty.batch.id), undefined)
    assert.equal(seven.paused_batches.length, 7)
    assert.equal(seven.paused_truncated, false)
    assert.equal(seven.paused_batches[0].batch_id, open.batch.id)
    assert.deepEqual(
      seven.paused_batches.find((batch) => batch.batch_id === empty.batch.id),
      { batch_id: empty.batch.id, title: 'Synthetic manual processing' },
    )
    assert.deepEqual(
      new Set(seven.paused_batches.map((batch) => batch.batch_id)),
      new Set([open.batch.id, empty.batch.id, ...working]),
    )

    for (let index = 0; index < 14; index += 1) {
      const created = await fixture.http('/batches', { title: `Paused ${index}`, note: '' })
      assert.equal(created.status, 201)
      await pause((created.value as CaptureSnapshotDto).id)
    }
    const many = await headerWork(fixture.api.pool, headerConfig(fixture), open.batch.id)
    validate('HeaderWork', many)
    assert.equal(many.paused_batches.length, 20)
    assert.equal(many.paused_truncated, true)
    assert.equal(many.paused_batches[0].batch_id, open.batch.id)

    // An archived batch runs nothing, so it is not offered for Resume.
    const archived = await fixture.http(`/batches/${empty.batch.id}/edits`, {
      expected_revision: empty.batch.revision,
      change: { kind: 'batch', archived: true },
    })
    assert.equal(archived.status, 200, JSON.stringify(archived.value))
    const after = await headerWork(fixture.api.pool, headerConfig(fixture))
    assert.equal(after.paused_truncated, false)
    assert.equal(
      after.paused_batches.some((batch) => batch.batch_id === empty.batch.id),
      false,
    )
    assert.equal(
      (await headerWork(fixture.api.pool, { ...headerConfig(fixture), actorId: randomUUID() }))
        .paused_batches.length,
      0,
    )
  } finally {
    await fixture.dispose()
  }
})
