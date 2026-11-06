import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formedBatch, photoWithNote } from '../support/lot-pipeline.ts'
import { transaction } from '../../src/db/database.ts'
import { triggerExamine } from '../../src/processing/examine-trigger.ts'
import { queueSessionResume, runSessionTurn } from '../../src/agents/session-runner.ts'

type Formed = Awaited<ReturnType<typeof formedBatch>>

interface SnapshotJob {
  id: string
  stage: string
  subject_id: string | null
  current_attempt_id: string
  proposals: {
    id: string
    value: { subject_id: string; summary: string }
    currentness?: { state: string; reason?: string }
  }[]
  questions: {
    id: string
    state: string
    revision: string
    attempt_id: string
    input_sha256: string
    fields?: string[]
  }[]
}

async function processing({ fixture, batchId }: Formed) {
  return (
    (await fixture.http(`/batches/${batchId}/processing`)).value as {
      jobs: SnapshotJob[]
    }
  ).jobs
}

async function inbox({ fixture }: Formed, lineage: string) {
  return (
    await fixture.db.pool.query<{ kind: string; payload: { fields?: string[] } }>(
      'SELECT kind,payload FROM agent_session_inbox WHERE session_lineage_id=$1 ORDER BY seq',
      [lineage],
    )
  ).rows
}

async function run(formed: Formed, attemptId: string) {
  const state = await runSessionTurn(formed.deps, attemptId, new AbortController().signal)
  assert.ok(['finished', 'waiting_input'].includes(state), state)
}

/** The operator links the lot to a new Part: a correction of its identity. */
async function correctIdentity(formed: Formed, lotId: string) {
  const read = async () => formed.read()
  let batch = await read()
  const added = await formed.fixture.http(`/batches/${formed.batchId}/edits`, {
    expected_revision: batch.revision,
    change: { kind: 'add_part', label: '74HCT00' },
  })
  assert.equal(added.status, 200)
  batch = await read()
  const part = batch.parts.find((item) => item.label === '74HCT00')!
  const linked = await formed.fixture.http(`/batches/${formed.batchId}/edits`, {
    expected_revision: batch.revision,
    change: { kind: 'lot', id: lotId, part_subject_id: part.id },
  })
  assert.equal(linked.status, 200)
}

