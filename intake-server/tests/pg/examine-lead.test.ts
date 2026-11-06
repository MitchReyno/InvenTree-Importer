import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { seedPhoto } from '../support/sessions.ts'
import { transaction } from '../../src/db/database.ts'
import { triggerExamine } from '../../src/processing/examine-trigger.ts'
import { startSessionToolServer } from '../../src/agents/tools/server.ts'
import {
  queueSessionResume,
  runSessionTurn,
  syntheticSessionDriver,
} from '../../src/agents/session-runner.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function photoWithNote(fixture: Fixture, batchId: string, label: string, note: string) {
  const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, label)
  await fixture.db.pool.query(
    'INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
    [randomUUID(), batchId, photo.evidence, note, fixture.identity.actor],
  )
  return photo
}

test('the synthetic lead session forms lots from regions and adds later evidence to the right lot', async () => {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  const stateRoot = await mkdtemp(join(tmpdir(), 'examine-lead-'))
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  const deps = {
    pool: fixture.runner.pool,
    config: fixture.config,
    host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot, env: {} },
    toolUrl: server.url,
    drivers: { 'synthetic-session/1': syntheticSessionDriver },
  }
  const read = async () => (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
  let batchId = ''
  try {
    const capture = await fixture.seedCapture()
    batchId = capture.batch.id
    const tray = await photoWithNote(
      fixture,
      batchId,
      'Tray',
      '1N4148 diodes ×100; 16 MHz crystal; LED 0603 red ×500',
    )
    const reel = await photoWithNote(fixture, batchId, 'Reel', 'LED 0603 red ×500')
    await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
    const lead = await fixture.db.pool.query<{ id: string; current_attempt_id: string }>(
      "SELECT id,current_attempt_id FROM processing_job WHERE batch_id=$1 AND stage='examine'",
      [batchId],
    )
    const attemptId = lead.rows[0].current_attempt_id
    assert.equal(await runSessionTurn(deps, attemptId, new AbortController().signal), 'finished')

    let snapshot = await read()
    const formed = snapshot.lots.filter((lot) => lot.origin === 'agent')
    assert.deepEqual(formed.map((lot) => lot.label).sort(), [
      '16 mhz crystal',
      '1n4148 diodes',
      'led 0603 red',
    ])
    assert.equal(snapshot.evidence_observations?.length, 4)
    const onTray = snapshot.evidence_observations!.filter(
      (o) => o.evidence_version_id === tray.version,
    )
    assert.equal(onTray.length, 3)
    const led = formed.find((lot) => lot.label === 'led 0603 red')!
    assert.equal(led.evidence_observation_ids?.length, 2)
    // The same reel in two photos is one count of 500, not 1000.
    assert.deepEqual(
      [led.estimated_quantity, led.quantity_basis],
      ['500', 'label · same item in 2 photos'],
    )
    assert.deepEqual(led.quantity, { mode: 'inherit' })
    const processing = (await fixture.http(`/batches/${batchId}/processing`)).value as {
      jobs: { stage: string; proposals: { value: { subject_id: string; summary: string } }[] }[]
    }
    // One identity per lot; estimated quantities are proposals of their own.
    const proposals = processing.jobs
      .find((job) => job.stage === 'examine')!
      .proposals.filter((p) => p.value.summary.startsWith('Identity'))
    assert.deepEqual(
      proposals.map((p) => p.value.subject_id).sort(),
      formed.map((lot) => lot.id).sort(),
    )

    // A later photo of the same reel: only it is examined, and it joins the LED lot.
    const back = await photoWithNote(fixture, batchId, 'Reel back', 'LED 0603 red')
    const notified = await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
    assert.deepEqual(notified.notified, [back.version])
    await transaction(fixture.runner.pool, (client) => queueSessionResume(client, lead.rows[0].id))
    assert.equal(await runSessionTurn(deps, attemptId, new AbortController().signal), 'finished')
    snapshot = await read()
    assert.equal(snapshot.lots.filter((lot) => lot.origin === 'agent').length, 3)
    const grown = snapshot.lots.find((lot) => lot.id === led.id)!
    assert.equal(grown.evidence_observation_ids?.length, 3)
    for (const lot of formed.filter((item) => item.id !== led.id)) {
      assert.deepEqual(
        snapshot.lots.find((item) => item.id === lot.id)!.evidence_observation_ids,
        lot.evidence_observation_ids,
      )
    }
    assert.equal(
      snapshot.evidence_observations!.filter((o) => o.evidence_version_id === reel.version).length,
      1,
    )
  } finally {
    await server.close()
    await fixture.dispose()
    await rm(stateRoot, { recursive: true, force: true })
  }
})
