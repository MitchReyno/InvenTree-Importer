import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  BriefEntryDto,
  CaptureSnapshotDto,
  ProcessingInputV7Dto,
  SessionHistoryBriefDto,
  SessionHistoryDto,
} from '@invimport/contracts'
import { formedBatch, type Fixture } from '../support/lot-pipeline.ts'
import { editMedia } from '#/media/edit.ts'
import { grantMedia } from '#/media/grants.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { replaceSession } from '#/processing/session-replacement.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'

type Batch = Awaited<ReturnType<typeof formedBatch>>

async function history(fixture: Fixture, batchId: string, jobId: string, before?: string) {
  const query = before === undefined ? '' : `?before=${before}`
  const response = await fixture.http(`/batches/${batchId}/processing/${jobId}/history${query}`)
  assert.equal(response.status, 200, JSON.stringify(response.value))
  return response.value as SessionHistoryDto
}

/** The brief read for one attempt of a job. */
async function readBrief(fixture: Fixture, batchId: string, jobId: string, attemptId: string) {
  const response = await fixture.http(
    `/batches/${batchId}/processing/${jobId}/attempts/${attemptId}/brief`,
  )
  assert.equal(response.status, 200, JSON.stringify(response.value))
  return response.value as SessionHistoryBriefDto
}

/** Every entry of the brief an attempt's input sealed; these briefs fit their manifests. */
async function sealedEntries(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    `SELECT i.manifest_bytes,i.manifest_digest FROM processing_attempt a
     JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
    [attemptId],
  )
  const manifest = decodeSessionInput(rows.rows[0].manifest_bytes, rows.rows[0].manifest_digest)
  assert.equal(manifest.schema_version, 'bench-intake-input/7')
  const { brief } = manifest as ProcessingInputV7Dto
  return {
    brief,
    entries: brief.pages.flatMap((page) => {
      assert.ok(page.entries, `page ${page.index} is in the manifest`)
      return page.entries
    }),
  }
}

function ofKind<K extends BriefEntryDto['kind']>(entries: readonly BriefEntryDto[], kind: K) {
  return entries.filter(
    (entry): entry is Extract<BriefEntryDto, { kind: K }> => entry.kind === kind,
  )
}

async function snapshotOf(fixture: Fixture, batchId: string) {
  return (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
}

async function successorOf(batch: Batch, label: string, stage: 'research' | 'images') {
  const lot = await batch.lot(label)
  const row = (await batch.successors(lot.id)).find((item) => item.stage === stage)!
  return { lot, row }
}

/** Research asks its quantity question; the operator answers it. */
async function answerResearchQuestion(batch: Batch, attemptId: string, jobId: string) {
  const { fixture, deps, batchId } = batch
  assert.equal(await runSessionTurn(deps, attemptId, new AbortController().signal), 'waiting_input')
  const question = await fixture.db.pool.query<{ id: string }>(
    'SELECT id FROM processing_question WHERE job_id=$1',
    [jobId],
  )
  const digest = await fixture.db.pool.query<{ digest: string }>(
    `SELECT encode(i.manifest_digest,'hex') AS digest FROM processing_attempt a
     JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
    [attemptId],
  )
  const answer = await fixture.http(
    `/batches/${batchId}/questions/${question.rows[0].id}/answers`,
    {
      schema_version: 'bench-intake-answer/2',
      expected_question_revision: '1',
      expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
      attempt_id: attemptId,
      input_sha256: digest.rows[0].digest,
      steps: [
        { step_id: 'left', value: { kind: 'number', value: '480', basis: 'counted' } },
        { step_id: 'packing', value: { kind: 'choice', option_id: 'reel' } },
      ],
    },
  )
  assert.equal(answer.status, 200, JSON.stringify(answer.value))
}

