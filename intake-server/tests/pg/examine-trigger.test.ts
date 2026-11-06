import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processingFixture } from '../support/processing.ts'
import { seedPhoto } from '../support/sessions.ts'
import { triggerExamine } from '../../src/processing/examine-trigger.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function leadJobs(fixture: Fixture, batchId: string) {
  const rows = await fixture.db.pool.query<{ id: string; subject_id: string | null }>(
    "SELECT id,subject_id FROM processing_job WHERE batch_id=$1 AND stage='examine'",
    [batchId],
  )
  return rows.rows
}

test('photos that finish preparing get exactly one Examine lead session, after the quiet period', async () => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Front')
    await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Back')
    // Still within the quiet period: nothing yet.
    assert.deepEqual(
      (await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 600_000 })).created,
      [],
    )
    // Concurrent sweeps still leave one lead job.
    await Promise.all([
      triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 }),
      triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 }),
    ])
    const jobs = await leadJobs(fixture, batchId)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].subject_id, null)
    assert.deepEqual(
      (await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })).created,
      [],
    )
    const pins = await fixture.db.pool.query(
      `SELECT p.version_id FROM media_command_pin p JOIN processing_attempt a ON a.command_id=p.command_id
       WHERE a.job_id=$1`,
      [jobs[0].id],
    )
    assert.equal(pins.rowCount, 2)
    const processing = (await fixture.http(`/batches/${batchId}/processing`)).value as {
      jobs: { stage: string; subject_id: string | null; session_state?: string }[]
    }
    const lead = processing.jobs.find((job) => job.stage === 'examine')!
    assert.deepEqual([lead.subject_id, lead.session_state], [null, 'queued'])
  } finally {
    await fixture.dispose()
  }
})

test('new evidence notifies the existing lead session once, and only for the new photo', async () => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Tape front')
    await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
    const [lead] = await leadJobs(fixture, batchId)
    const back = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Tape back')
    const first = await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
    assert.deepEqual(first, { created: [], notified: [back.version] })
    assert.deepEqual(await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 }), {
      created: [],
      notified: [],
    })
    const inbox = await fixture.db.pool.query<{
      kind: string
      actor_id: string | null
      payload: { version_id: string }
    }>('SELECT kind,actor_id,payload FROM agent_session_inbox WHERE session_lineage_id=$1', [
      lead.id,
    ])
    assert.deepEqual(
      inbox.rows.map((row) => [row.kind, row.actor_id, row.payload.version_id]),
      [['evidence', null, back.version]],
    )
  } finally {
    await fixture.dispose()
  }
})

test('no lead session starts for an archived batch or without a saved agent default', async () => {
  const archived = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await archived.seedCapture()
    await seedPhoto(archived, capture.batch.id, { width: 768, height: 512 })
    await capture.edit({ kind: 'batch', archived: true })
    await triggerExamine(archived.writer.pool, archived.config, { quietMs: 0 })
    assert.equal((await leadJobs(archived, capture.batch.id)).length, 0)
  } finally {
    await archived.dispose()
  }
  const native = await processingFixture({ profileId: 'native-agent/2' })
  try {
    const capture = await native.seedCapture()
    await seedPhoto(native, capture.batch.id, { width: 768, height: 512 })
    await triggerExamine(native.writer.pool, native.config, { quietMs: 0 })
    assert.equal((await leadJobs(native, capture.batch.id)).length, 0)
  } finally {
    await native.dispose()
  }
})

test('a photo becoming ready restarts the quiet period', async () => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Early', 60)
    await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Just ready', 5)
    // The first photo is past the quiet period, but the second one restarted it.
    await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 20_000 })
    assert.equal((await leadJobs(fixture, batchId)).length, 0)
    await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 4_000 })
    assert.equal((await leadJobs(fixture, batchId)).length, 1)
  } finally {
    await fixture.dispose()
  }
})