test('Unclear quantity: the estimate is provisional, and its answer leaves the identity current', async (t) => {
  const formed = await formedBatch(t)
  const led = await formed.lot('led 0603 red')
  const research = (await formed.successors(led.id)).find((row) => row.stage === 'research')!
  await run(formed, research.attempt_id)

  const lead = (jobs: SnapshotJob[]) => jobs.find((job) => job.stage === 'examine')!
  const forLed = (jobs: SnapshotJob[], prefix: string) =>
    lead(jobs).proposals.find(
      (p) => p.value.subject_id === led.id && p.value.summary.startsWith(prefix),
    )!
  let jobs = await processing(formed)
  // Research asked how many items the lot holds and keeps working on its assumption.
  assert.equal(forLed(jobs, 'Estimated').currentness?.state, 'provisional')
  assert.equal(forLed(jobs, 'Identity').currentness?.state, 'current')

  const job = jobs.find((item) => item.id === research.job_id)!
  const question = job.questions.find((item) => item.state === 'open')!
  const answered = await formed.fixture.http(
    `/batches/${formed.batchId}/questions/${question.id}/answers`,
    {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: question.revision,
      expected_capture_revision: (await formed.read()).revision,
      attempt_id: question.attempt_id,
      input_sha256: question.input_sha256,
      value: { kind: 'quantity', value: '480', basis: 'counted' },
    },
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  jobs = await processing(formed)
  assert.deepEqual(forLed(jobs, 'Estimated').currentness, {
    state: 'stale',
    reason: 'answer_received',
  })
  assert.equal(forLed(jobs, 'Identity').currentness?.state, 'current')
  // The asker has the answer; the lead session, whose estimate relied on it, is told.
  assert.deepEqual(
    (await inbox(formed, formed.leadJob)).map((item) => [item.kind, item.payload.fields]),
    [['revision', ['quantity']]],
  )
})

test('an identity correction reaches Research and Images, including Research that has published nothing', async (t) => {
  const formed = await formedBatch(t)
  const led = await formed.lot('led 0603 red')
  const crystal = await formed.lot('16 mhz crystal')
  const [images, research] = await formed.successors(led.id)
  await run(formed, images.attempt_id)

  await correctIdentity(formed, led.id)
  const jobs = await processing(formed)
  const imagesJob = jobs.find((job) => job.id === images.job_id)!
  assert.deepEqual(imagesJob.proposals[0].currentness, {
    state: 'stale',
    reason: 'operator_correction',
  })
  const identity = jobs
    .find((job) => job.stage === 'examine')!
    .proposals.find((p) => p.value.subject_id === led.id && p.value.summary.startsWith('Identity'))!
  assert.equal(identity.currentness?.state, 'stale')
  // Neither session is cancelled; both are told.
  const states = await formed.successors(led.id)
  assert.deepEqual(
    states.map((row) => [row.attempt_id, row.attempt_state]),
    [
      [images.attempt_id, 'waiting_for_user'],
      [research.attempt_id, 'queued'],
    ],
  )
  for (const lineage of [images.job_id, research.job_id]) {
    assert.ok(
      (await inbox(formed, lineage)).some(
        (item) => item.kind === 'revision' && item.payload.fields?.includes('identity'),
      ),
    )
  }
  // The other lot is untouched.
  const crystalIdentity = jobs
    .find((job) => job.stage === 'examine')!
    .proposals.find(
      (p) => p.value.subject_id === crystal.id && p.value.summary.startsWith('Identity'),
    )!
  assert.equal(crystalIdentity.currentness?.state, 'current')
})

test('a queued Inventory stays waiting after a correction makes Research and Images stale', async (t) => {
  const formed = await formedBatch(t)
  const led = await formed.lot('led 0603 red')
  for (const row of await formed.successors(led.id)) {
    await run(formed, row.attempt_id)
  }
  const started = await formed.fixture.http(`/batches/${formed.batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await formed.read()).revision,
    subject_ids: [led.id],
    stages: ['inventory'],
  })
  assert.equal(started.status, 202)
  const inventory = (
    await formed.fixture.db.pool.query<{ current_attempt_id: string }>(
      "SELECT current_attempt_id FROM processing_job WHERE subject_id=$1 AND stage='inventory'",
      [led.id],
    )
  ).rows[0].current_attempt_id
  await correctIdentity(formed, led.id)
  assert.equal(await runSessionTurn(formed.deps, inventory, new AbortController().signal), 'queued')
  const held = await formed.fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id=$1', [
    inventory,
  ])
  assert.equal(held.rowCount, 0)
})

test('Evidence removed: an observation moved out of the lot makes proposals citing it stale', async (t) => {
  const formed = await formedBatch(t)
  const led = await formed.lot('led 0603 red')
  const crystal = await formed.lot('16 mhz crystal')
  const snapshot = await formed.read()
  const observation = snapshot.evidence_observations!.find((item) => item.lot_id === led.id)!
  const moved = await formed.fixture.http(`/batches/${formed.batchId}/edits`, {
    expected_revision: snapshot.revision,
    change: { kind: 'observation_move', observation_id: observation.id, lot_id: crystal.id },
  })
  assert.equal(moved.status, 200)
  const lead = (await processing(formed)).find((job) => job.stage === 'examine')!
  for (const proposal of lead.proposals.filter((p) => p.value.subject_id === led.id)) {
    assert.deepEqual(proposal.currentness, { state: 'stale', reason: 'evidence_removed' })
  }
  // The crystal lot's set changed too: its identity waits for a new one.
  const crystalIdentity = lead.proposals.find(
    (p) => p.value.subject_id === crystal.id && p.value.summary.startsWith('Identity'),
  )!
  assert.deepEqual(crystalIdentity.currentness, { state: 'stale', reason: 'lot_regrouped' })
  // The owning session is told to revise.
  assert.ok((await inbox(formed, formed.leadJob)).some((item) => item.kind === 'revision'))
})

test('Photo added mid-run: a paused Research session gets the new evidence and is resumed', async (t) => {
  const formed = await formedBatch(t)
  const led = await formed.lot('led 0603 red')
  const research = (await formed.successors(led.id)).find((row) => row.stage === 'research')!
  await run(formed, research.attempt_id)

  const back = await photoWithNote(formed.fixture, formed.batchId, 'Reel back', 'LED 0603 red')
  await triggerExamine(formed.fixture.writer.pool, formed.fixture.config, { quietMs: 0 })
  await transaction(formed.fixture.runner.pool, (client) =>
    queueSessionResume(client, formed.leadJob),
  )
  await run(formed, formed.leadAttempt)

  const after = (await formed.successors(led.id)).find((row) => row.stage === 'research')!
  // The same session, not a fresh one: the revised identity arrives as a notice.
  assert.equal(after.attempt_id, research.attempt_id)
  const items = await inbox(formed, research.job_id)
  assert.ok(
    items.some(
      (item) =>
        item.kind === 'evidence' &&
        (item.payload as { version_id?: string }).version_id === back.version,
    ),
  )
  assert.ok(items.some((item) => item.kind === 'revision'))
  // The wake sweep's resume picks it up.
  const resumed = await transaction(formed.fixture.runner.pool, (client) =>
    queueSessionResume(client, research.job_id),
  )
  assert.equal(resumed, research.attempt_id)
})