/** The operator corrects the lot's first observation's reading. */
async function correctReading(fixture: Fixture, batchId: string, observationId: string) {
  const before = await snapshotOf(fixture, batchId)
  const observation = before.evidence_observations!.find((item) => item.id === observationId)!
  const response = await fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: before.revision,
    change: {
      kind: 'observation',
      observation_id: observation.id,
      evidence_version_id: observation.evidence_version_id,
      page: observation.page,
      region: observation.region,
      readings: { markings: ['LED 0603 RED', 'R'] },
    },
  })
  assert.equal(response.status, 200, JSON.stringify(response.value))
  return observation
}

/** Fails the attempt and starts the job fresh, which seals a new brief. */
async function startFresh(fixture: Fixture, batchId: string, jobId: string, attemptId: string) {
  await fixture.db.pool.query("UPDATE processing_attempt SET state='failed' WHERE id=$1", [
    attemptId,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='failed' WHERE attempt_id=$1",
    [attemptId],
  )
  const job = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision::text FROM processing_job WHERE id=$1',
    [jobId],
  )
  const receipt = (await replaceSession(fixture.api.pool, fixture.config, batchId, jobId, 'r', {
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    expected_revision: job.rows[0].revision,
    attempt_id: attemptId,
  })) as { attempt_ids: string[] }
  return receipt.attempt_ids[0]
}

test('a /7 session’s history carries each attempt’s sealed brief at its queue time', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { lot, row } = await successorOf(batch, 'led 0603 red', 'research')
  await answerResearchQuestion(batch, row.attempt_id, row.job_id)
  const corrected = await correctReading(fixture, batchId, lot.evidence_observation_ids![0])
  const fresh = await startFresh(fixture, batchId, row.job_id, row.attempt_id)

  const page = await history(fixture, batchId, row.job_id)
  assert.equal(page.before, undefined)
  // Newest first, as the attempts are; each at its attempt's queue time.
  assert.deepEqual(
    page.briefs?.map((item) => item.attempt_id),
    [fresh, row.attempt_id],
  )
  // The page says where each brief sits, with its stage and sealed counts; its entries are a
  // read of their own.
  assert.deepEqual(Object.keys(page.briefs![0]).sort(), ['at', 'attempt_id', 'sections', 'stage'])
  const read: SessionHistoryBriefDto[] = []
  for (const ref of page.briefs!) {
    const header = page.session.attempts.find((attempt) => attempt.id === ref.attempt_id)!
    assert.equal(ref.at, header.queued_at)
    const item = await readBrief(fixture, batchId, row.job_id, ref.attempt_id)
    const sealedRef = await sealedEntries(fixture, ref.attempt_id)
    assert.equal(ref.stage, 'research')
    assert.deepEqual(ref.sections, sealedRef.brief.sections)
    read.push(item)
    assert.equal(item.attempt_id, ref.attempt_id)
    assert.equal(item.at, ref.at)
    const sealed = await sealedEntries(fixture, item.attempt_id)
    assert.equal(item.brief.schema_version, 'bench-intake-brief/1')
    assert.equal(item.brief.stage, 'research')
    assert.equal(item.brief.lot_id, lot.id)
    assert.equal(item.brief.revision, sealed.brief.revision)
    assert.deepEqual(item.brief.sections, sealed.brief.sections)
    assert.deepEqual(item.brief.entries, sealed.entries)
  }

  // The first attempt started before either; the fresh one started from both, marked human.
  const [first, second] = [read[1].brief.entries, read[0].brief.entries]
  assert.equal(ofKind(first, 'correction').length, 0)
  assert.equal(ofKind(first, 'answer').length, 0)
  const [correction] = ofKind(second, 'correction')
  assert.equal(correction.source, 'human')
  assert.equal(correction.observation_id, corrected.id)
  assert.deepEqual(correction.before, corrected.readings)
  assert.deepEqual(correction.after, { markings: ['LED 0603 RED', 'R'] })
  const [answer] = ofKind(second, 'answer')
  assert.equal(answer.source, 'human')
  assert.deepEqual(
    answer.steps.map((step) => step.value),
    ['480 · counted', 'On a reel'],
  )
  assert.ok(ofKind(second, 'identity').length > 0, 'Examine’s identity is in the brief')

  // The Examine lead's history carries its own brief, of its stage's sections.
  const lead = await history(fixture, batchId, batch.leadJob)
  assert.equal(lead.briefs?.length, 1)
  assert.equal(lead.briefs![0].attempt_id, batch.leadAttempt)
  const leadBrief = await readBrief(fixture, batchId, batch.leadJob, batch.leadAttempt)
  assert.equal(leadBrief.brief.stage, 'examine')
  assert.deepEqual(
    leadBrief.brief.entries,
    (await sealedEntries(fixture, batch.leadAttempt)).entries,
  )
})

test('a history from an earlier input keeps its shape, with no briefs', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, batchId } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const input = decodeSessionInput(row.input_bytes, row.input_digest)
  assert.equal(input.schema_version, 'bench-intake-input/6')
  for (const jobId of [row.job_id, batch.leadJob]) {
    const page = await history(fixture, batchId, jobId)
    assert.deepEqual(Object.keys(page).sort(), ['entries', 'session'])
    // An earlier input had no brief to read.
    const attemptId = page.session.attempts[0].id
    const none = await fixture.http(
      `/batches/${batchId}/processing/${jobId}/attempts/${attemptId}/brief`,
    )
    assert.equal(none.status, 404)
  }
})

test('a brief is on the page that reaches its attempt’s queue time, and only there', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const queued = await fixture.db.pool.query<{ queued_at: Date }>(
    'SELECT queued_at FROM agent_session WHERE attempt_id=$1',
    [row.attempt_id],
  )
  const queuedAt = queued.rows[0].queued_at
  // 150 messages before the attempt was queued and 300 status lines after it, so the brief
  // falls inside the second of three pages of 200.
  await fixture.db.pool.query(
    `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key,actor_id,created_at)
     SELECT gen_random_uuid(), $1,
            (SELECT coalesce(max(seq), 0) FROM agent_session_inbox WHERE session_lineage_id=$1) + n, 'chat', jsonb_build_object('text', 'Message ' || n),
            'chat:' || n, $2, $3::timestamptz - (151 - n) * interval '1 second'
       FROM generate_series(1, 150) n`,
    [row.job_id, fixture.identity.actor, queuedAt],
  )
  await fixture.db.pool.query(
    `INSERT INTO agent_session_outbox(session_id,seq,kind,payload,created_at)
     SELECT $1, (SELECT coalesce(max(seq), 0) FROM agent_session_outbox WHERE session_id=$1) + n,
            'status', jsonb_build_object('text', 'Line ' || n),
            $2::timestamptz + n * interval '1 second'
       FROM generate_series(1, 300) n`,
    [row.attempt_id, queuedAt],
  )

  const pages: SessionHistoryDto[] = []
  let before: string | undefined
  do {
    const page = await history(fixture, batchId, row.job_id, before)
    pages.push(page)
    before = page.before
  } while (before)
  assert.equal(pages.length, 3)
  assert.deepEqual(
    pages.map((page) => page.briefs?.length ?? 0),
    [0, 1, 0],
  )
  const [newest, middle, oldest] = pages
  assert.equal(Object.hasOwn(newest, 'briefs'), false)
  assert.equal(Object.hasOwn(oldest, 'briefs'), false)
  // The middle page holds rows on both sides of the brief's place.
  const brief = middle.briefs![0]
  assert.equal(brief.attempt_id, row.attempt_id)
  assert.ok(middle.entries.some((entry) => entry.at > brief.at))
  assert.ok(middle.entries.some((entry) => entry.at < brief.at))
  assert.ok(newest.entries.every((entry) => entry.at > brief.at))
  assert.ok(oldest.entries.every((entry) => entry.at < brief.at))
})

test('a brief in the history leaves out evidence removed after it was sealed', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const { entries } = await sealedEntries(fixture, row.attempt_id)
  const [photo] = ofKind(entries, 'evidence')
  const observations = ofKind(entries, 'observation').map((entry) => entry.observation.id)
  const notes = ofKind(entries, 'note')
    .filter((entry) => entry.evidence_id === photo.evidence_id)
    .map((entry) => entry.note_id)
  const ids = [photo.evidence_id, photo.version_id, ...observations, ...notes]
  assert.ok(observations.length > 0 && notes.length > 0)

  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const revision = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision::text FROM media_batch WHERE batch_id=$1',
    [batchId],
  )
  await editMedia(fixture.api.pool, fixture.config, batchId, randomUUID(), {
    expected_revision: revision.rows[0].revision,
    change: { kind: 'remove', evidence_ids: [photo.evidence_id] },
  })

  const page = await history(fixture, batchId, row.job_id)
  assert.equal(page.briefs![0].attempt_id, row.attempt_id)
  const shown = (await readBrief(fixture, batchId, row.job_id, row.attempt_id)).brief.entries
  const text = JSON.stringify(shown)
  assert.deepEqual(
    ids.filter((id) => text.includes(id)),
    [],
  )
  // What doesn't concern the removed photo is still there.
  assert.equal(ofKind(shown, 'batch').length, 1)
})

test('a brief sorts before a row at its queue time, so it goes to the older page at a tie', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const queued = await fixture.db.pool.query<{ queued_at: Date }>(
    'SELECT queued_at FROM agent_session WHERE attempt_id=$1',
    [row.attempt_id],
  )
  const queuedAt = queued.rows[0].queued_at
  // The newest page's oldest row is at the attempt's queue time exactly; older rows follow.
  await fixture.db.pool.query(
    `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key,actor_id,created_at)
     SELECT gen_random_uuid(), $1,
            (SELECT coalesce(max(seq), 0) FROM agent_session_inbox WHERE session_lineage_id=$1) + n,
            'chat', jsonb_build_object('text', 'Message ' || n),
            'chat:' || n, $2, $3::timestamptz - (11 - n) * interval '1 second'
       FROM generate_series(1, 10) n`,
    [row.job_id, fixture.identity.actor, queuedAt],
  )
  await fixture.db.pool.query(
    `INSERT INTO agent_session_outbox(session_id,seq,kind,payload,created_at)
     SELECT $1, (SELECT coalesce(max(seq), 0) FROM agent_session_outbox WHERE session_id=$1) + n,
            'status', jsonb_build_object('text', 'Line ' || n),
            $2::timestamptz + (n - 1) * interval '1 second'
       FROM generate_series(1, 200) n`,
    [row.attempt_id, queuedAt],
  )

  const newest = await history(fixture, batchId, row.job_id)
  assert.ok(newest.before)
  assert.equal(newest.entries.at(-1)!.at, queuedAt.toISOString())
  const older = await history(fixture, batchId, row.job_id, newest.before)
  assert.equal(older.before, undefined)
  assert.deepEqual(
    [newest, older].map((page) => page.briefs?.map((item) => item.attempt_id) ?? []),
    [[], [row.attempt_id]],
  )
})

test('a brief whose pages are in the page store comes whole', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const led = await batch.lot('led 0603 red')
  for (let index = 0; index < 8; index += 1) {
    const before = await snapshotOf(fixture, batchId)
    const note = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: before.revision,
      change: { kind: 'note', subject_id: null, text: `${index}:${'é'.repeat(8000)}` },
    })
    assert.equal(note.status, 200, JSON.stringify(note.value))
  }
  const started = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    subject_ids: [led.id],
    stages: ['research'],
  })
  assert.equal(started.status, 202, JSON.stringify(started.value))
  const attemptId = (started.value as { attempt_ids: string[] }).attempt_ids[0]

  const rows = await fixture.db.pool.query<{
    input_id: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
    job_id: string
  }>(
    `SELECT i.id AS input_id,i.manifest_bytes,i.manifest_digest,a.job_id FROM processing_attempt a
     JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
    [attemptId],
  )
  const { brief } = decodeSessionInput(
    rows.rows[0].manifest_bytes,
    rows.rows[0].manifest_digest,
  ) as ProcessingInputV7Dto
  assert.ok(
    brief.pages.some((page) => !page.entries),
    'some pages are only in the page store',
  )
  // The expected entries, read from the manifest and the stored pages' own bytes.
  const stored = await fixture.db.pool.query<{ page_index: number; page_bytes: Buffer }>(
    'SELECT page_index,page_bytes FROM processing_input_page WHERE input_id=$1',
    [rows.rows[0].input_id],
  )
  const storedEntries = new Map(
    stored.rows.map((page) => [
      page.page_index,
      (JSON.parse(page.page_bytes.toString('utf8')) as { entries: BriefEntryDto[] }).entries,
    ]),
  )
  const expected = brief.pages.flatMap((page) => page.entries ?? storedEntries.get(page.index)!)

  const page = await history(fixture, batchId, rows.rows[0].job_id)
  assert.ok(page.briefs!.some((item) => item.attempt_id === attemptId))
  const shown = await readBrief(fixture, batchId, rows.rows[0].job_id, attemptId)
  assert.equal(shown.brief.entries.length, expected.length)
  assert.deepEqual(shown.brief.entries, expected)
  assert.equal(
    ofKind(shown.brief.entries, 'note').filter((note) => note.text.length > 8000).length,
    8,
  )
})

test('a brief read is scoped to its job, and a broken brief fails only its own read', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const { row: images } = await successorOf(batch, 'led 0603 red', 'images')
  // Another job's attempt, through this job, is not found.
  const crossed = await fixture.http(
    `/batches/${batchId}/processing/${row.job_id}/attempts/${images.attempt_id}/brief`,
  )
  assert.equal(crossed.status, 404)
  assert.equal((crossed.value as { code?: string }).code, 'session_brief_not_found')

  // A stored page gone from the page store refuses the brief, not the history.
  const led = await batch.lot('led 0603 red')
  for (let index = 0; index < 8; index += 1) {
    const before = await snapshotOf(fixture, batchId)
    const note = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: before.revision,
      change: { kind: 'note', subject_id: null, text: `${index}:${'é'.repeat(8000)}` },
    })
    assert.equal(note.status, 200, JSON.stringify(note.value))
  }
  const started = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    subject_ids: [led.id],
    stages: ['research'],
  })
  assert.equal(started.status, 202, JSON.stringify(started.value))
  const attemptId = (started.value as { attempt_ids: string[] }).attempt_ids[0]
  const client = await fixture.db.pool.connect()
  try {
    await client.query('ALTER TABLE processing_input_page DISABLE TRIGGER USER')
    const removed = await client.query(
      `DELETE FROM processing_input_page
        WHERE input_id=(SELECT input_id FROM processing_attempt WHERE id=$1)`,
      [attemptId],
    )
    assert.ok((removed.rowCount ?? 0) > 0)
    await client.query('ALTER TABLE processing_input_page ENABLE TRIGGER USER')
  } finally {
    client.release()
  }
  const broken = await fixture.http(
    `/batches/${batchId}/processing/${row.job_id}/attempts/${attemptId}/brief`,
  )
  assert.deepEqual(
    [broken.status, (broken.value as { code?: string }).code],
    [409, 'processing_input_page_missing'],
  )
  const page = await history(fixture, batchId, row.job_id)
  assert.ok(page.briefs!.some((item) => item.attempt_id === attemptId))
})
