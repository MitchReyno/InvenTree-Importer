import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validate, type SessionHistoryDto, type SessionHistoryEntryDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import {
  leadSession,
  lotSession,
  nextSessionAttempt,
  oneStepAsk,
  seedPhoto,
} from '../support/sessions.ts'
import { mediaEditor } from '../support/media-removal.ts'
import { transaction } from '#/db/database.ts'
import { grantMedia } from '#/media/grants.ts'
import { sealed } from '#/processing/model.ts'
import { replaceSession } from '#/processing/session-replacement.ts'
import { submitSessionInbox, type InboxSubmission } from '#/agents/tools/inbox.ts'
import { appendSessionOutbox } from '#/agents/tools/outbox.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools } from '#/agents/tools/handlers.ts'
import { deliverInstructions } from '#/agents/instructions.ts'
import { retainSessionFailure } from '#/agents/failures.ts'
import { NativeSessionError, sessionFailure } from '#/agents/failure-model.ts'
import { readSessionHistory } from '#/agents/tools/history.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type Entry = SessionHistoryEntryDto
type Details<K extends Entry['details']['kind']> = Extract<Entry['details'], { kind: K }>

const region = (x: number) => ({
  kind: 'pixels' as const,
  x,
  y: 10,
  width: 100,
  height: 100,
  source_width: 768,
  source_height: 512,
})

async function withFixture(run: (fixture: Fixture, capture: Capture) => Promise<void>) {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    await run(fixture, await fixture.seedCapture())
  } finally {
    await fixture.dispose()
  }
}

async function readHistory(fixture: Fixture, batchId: string, jobId: string, before?: string) {
  const query = before === undefined ? '' : `?before=${encodeURIComponent(before)}`
  const read = await fixture.http(`/batches/${batchId}/processing/${jobId}/history${query}`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  validate('SessionHistory', read.value)
  return read.value as SessionHistoryDto
}

function details<K extends Entry['details']['kind']>(entry: Entry | undefined, kind: K) {
  assert.ok(entry, `expected a ${kind} entry`)
  assert.equal(entry.details.kind, kind)
  return entry.details as Details<K>
}

function entriesOf(history: SessionHistoryDto, kind: Entry['details']['kind']) {
  return history.entries.filter((entry) => entry.details.kind === kind)
}

/** The session tools for runner and lead writes, called directly with a session's token. */
function tools(fixture: Fixture, deliveredMedia = new Map<string, Map<string, Set<number>>>()) {
  const handlers = sessionHandlers(fixture, deliveredMedia)
  return async (name: keyof typeof handlers, token: string, args: unknown) => {
    const output = await handlers[name](token, args)
    assert.equal(output.result.ok, true, JSON.stringify(output.result))
    return output.result as { ok: true; id?: string; revision?: string; items?: { seq: string }[] }
  }
}

function sessionHandlers(
  fixture: Fixture,
  deliveredMedia = new Map<string, Map<string, Set<number>>>(),
) {
  return sessionTools({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia,
  })
}

function issue(fixture: Fixture, attemptId: string) {
  return transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
}

function noteSource(
  manifest: { notes: { id: string; subject_id: string | null; text: string }[] },
  lotId: string,
) {
  const note = manifest.notes.find((item) => item.subject_id === lotId)!
  return {
    kind: 'note' as const,
    note_id: note.id,
    text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
  }
}

async function sessionChangedXmins(fixture: Fixture, batchId: string) {
  const rows = await fixture.db.pool.query<{ xmin: string }>(
    `SELECT e.xmin::text FROM ui_event e JOIN capture_batch b ON b.stream_id=e.stream_id
     WHERE b.id=$1 AND e.kind='session_changed' ORDER BY e.sequence`,
    [batchId],
  )
  return rows.rows.map((row) => row.xmin)
}

test('each agent entry resolves its summary, details and links; retired lots and removed photos are gone', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const lead = await leadSession(fixture, capture)
    const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Bench bag spill')
    const notice = await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      batchId,
      lineageId: lead.job,
      actorId: null,
      idempotencyKey: photo.version,
      kind: 'evidence',
      payload: { evidence_id: photo.evidence, version_id: photo.version },
    })
    const call = tools(fixture)
    const token = await issue(fixture, lead.attempt)
    let revision = capture.batch.revision
    const observe = async (x: number, marking: string, observationId?: string) => {
      const result = await call('record_observation', token, {
        base_revision: revision,
        evidence_version_id: photo.version,
        region: region(x),
        readings: { markings: [marking] },
        ...(observationId ? { observation_id: observationId } : {}),
      })
      revision = result.revision!
      return result.id!
    }
    const front = await observe(0, 'RC0603 10k')
    const back = await observe(150, 'RC0603 10k 2407')
    const loose = await observe(300, '1N4148')
    const spare = await observe(450, 'LED 5mm')
    const extra = await observe(600, '1N4148 spare')
    const proposeLot = async (args: Record<string, unknown>) => {
      const result = await call('propose_lot', token, { base_revision: revision, ...args })
      revision = result.revision!
      return result.id!
    }
    const packetB = await proposeLot({
      label: '10 kΩ resistor — packet B',
      observation_ids: [front],
      estimated_quantity: '380',
      quantity_basis: 'Reel label says 400; some were used',
      separation_reason: 'Same MPN as packet A, date code 2407 vs 2341',
    })
    await proposeLot({ lot_id: packetB, observation_ids: [back] })
    const diodes = await proposeLot({
      label: 'Diodes',
      observation_ids: [loose, extra],
      estimated_quantity: '12',
      quantity_basis: 'Twelve visible',
    })
    const leds = await proposeLot({ label: 'LEDs', observation_ids: [spare] })
    // The operator sets the diodes' quantity: an edit, so the lead session only suggests there.
    const edited = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: revision,
      change: { kind: 'lot', id: diodes, quantity: { mode: 'set', value: '23' } },
    })
    assert.equal(edited.status, 200, JSON.stringify(edited.value))
    revision = (edited.value as { revision: string }).revision
    // A mixed regroup: the LED moves; the diode, on an operator-edited lot, is only suggested.
    const regrouped = await call('regroup', token, {
      base_revision: revision,
      moves: [
        { observation_id: spare, to_lot_id: packetB },
        { observation_id: loose, to_lot_id: packetB },
        { observation_id: back, to_lot_id: packetB },
      ],
    })
    revision = regrouped.revision!
    // A move into the edited lot the observation is already in changes nothing.
    const sameLot = await call('regroup', token, {
      base_revision: revision,
      moves: [{ observation_id: loose, to_lot_id: diodes }],
    })
    revision = sameLot.revision!
    // Extending an agent lot with an observation the operator placed only suggests it, and
    // naming one already there changes nothing.
    await proposeLot({ lot_id: packetB, observation_ids: [extra] })
    // Repeating that suggestion writes nothing new.
    await proposeLot({ lot_id: packetB, observation_ids: [extra] })
    const extraSuggestions = await fixture.db.pool.query(
      `SELECT 1 FROM capture_lot_evidence_observation
        WHERE lot_id=$1 AND evidence_observation_id=$2 AND status='suggested'`,
      [packetB, extra],
    )
    assert.equal(extraSuggestions.rowCount, 1)
    await proposeLot({ lot_id: packetB, observation_ids: [front] })
    // A reason PostgreSQL can't store, with a NUL or an unpaired surrogate, is refused before
    // anything is written.
    const outboxCount = async () => {
      const rows = await fixture.db.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM agent_session_outbox WHERE session_id=$1',
        [lead.attempt],
      )
      return rows.rows[0].n
    }
    for (const reason of ['Date code \u0000 2407', 'Date code \ud800 2407']) {
      const outboxBefore = await outboxCount()
      const unstorable = await sessionHandlers(fixture).propose_lot(token, {
        base_revision: revision,
        lot_id: packetB,
        observation_ids: [front],
        separation_reason: reason,
      })
      assert.equal(!unstorable.result.ok && unstorable.result.error, 'validation_failed')
      assert.deepEqual(
        !unstorable.result.ok && unstorable.result.issues?.map((issue) => issue.path),
        ['/separation_reason'],
      )
      assert.equal(await outboxCount(), outboxBefore)
      const unchangedBatch = (await fixture.http(`/batches/${batchId}`)).value as {
        revision: string
      }
      assert.equal(unchangedBatch.revision, revision)
    }
    // The first call on the operator-edited diodes lot only suggests.
    await proposeLot({ lot_id: diodes, observation_ids: [back] })
    // Repeating it writes no second suggestion, though the session is still told it only
    // suggested.
    const repeated = await call('propose_lot', token, {
      base_revision: revision,
      lot_id: diodes,
      observation_ids: [back],
    })
    revision = repeated.revision!
    assert.equal((repeated as { suggested?: boolean }).suggested, true)
    const backSuggestions = await fixture.db.pool.query(
      `SELECT 1 FROM capture_lot_evidence_observation
        WHERE lot_id=$1 AND evidence_observation_id=$2 AND status='suggested'`,
      [diodes, back],
    )
    assert.equal(backSuggestions.rowCount, 1)
    // A regroup of the same observation onto that suggestion is still only a suggestion.
    const onSuggestion = await call('regroup', token, {
      base_revision: revision,
      moves: [{ observation_id: back, to_lot_id: diodes }],
    })
    revision = onSuggestion.revision!
    const backActive = await fixture.db.pool.query<{ lot_id: string }>(
      `SELECT lot_id FROM capture_lot_evidence_observation
        WHERE evidence_observation_id=$1 AND status='active'`,
      [back],
    )
    assert.deepEqual(
      backActive.rows.map((row) => row.lot_id),
      [packetB],
    )
    // The agent revises its first observation in place, under the same ID.
    await observe(0, 'RC0603 10k 2341', front)
    await call('status', token, { text: 'Comparing date codes' })
    await call('reply', token, { inbox_item_id: notice.item_id, text: 'Got the new photo.' })
    const asked = await call(
      'ask',
      token,
      oneStepAsk({
        kind: 'clarification',
        subject_id: packetB,
        prompt: 'Is the second date code on the same reel?',
        reason: 'Two date codes are visible.',
        fields: ['identity'],
        assumption: 'Treating them as one reel.',
      }),
    )
    await transaction(fixture.runner.pool, async (client) => {
      // A regroup recorded before moves were kept, and a photo view of a region.
      // Items recorded before outcomes and moves were kept.
      await appendSessionOutbox(client, lead.attempt, {
        kind: 'regroup',
        payload: { lot_ids: [diodes] },
      })
      await appendSessionOutbox(client, lead.attempt, { kind: 'lot', payload: { lot_id: diodes } })
      await appendSessionOutbox(client, lead.attempt, {
        kind: 'photo_view',
        payload: {
          evidence_id: photo.evidence,
          version_id: photo.version,
          page: 1,
          region: { x: 0, y: 10, width: 100, height: 100 },
          delivered: { width: 100, height: 100, media_type: 'image/png', sha256: 'a'.repeat(64) },
        },
      })
    })

    const history = await readHistory(fixture, batchId, lead.job)
    assert.equal(history.before, undefined)
    const agent = history.entries.filter((entry) => entry.who === 'agent')
    assert.ok(agent.every((entry) => entry.who === 'agent' && entry.attempt === 1))

    const observations = entriesOf(history, 'observation')
    assert.equal(observations.length, 6)
    // Both entries for the revised observation show its current values, labelled as such.
    const frontEntries = observations.filter(
      (entry) => details(entry, 'observation').current?.id === front,
    )
    assert.equal(frontEntries.length, 2)
    for (const entry of frontEntries) {
      const current = details(entry, 'observation').current!
      assert.deepEqual(current.readings.markings, ['RC0603 10k 2341'])
      assert.equal(entry.summary, 'Recorded an observation in Bench bag spill')
      assert.deepEqual(entry.links, [
        {
          kind: 'capture_evidence',
          evidence_id: photo.evidence,
          version_id: photo.version,
          page: 1,
          label: 'Bench bag spill',
        },
        { kind: 'map', observation_id: front },
      ])
    }

    const lots = entriesOf(history, 'lot')
    const packetEntries = lots.filter((entry) => details(entry, 'lot').lot?.id === packetB)
    assert.deepEqual(
      packetEntries.map((entry) => [entry.summary, details(entry, 'lot').outcome]),
      [
        ['Proposed no change to 10 kΩ resistor — packet B', 'unchanged'],
        ['Proposed no change to 10 kΩ resistor — packet B', 'unchanged'],
        ['Suggested changes to 10 kΩ resistor — packet B', 'suggested'],
        ['Extended 10 kΩ resistor — packet B', 'extended'],
        ['Formed 10 kΩ resistor — packet B', 'formed'],
      ],
    )
    const diodeEntries = lots.filter((entry) => details(entry, 'lot').lot?.id === diodes)
    assert.deepEqual(
      diodeEntries.map((entry) => [entry.summary, details(entry, 'lot').outcome]),
      [
        ['Proposed Diodes', null],
        ['Proposed no change to Diodes', 'unchanged'],
        ['Suggested changes to Diodes', 'suggested'],
        ['Formed Diodes', 'formed'],
      ],
    )
    const formed = details(packetEntries[4], 'lot')
    assert.equal(formed.current, true)
    assert.equal(formed.separation_reason, 'Same MPN as packet A, date code 2407 vs 2341')
    assert.deepEqual(formed.not_retained, [])
    // A call that gave no reason says so rather than borrowing another call's.
    assert.equal(details(packetEntries[3], 'lot').separation_reason, null)
    assert.deepEqual(details(packetEntries[3], 'lot').not_retained, ['separation_reason'])
    assert.deepEqual(formed.lot!.estimate, {
      quantity: '380',
      basis: 'Reel label says 400; some were used',
    })
    assert.deepEqual(
      formed.lot!.observations.map((item) => item.id).sort(),
      [front, back, spare].sort(),
    )
    assert.deepEqual(packetEntries[4].links, [
      { kind: 'lot', lot_id: packetB, label: '10 kΩ resistor — packet B' },
      { kind: 'map', lot_id: packetB },
    ])
    // After the operator's quantity change, the selected quantity stands apart from the estimate.
    const diodeLot = details(
      lots.find((entry) => details(entry, 'lot').lot?.id === diodes),
      'lot',
    ).lot!
    assert.deepEqual(diodeLot.selected_quantity, { mode: 'set', value: '23' })
    assert.deepEqual(diodeLot.estimate, { quantity: '12', basis: 'Twelve visible' })
    assert.equal(diodeLot.operator_edited, true)

    const [older, stillSuggested, inPlace, mixed] = entriesOf(history, 'regroup')
    assert.deepEqual(details(stillSuggested, 'regroup').moves, [
      { observation_id: back, from_lot_id: packetB, to_lot_id: diodes, outcome: 'suggested' },
    ])
    assert.deepEqual(details(inPlace, 'regroup').moves, [
      { observation_id: loose, from_lot_id: diodes, to_lot_id: diodes, outcome: 'unchanged' },
    ])
    assert.equal(inPlace.summary, '1 already in place')
    const sameLotSuggestions = await fixture.db.pool.query(
      `SELECT 1 FROM capture_lot_evidence_observation
        WHERE lot_id=$1 AND evidence_observation_id=$2 AND status='suggested'`,
      [diodes, loose],
    )
    assert.equal(sameLotSuggestions.rowCount, 0)
    assert.deepEqual(details(mixed, 'regroup').moves, [
      { observation_id: spare, from_lot_id: leds, to_lot_id: packetB, outcome: 'applied' },
      { observation_id: loose, from_lot_id: diodes, to_lot_id: packetB, outcome: 'suggested' },
      { observation_id: back, from_lot_id: packetB, to_lot_id: packetB, outcome: 'unchanged' },
    ])
    assert.equal(
      mixed.summary,
      'Moved 1 observation, suggested moving 1 observation, 1 already in place',
    )
    assert.deepEqual(
      mixed.links.map((link) => (link.kind === 'lot' ? link.lot_id : link.kind)).sort(),
      [leds, diodes, packetB].sort(),
    )
    // An older regroup kept only its destinations, and lists those.
    assert.equal(details(older, 'regroup').moves, undefined)
    assert.equal(older.summary, 'Regrouped observations into Diodes')

    const status = entriesOf(history, 'status')[0]
    assert.equal(status.summary, 'Comparing date codes')
    assert.deepEqual(status.links, [])
    const reply = entriesOf(history, 'reply')[0]
    assert.equal(details(reply, 'reply').inbox_item_id, notice.item_id)
    const question = entriesOf(history, 'question')[0]
    assert.equal(question.summary, 'Asked: Is the second date code on the same reel?')
    assert.equal(details(question, 'question').state, 'open')
    assert.deepEqual(question.links[0], {
      kind: 'question',
      question_id: asked.id,
      label: 'Is the second date code on the same reel?',
    })
    const view = entriesOf(history, 'photo_view')[0]
    assert.equal(view.summary, 'Prepared part of Bench bag spill for the agent')
    assert.deepEqual(details(view, 'photo_view').crop, {
      attempt_id: lead.attempt,
      seq: view.id.split(':')[2],
    })
    const evidence = entriesOf(history, 'evidence')[0]
    assert.deepEqual([evidence.who, evidence.summary], ['app', 'New photo: Bench bag spill'])

    // A retired lot and a removed photo keep their details, with gone links. The LEDs are
    // merged into packet B, as an operator merge leaves them.
    await transaction(fixture.db.pool, async (client) => {
      await client.query(
        `INSERT INTO capture_lot_lineage(batch_id,predecessor_lot_id,successor_lot_id,action,revision,actor_id)
         VALUES($1,$2,$3,'merge',$4,$5)`,
        [batchId, leds, packetB, revision, fixture.identity.actor],
      )
      await client.query(
        'INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id) VALUES($1,$2,$3,$4)',
        [batchId, leds, revision, fixture.identity.actor],
      )
    })
    await grantMedia(fixture.db.pool, fixture.api.name, 'api')
    await mediaEditor(fixture.api.pool, fixture.config, batchId).applied({
      kind: 'remove',
      evidence_ids: [photo.evidence],
    })
    const later = await readHistory(fixture, batchId, lead.job)
    const ledEntry = entriesOf(later, 'lot').find(
      (entry) => details(entry, 'lot').lot?.id === leds,
    )!
    assert.deepEqual(ledEntry.links, [{ kind: 'gone', target: 'lot', label: 'Lot retired' }])
    assert.equal(details(ledEntry, 'lot').lot!.retired, true)
    const removedView = entriesOf(later, 'photo_view')[0]
    assert.deepEqual(removedView.links, [
      { kind: 'gone', target: 'evidence', label: 'Photo removed' },
    ])
    assert.equal(details(removedView, 'photo_view').crop, null)
    const removedObservation = entriesOf(later, 'observation')[0]
    assert.equal(removedObservation.links[0].kind, 'gone')
    assert.ok(details(removedObservation, 'observation').current, 'what the agent did is kept')
  })
})

test('operator inputs and app notices read as theirs, placed by their time, with what was read', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const session = await lotSession(fixture, capture, capture.packetA)
    const call = tools(fixture)
    const token = await issue(fixture, session.attempt)
    const instructionId = randomUUID()
    await fixture.db.pool.query(
      `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id,created_at)
       VALUES($1,$2,NULL,(SELECT revision FROM capture_batch WHERE id=$2),$3,$4,now()-interval '1 hour')`,
      [instructionId, batchId, 'Keep the two resistor packets apart.', fixture.identity.actor],
    )
    await deliverInstructions(fixture.api.pool, fixture.config, batchId)
    const asked = await call(
      'ask',
      token,
      oneStepAsk({
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in packet A?',
        reason: 'The label is folded.',
        fields: ['quantity'],
        assumption: 'About 20.',
      }),
    )
    const revision = ((await fixture.http(`/batches/${batchId}`)).value as { revision: string })
      .revision
    const answered = await fixture.http(`/batches/${batchId}/questions/${asked.id}/answers`, {
      schema_version: 'bench-intake-answer/2',
      expected_question_revision: '1',
      expected_capture_revision: revision,
      attempt_id: session.attempt,
      input_sha256: sealed(session.manifest).digest.toString('hex'),
      steps: [{ step_id: 'answer', value: { kind: 'number', value: '380', basis: 'estimated' } }],
    })
    assert.equal(answered.status, 200, JSON.stringify(answered.value))
    const chat = await fixture.http(`/batches/${batchId}/processing/${session.job}/inbox`, {
      idempotency_key: randomUUID(),
      text: 'Check the Microchip PB datasheet first',
    })
    assert.equal(chat.status, 200)
    const notices: Pick<InboxSubmission, 'kind' | 'payload'>[] = [
      { kind: 'evidence', payload: { evidence_id: randomUUID(), version_id: randomUUID() } },
      {
        kind: 'revision',
        payload: { fields: ['identity'], reason: "The lot's identity was revised: GE S2CN1 diode" },
      },
    ]
    for (const notice of notices) {
      await submitSessionInbox(fixture.api.pool, {
        binding: fixture.config,
        batchId,
        lineageId: session.job,
        actorId: null,
        idempotencyKey: randomUUID(),
        ...notice,
      })
    }

    // The session reads up to the answer: the cursor moves and open readers hear of it.
    const items = await fixture.db.pool.query<{ seq: string; kind: string }>(
      'SELECT seq::text, kind FROM agent_session_inbox WHERE session_lineage_id=$1 ORDER BY seq',
      [session.job],
    )
    const answerSeq = items.rows.find((row) => row.kind === 'answer')!.seq
    const before = await sessionChangedXmins(fixture, batchId)
    await call('read_inbox', token, { after_seq: answerSeq })
    const after = await sessionChangedXmins(fixture, batchId)
    assert.equal(after.length, before.length + 1)
    const cursor = await fixture.db.pool.query<{ xmin: string }>(
      'SELECT xmin::text FROM agent_session_cursor WHERE session_lineage_id=$1',
      [session.job],
    )
    assert.equal(after.at(-1), cursor.rows[0].xmin, 'published in the same transaction')
    // A read that doesn't move the cursor publishes nothing.
    await call('read_inbox', token, { after_seq: answerSeq })
    assert.equal((await sessionChangedXmins(fixture, batchId)).length, after.length)

    const history = await readHistory(fixture, batchId, session.job)
    assert.equal(history.session.inbox_acked_seq, answerSeq)
    const answer = entriesOf(history, 'answer')[0]
    assert.deepEqual([answer.who, answer.summary], ['operator', 'You answered: 380 estimated'])
    assert.equal(answer.who !== 'agent' && answer.read, true)
    assert.deepEqual(details(answer, 'answer').effects, [
      { kind: 'quantity', lot_id: capture.packetA.id, value: '380', basis: 'estimated' },
    ])
    assert.deepEqual(answer.links, [
      { kind: 'question', question_id: asked.id, label: 'How many are in packet A?' },
      { kind: 'lot', lot_id: capture.packetA.id, label: 'Packet A' },
      { kind: 'map', lot_id: capture.packetA.id },
    ])
    const message = entriesOf(history, 'chat')[0]
    assert.deepEqual([message.who, message.who !== 'agent' && message.read], ['operator', false])
    const [revisionNotice] = entriesOf(history, 'revision')
    const [evidenceNotice] = entriesOf(history, 'evidence')
    assert.deepEqual([revisionNotice.who, evidenceNotice.who], ['app', 'app'])
    assert.equal(revisionNotice.summary, "Revision: The lot's identity was revised: GE S2CN1 diode")
    assert.deepEqual(evidenceNotice.links, [
      { kind: 'gone', target: 'evidence', label: 'Photo no longer exists' },
    ])

    // Start fresh relays the saved instruction to the new attempt, placed at its relay time.
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
      [session.attempt],
    )
    const job = await fixture.db.pool.query<{ revision: string }>(
      'SELECT revision::text FROM processing_job WHERE id=$1',
      [session.job],
    )
    const current = ((await fixture.http(`/batches/${batchId}`)).value as { revision: string })
      .revision
    await replaceSession(fixture.api.pool, fixture.config, batchId, session.job, randomUUID(), {
      expected_capture_revision: current,
      expected_revision: job.rows[0].revision,
      attempt_id: session.attempt,
    })
    const restarted = await readHistory(fixture, batchId, session.job)
    const instructions = entriesOf(restarted, 'instruction')
    assert.equal(instructions.length, 2)
    const saved = await fixture.db.pool.query<{ created_at: Date }>(
      'SELECT created_at FROM capture_instruction WHERE id=$1',
      [instructionId],
    )
    const [relayed, first] = instructions
    for (const entry of instructions) {
      assert.equal(entry.who, 'operator')
      assert.equal(details(entry, 'instruction').saved_at, saved.rows[0].created_at.toISOString())
      assert.ok(Date.parse(entry.at) > saved.rows[0].created_at.getTime(), 'placed when sent')
    }
    assert.equal(details(first, 'instruction').relayed, false)
    assert.equal(details(relayed, 'instruction').relayed, true)
    assert.equal(relayed.summary, 'Instruction relayed: Keep the two resistor packets apart.')
    assert.equal(relayed.who !== 'agent' && relayed.read, false, 'past the cursor, not read yet')
  })
})

test('a proposal links its lot, sources, first web reads and every open question making it provisional', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const lead = await leadSession(fixture, capture)
    // A photo of packet A, delivered to its session.
    const photo = await seedPhoto(fixture, batchId, { width: 64, height: 48 }, 'Packet A label')
    await fixture.db.pool.query(
      'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
      [randomUUID(), batchId, photo.evidence, capture.packetA.id, fixture.identity.actor],
    )
    const session = await lotSession(fixture, capture, capture.packetA)
    const call = tools(fixture, new Map([[session.job, new Map([[photo.version, new Set([1])]])]]))
    const token = await issue(fixture, session.attempt)
    const leadToken = await issue(fixture, lead.attempt)
    const source = noteSource(session.manifest, capture.packetA.id)
    const stored = await fixture.db.pool.query<{ sha256: string }>(
      "SELECT encode(blob_digest,'hex') AS sha256 FROM media_version WHERE id=$1",
      [photo.version],
    )
    const photoSource = {
      kind: 'media_version',
      evidence_id: photo.evidence,
      version_id: photo.version,
      sha256: stored.rows[0].sha256,
    }
    const datasheet = {
      kind: 'web_page',
      url: 'https://example.com/atmega.pdf',
      title: 'ATmega328P datasheet',
    }
    const errata = { kind: 'web_page', url: 'https://example.org/errata' }
    const propose = (summary: string, sources: unknown[], catalogued?: unknown[]) =>
      call('propose', token, {
        proposal: {
          schema_version: 'bench-intake-proposal/6',
          subject_id: capture.packetA.id,
          summary,
          sources,
          relies_on: { fields: ['identity'], sources: [source] },
          ...(catalogued
            ? {
                catalogue: {
                  category: null,
                  parameters: [],
                  manufacturer: null,
                  supplier: null,
                  description: { text: 'AVR microcontroller', sources: catalogued },
                },
              }
            : {}),
        },
      })
    const first = await propose('ATmega328P-AU', [source, datasheet])
    // The note is cited at the top and on a field, and linked once.
    const second = await propose('ATmega328P-AU, rev D', [datasheet, source, errata], [source])
    // The note and the photo are cited on a field only.
    const fieldOnly = await propose('ATmega328P-AU in TQFP-32', [errata], [source, photoSource])
    // Two open questions on the lot share the identity field: the session's and the lead's.
    const own = await call(
      'ask',
      token,
      oneStepAsk({
        kind: 'clarification',
        subject_id: capture.packetA.id,
        prompt: 'Which package is it?',
        reason: 'The marking is worn.',
        fields: ['identity'],
        assumption: 'TQFP-32.',
      }),
    )
    const leads = await call(
      'ask',
      leadToken,
      oneStepAsk({
        kind: 'clarification',
        subject_id: capture.packetA.id,
        prompt: 'Is packet A one reel?',
        reason: 'Two labels are visible.',
        fields: ['identity', 'quantity'],
        assumption: 'One reel.',
      }),
    )

    const history = await readHistory(fixture, batchId, session.job)
    const proposals = entriesOf(history, 'proposal')
    assert.equal(proposals.length, 3)
    const [catalogued, newer, older] = proposals
    assert.equal(details(catalogued, 'proposal').proposal_id, fieldOnly.id)
    const noteLinksOf = (entry: Entry) =>
      entry.links.filter((link) => link.kind === 'note' && link.note_id === source.note_id)
    assert.equal(noteLinksOf(catalogued).length, 1, 'a field-only note source is linked')
    assert.deepEqual(
      catalogued.links.filter((link) => link.kind === 'capture_evidence'),
      [
        {
          kind: 'capture_evidence',
          evidence_id: photo.evidence,
          version_id: photo.version,
          page: 1,
          label: 'Packet A label',
        },
      ],
      'a field-only photo source is linked',
    )
    assert.equal(noteLinksOf(newer).length, 1, 'a note cited twice is linked once')
    const facts = details(older, 'proposal')
    assert.equal(facts.proposal_id, first.id)
    assert.deepEqual(facts.currentness, {
      state: 'provisional',
      question_ids: [own.id!, leads.id!].sort(),
    })
    assert.equal(older.summary, 'Proposed ATmega328P-AU · provisional')
    const questionLinks = older.links.filter((link) => link.kind === 'question')
    assert.deepEqual(questionLinks.map((link) => link.kind === 'question' && link.label).sort(), [
      'Is packet A one reel?',
      'Which package is it?',
    ])
    assert.deepEqual(older.links.slice(0, 4), [
      { kind: 'lot', lot_id: capture.packetA.id, label: 'Packet A' },
      { kind: 'map', lot_id: capture.packetA.id },
      {
        kind: 'note',
        note_id: source.note_id,
        subject_id: capture.packetA.id,
        label: 'Label says approximately 20. Human count unresolved.',
      },
      {
        kind: 'external_url',
        url: datasheet.url,
        label: 'ATmega328P datasheet',
      },
    ])
    // Each cited page is read once per attempt, with the first proposal that cites it.
    const reads = entriesOf(history, 'web_read')
    assert.deepEqual(
      reads.map((entry) => [entry.id, details(entry, 'web_read').url, entry.summary]),
      [
        [`${newer.id}:web:2`, errata.url, 'Read example.org'],
        [`${older.id}:web:1`, datasheet.url, 'Read ATmega328P datasheet'],
      ],
    )
    assert.equal(details(reads[1], 'web_read').proposal_entry_id, older.id)
    assert.equal(history.entries.indexOf(reads[1]), history.entries.indexOf(older) + 1)
    assert.equal(second.ok, true)

    // Answering one question leaves the other making it provisional.
    const revision = ((await fixture.http(`/batches/${batchId}`)).value as { revision: string })
      .revision
    const answered = await fixture.http(`/batches/${batchId}/questions/${own.id}/answers`, {
      schema_version: 'bench-intake-answer/2',
      expected_question_revision: '1',
      expected_capture_revision: revision,
      attempt_id: session.attempt,
      input_sha256: sealed(session.manifest).digest.toString('hex'),
      steps: [{ step_id: 'answer', value: { kind: 'text', text: 'TQFP-32' } }],
    })
    assert.equal(answered.status, 200, JSON.stringify(answered.value))
    const later = await readHistory(fixture, batchId, session.job)
    const proposal = entriesOf(later, 'proposal').find(
      (entry) => details(entry, 'proposal').proposal_id === first.id,
    )!
    const currentness = details(proposal, 'proposal').currentness
    assert.ok(
      currentness.state === 'stale' ||
        (currentness.state === 'provisional' && currentness.question_ids.join() === leads.id),
      JSON.stringify(currentness),
    )
    const answer = entriesOf(later, 'answer')[0]
    assert.equal(answer.summary, 'You answered: TQFP-32')
    assert.deepEqual(details(answer, 'answer').effects, [
      { kind: 'note', subject_id: capture.packetA.id },
    ])
    assert.equal(details(entriesOf(later, 'question')[0], 'question').state, 'answered')
  })
})

async function setState(fixture: Fixture, attemptId: string, state: string, sessionState: string) {
  await fixture.db.pool.query('UPDATE processing_attempt SET state=$2 WHERE id=$1', [
    attemptId,
    state,
  ])
  await fixture.db.pool.query('UPDATE agent_session SET session_state=$2 WHERE attempt_id=$1', [
    attemptId,
    sessionState,
  ])
}

async function latestTransition(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ created_at: Date }>(
    'SELECT max(created_at) AS created_at FROM processing_transition WHERE attempt_id=$1',
    [attemptId],
  )
  return rows.rows[0].created_at.toISOString()
}

async function fail(fixture: Fixture, attempt: string, job: string) {
  await transaction(fixture.runner.pool, (client) =>
    retainSessionFailure(
      client,
      sessionFailure(new NativeSessionError('agent_tool_refused'), {
        attemptId: attempt,
        lineageId: job,
        turn: '0',
        stage: 'turn',
      }),
    ),
  )
}

test('attempt headers say how each attempt ended and why it started, from its queue time', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const agent = {
      provider: 'claude' as const,
      authentication: 'subscription' as const,
      model: 'claude-opus-5-5',
    }
    const session = await lotSession(fixture, capture, capture.packetA, {
      profile: {
        id: 'shared-vm-agent/3',
        agent,
        settingsRevision: '1',
        web: { public_pages: true, prefer_datasheets: false },
      },
    })
    // Turns within an attempt are not attempts, and a turn's start is not the span's.
    await fixture.db.pool.query(
      "UPDATE agent_session SET turn_count=3, started_at=now()+interval '1 hour', finished_at=now()+interval '2 hours' WHERE attempt_id=$1",
      [session.attempt],
    )
    await setState(fixture, session.attempt, 'ready', 'finished')
    const finishedAt = await latestTransition(fixture, session.attempt)
    let history = await readHistory(fixture, batchId, session.job)
    assert.equal(history.session.attempts.length, 1)
    const [only] = history.session.attempts
    assert.deepEqual(only.ended, { at: finishedAt, source: 'transition' })
    assert.equal(only.started_because, 'first')
    const queued = await fixture.db.pool.query<{ queued_at: Date }>(
      'SELECT queued_at FROM agent_session WHERE attempt_id=$1',
      [session.attempt],
    )
    assert.equal(only.queued_at, queued.rows[0].queued_at.toISOString())

    // Resumed, then cancelled: the end is the cancellation, not the earlier finish. No new
    // inbox or outbox item is written; the next read shows it.
    await setState(fixture, session.attempt, 'running', 'running')
    history = await readHistory(fixture, batchId, session.job)
    assert.equal(history.session.attempts[0].ended, undefined)
    await setState(fixture, session.attempt, 'cancelled', 'cancelled')
    history = await readHistory(fixture, batchId, session.job)
    assert.equal(history.session.attempts[0].state, 'cancelled')
    assert.deepEqual(history.session.attempts[0].ended, {
      at: await latestTransition(fixture, session.attempt),
      source: 'transition',
    })
    assert.notEqual(history.session.attempts[0].ended!.at, finishedAt)
    // The latest transition is found by its retained order, not its time: a transaction that
    // started earlier can commit its transition later.
    await fixture.db.pool.query(
      `INSERT INTO processing_transition(attempt_id,previous_state,state,created_at)
       VALUES($1,'cancelled','cancelled',now()-interval '1 day')`,
      [session.attempt],
    )
    const reordered = await fixture.db.pool.query<{ created_at: Date }>(
      'SELECT created_at FROM processing_transition WHERE attempt_id=$1 ORDER BY sequence DESC LIMIT 1',
      [session.attempt],
    )
    history = await readHistory(fixture, batchId, session.job)
    assert.equal(history.session.attempts[0].ended!.at, reordered.rows[0].created_at.toISOString())

    // Attempt 2 fails; attempt 3 starts after it and is cancelled before its first turn.
    const second = await nextSessionAttempt(fixture, capture, session, capture.packetA, 2, {
      id: 'synthetic-session/1',
    })
    await setState(fixture, second.attempt, 'failed', 'failed')
    await fail(fixture, second.attempt, session.job)
    const third = await nextSessionAttempt(
      fixture,
      capture,
      session,
      capture.packetA,
      3,
      { id: 'synthetic-session/1' },
      'queued',
    )
    await setState(fixture, third.attempt, 'cancelled', 'cancelled')
    // Attempt 4 is live, superseding nothing yet.
    const fourth = await nextSessionAttempt(fixture, capture, session, capture.packetA, 4, {
      id: 'native-agent/2',
      agent,
      settingsRevision: '2',
    })
    history = await readHistory(fixture, batchId, session.job)
    const attempts = history.session.attempts
    assert.deepEqual(
      attempts.map((attempt) => [attempt.number, attempt.state, attempt.started_because]),
      [
        [4, 'running', null],
        [3, 'cancelled', 'after_failure'],
        [2, 'failed', null],
        [1, 'cancelled', 'first'],
      ],
    )
    assert.equal(history.session.current_attempt_id, fourth.attempt)
    assert.equal(attempts[0].ended, undefined)
    assert.deepEqual(attempts[1].ended, {
      at: await latestTransition(fixture, third.attempt),
      source: 'transition',
    })
    // Every attempt's failure resolves, not only the latest's.
    assert.equal(attempts[2].failure?.category, 'tool_policy')
    assert.equal(attempts[0].failure, undefined)
    // Where each ran and its sealed web setting come from that attempt's input.
    assert.deepEqual(
      attempts.map((attempt) => [attempt.runs_on, attempt.web, attempt.selection?.model ?? null]),
      [
        ['host', null, 'claude-opus-5-5'],
        ['fixture', null, null],
        ['fixture', null, null],
        ['agent_vm', { public_pages: true, prefer_datasheets: false }, 'claude-opus-5-5'],
      ],
    )
  })
})

test('the before cursor pages without gaps or duplicates across streams, retries and equal times', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const session = await lotSession(fixture, capture, capture.packetA)
    await setState(fixture, session.attempt, 'failed', 'failed')
    const retry = await nextSessionAttempt(fixture, capture, session, capture.packetA, 2, {
      id: 'synthetic-session/1',
    })
    // Both attempts write sequences 1–150 at the same instants, beside inbox rows at them too.
    await fixture.db.pool.query(
      `INSERT INTO agent_session_outbox(session_id,seq,kind,payload,created_at)
       SELECT a.id, n, 'status', jsonb_build_object('text', 'Line ' || n),
              timestamptz '2026-11-24 10:00:00+00' + (n / 3) * interval '1 millisecond'
         FROM unnest($1::uuid[]) a(id), generate_series(1, 150) n`,
      [[session.attempt, retry.attempt]],
    )
    await fixture.db.pool.query(
      `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key,actor_id,created_at)
       SELECT gen_random_uuid(), $1, n, 'chat', jsonb_build_object('text', 'Message ' || n),
              'chat:' || n, $2, timestamptz '2026-11-24 10:00:00+00' + (n / 2) * interval '1 millisecond'
         FROM generate_series(1, 120) n`,
      [session.job, fixture.identity.actor],
    )
    const seen: string[] = []
    const times: string[] = []
    let before: string | undefined
    let pages = 0
    do {
      const page = await readHistory(fixture, batchId, session.job, before)
      pages += 1
      // Every page carries the whole metadata.
      assert.equal(page.session.attempts.length, 2)
      seen.push(...page.entries.map((entry) => entry.id))
      times.push(...page.entries.map((entry) => entry.at))
      before = page.before
      assert.ok(page.entries.length <= 200)
    } while (before)
    assert.equal(pages, 3)
    assert.equal(seen.length, 420)
    assert.equal(new Set(seen).size, 420)
    assert.deepEqual(times, [...times].sort().reverse())
    // The newest page again, with nothing new, still carries the metadata and cursor.
    const again = await readHistory(fixture, batchId, session.job)
    assert.equal(again.session.inbox_acked_seq, '0')
    assert.deepEqual(
      again.entries.map((entry) => entry.id),
      seen.slice(0, 200),
    )

    // A cursor the read did not issue is refused.
    const forgeries = [
      'bm90LWpzb24',
      Buffer.from('["x",1,"y","1"]').toString('base64url'),
      // PostgreSQL has no year 0, though JavaScript round-trips it.
      Buffer.from(JSON.stringify(['0000-01-01T00:00:00.000Z', 1, session.attempt, '1'])).toString(
        'base64url',
      ),
      // A date JavaScript would quietly move to 2 March.
      Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000Z', 1, session.attempt, '1'])).toString(
        'base64url',
      ),
    ]
    for (const forged of forgeries) {
      const refused = await fixture.http(
        `/batches/${batchId}/processing/${session.job}/history?before=${forged}`,
      )
      assert.equal(refused.status, 400)
    }
  })
})

/**
 * A pool whose read commits a change from another connection just before the page's rows are
 * read, after the snapshot was taken.
 */
function racingPool(pool: Pool, race: () => Promise<void>): Pool {
  const connect = async () => {
    const client = await pool.connect()
    let raced = false
    const query = async (...args: unknown[]) => {
      const first = args[0] as string | { text?: string }
      const text = typeof first === 'string' ? first : (first?.text ?? '')
      if (!raced && /FROM public\.agent_session_cursor/.test(text)) {
        raced = true
        await race()
      }
      return (client.query as (...values: unknown[]) => Promise<unknown>)(...args)
    }
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return query
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PoolClient
  }
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return connect
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

test('a lineage of more than 1000 attempts lists every attempt on every page', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const session = await lotSession(fixture, capture, capture.packetA)
    await setState(fixture, session.attempt, 'failed', 'failed')
    // Attempts 2–1001 reuse the first attempt's input, each with its own command.
    await fixture.db.pool.query(
      `WITH first AS (
         SELECT a.input_id, a.profile_id, a.channel_digest FROM processing_attempt a WHERE a.id=$1
       ), ids AS (
         SELECT n, gen_random_uuid() AS attempt_id, gen_random_uuid() AS command_id,
                convert_to('{"fixture":"history-attempt","n":' || n || '}', 'UTF8') AS payload
           FROM generate_series(2, 1001) n
       ), commands AS (
         INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
         SELECT command_id, $3, $4, $5, 'process', 'processing/5', 'processing:' || attempt_id,
                'bench-sessions', payload, sha256(payload)
           FROM ids
       ), attempts AS (
         INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
         SELECT ids.attempt_id, $2, $6, ids.n, first.input_id, first.profile_id, ids.command_id,
                first.channel_digest, 'cancelled'
           FROM ids, first
         RETURNING id
       )
       INSERT INTO agent_session(attempt_id,session_state,session_lineage_id)
       SELECT id, 'cancelled', $6 FROM attempts`,
      [
        session.attempt,
        batchId,
        fixture.identity.actor,
        fixture.identity.target,
        fixture.identity.context,
        session.job,
      ],
    )
    await fixture.db.pool.query(
      `INSERT INTO agent_session_outbox(session_id,seq,kind,payload)
       SELECT $1, n, 'status', jsonb_build_object('text', 'Line ' || n) FROM generate_series(1, 201) n`,
      [session.attempt],
    )
    const newest = await readHistory(fixture, batchId, session.job)
    const older = await readHistory(fixture, batchId, session.job, newest.before)
    for (const page of [newest, older]) {
      assert.equal(page.session.attempts.length, 1001)
      assert.equal(new Set(page.session.attempts.map((attempt) => attempt.id)).size, 1001)
      assert.equal(page.session.attempts[0].number, 1001)
      assert.equal(page.session.attempts.at(-1)!.number, 1)
    }
    // Paging continues past the newest page without gaps or duplicates.
    assert.equal(newest.entries.length, 200)
    const seen = [...newest.entries, ...older.entries].map((entry) => entry.id)
    assert.equal(new Set(seen).size, seen.length)
    assert.ok(seen.includes(`outbox:${session.attempt}:201`))
    assert.ok(older.entries.some((entry) => entry.id === `outbox:${session.attempt}:1`))
    assert.equal(older.before, undefined)
  })
})

test('a page, its cursor and its metadata come from one snapshot', async () => {
  await withFixture(async (fixture, capture) => {
    const session = await lotSession(fixture, capture, capture.packetA)
    const pool = racingPool(fixture.api.pool, async () => {
      await transaction(fixture.runner.pool, (client) =>
        appendSessionOutbox(client, session.attempt, {
          kind: 'status',
          payload: { text: 'Written during the read' },
        }),
      )
      await setState(fixture, session.attempt, 'ready', 'finished')
    })
    const raced = await readSessionHistory(pool, fixture.config, capture.batch.id, session.job)
    assert.deepEqual(raced.entries, [])
    assert.equal(raced.session.attempts[0].state, 'running')
    const next = await readHistory(fixture, capture.batch.id, session.job)
    assert.deepEqual(
      next.entries.map((entry) => entry.summary),
      ['Written during the read'],
    )
    assert.equal(next.session.attempts[0].state, 'ready')
  })
})

test('a session from another batch or account is not found', async () => {
  await withFixture(async (fixture, capture) => {
    const session = await lotSession(fixture, capture, capture.packetA)
    const otherBatch = (await fixture.seedCapture()).batch.id
    for (const path of [
      `/batches/${otherBatch}/processing/${session.job}/history`,
      `/batches/${capture.batch.id}/processing/${randomUUID()}/history`,
    ]) {
      const read = await fixture.http(path)
      assert.deepEqual(
        [read.status, (read.value as { code: string }).code],
        [404, 'session_not_found'],
      )
    }
    // After the job's stage is queued under a profile without sessions, its retained session
    // history still reads.
    const switched = await nextSessionAttempt(
      fixture,
      capture,
      session,
      capture.packetA,
      2,
      { id: 'synthetic-session/1' },
      'queued',
      false,
    )
    const retained = await readHistory(fixture, capture.batch.id, session.job)
    assert.equal(retained.session.current_attempt_id, switched.attempt)
    assert.deepEqual(
      retained.session.attempts.map((attempt) => attempt.id),
      [session.attempt],
    )
    for (const field of ['actorId', 'targetId', 'targetContextId'] as const) {
      await assert.rejects(
        readSessionHistory(
          fixture.api.pool,
          { ...fixture.config, [field]: randomUUID() },
          capture.batch.id,
          session.job,
        ),
        { code: 'session_not_found' },
      )
    }
  })
})

/** A pool that counts the statements every read sends. */
function countingPool(pool: Pool) {
  const counter = { statements: 0 }
  const connect = async () => {
    const client = await pool.connect()
    const query = async (...args: unknown[]) => {
      counter.statements += 1
      return (client.query as (...values: unknown[]) => Promise<unknown>)(...args)
    }
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return query
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PoolClient
  }
  const counted = new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return connect
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { pool: counted, counter }
}

test('resolution reads each kind once per page, however many entries it holds', async () => {
  await withFixture(async (fixture, capture) => {
    const session = await lotSession(fixture, capture, capture.packetA)
    const call = tools(fixture)
    const token = await issue(fixture, session.attempt)
    const source = noteSource(session.manifest, capture.packetA.id)
    const write = async (round: number) => {
      await call('status', token, { text: `Round ${round}` })
      await call('propose', token, {
        proposal: {
          schema_version: 'bench-intake-proposal/6',
          subject_id: capture.packetA.id,
          summary: `Round ${round}`,
          sources: [source, { kind: 'web_page', url: `https://example.com/${round}` }],
          relies_on: { fields: ['identity'], sources: [source] },
        },
      })
      await call(
        'ask',
        token,
        oneStepAsk({
          kind: 'clarification',
          subject_id: capture.packetA.id,
          prompt: `Question ${round}?`,
          reason: 'Unclear marking.',
          fields: ['identity'],
          assumption: 'As read.',
        }),
      )
      await fixture.http(`/batches/${capture.batch.id}/processing/${session.job}/inbox`, {
        idempotency_key: randomUUID(),
        text: `Message ${round}`,
      })
    }
    const statements = async () => {
      const { pool, counter } = countingPool(fixture.api.pool)
      const history = await readSessionHistory(pool, fixture.config, capture.batch.id, session.job)
      return { count: counter.statements, entries: history.entries.length }
    }
    await write(1)
    const few = await statements()
    for (let round = 2; round <= 6; round += 1) {
      await write(round)
    }
    const many = await statements()
    assert.ok(many.entries > few.entries * 4)
    assert.equal(many.count, few.count)
  })
})

test('an idle attempt cancelled or superseded after a settled turn ends at that transition', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const settle = async (attemptId: string) => {
      // A settled turn writes finished_at; the attempt's later end is not that.
      await fixture.db.pool.query(
        "UPDATE agent_session SET turn_count=1, finished_at=now()-interval '1 hour' WHERE attempt_id=$1",
        [attemptId],
      )
      await setState(fixture, attemptId, 'ready', 'finished')
    }
    const cancelled = await lotSession(fixture, capture, capture.packetA)
    await settle(cancelled.attempt)
    await setState(fixture, cancelled.attempt, 'cancelled', 'cancelled')
    const [header] = (await readHistory(fixture, batchId, cancelled.job)).session.attempts
    assert.deepEqual(header.ended, {
      at: await latestTransition(fixture, cancelled.attempt),
      source: 'transition',
    })

    // A settled session that can't resume is idle until Start fresh supersedes it; the new
    // attempt still starts after a failure.
    const replaced = await lotSession(fixture, capture, capture.packetB)
    await settle(replaced.attempt)
    await setState(fixture, replaced.attempt, 'interrupted', 'resume_unavailable')
    const job = await fixture.db.pool.query<{ revision: string }>(
      'SELECT revision::text FROM processing_job WHERE id=$1',
      [replaced.job],
    )
    const current = ((await fixture.http(`/batches/${batchId}`)).value as { revision: string })
      .revision
    await replaceSession(fixture.api.pool, fixture.config, batchId, replaced.job, randomUUID(), {
      expected_capture_revision: current,
      expected_revision: job.rows[0].revision,
      attempt_id: replaced.attempt,
    })
    const attempts = (await readHistory(fixture, batchId, replaced.job)).session.attempts
    assert.deepEqual(
      attempts.map((attempt) => [attempt.number, attempt.state, attempt.started_because]),
      [
        [2, 'queued', 'after_failure'],
        [1, 'superseded', 'first'],
      ],
    )
    assert.equal(attempts[0].ended, undefined)
    assert.deepEqual(attempts[1].ended, {
      at: await latestTransition(fixture, replaced.attempt),
      source: 'transition',
    })
  })
})

test('a lot identity revised by the lead session reaches Research as the app’s notice', async (t) => {
  const { formedBatch, photoWithNote } = await import('../support/lot-pipeline.ts')
  const { triggerExamine } = await import('#/processing/examine-trigger.ts')
  const { queueSessionResume, runSessionTurn } = await import('#/agents/session/session-runner.ts')
  const { fixture, deps, batchId, leadJob, leadAttempt, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const research = (await successors(led.id)).find((row) => row.stage === 'research')!
  await setState(fixture, research.attempt_id, 'running', 'running')
  await photoWithNote(fixture, batchId, 'Reel', 'LED 0603 red')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')

  const history = await readHistory(fixture, batchId, research.job_id)
  const [revision] = entriesOf(history, 'revision')
  assert.equal(revision.who, 'app')
  assert.ok(
    revision.summary.startsWith("Revision: The lot's identity was revised:"),
    revision.summary,
  )
  assert.deepEqual(details(revision, 'revision').fields, ['identity'])
  assert.equal('read' in revision && revision.read, false)
})

/**
 * A runner pool whose next tool transaction starts, then waits for `gate` before going on, so a
 * second call can start later and commit first.
 */
function heldPool(pool: Pool, gate: Promise<void>): Pool {
  let held = false
  const connect = async () => {
    const client = await pool.connect()
    const query = async (...args: unknown[]) => {
      const result = await (client.query as (...values: unknown[]) => Promise<unknown>)(...args)
      const first = args[0] as string | { text?: string }
      const text = typeof first === 'string' ? first : (first?.text ?? '')
      if (!held && text === 'BEGIN') {
        held = true
        // Fix the transaction's start time, which now() and created_at use, then wait.
        await client.query('SELECT now()')
        await gate
      }
      return result
    }
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return query
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PoolClient
  }
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') {
        return connect
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

test('a web read goes with the first proposal in outbox order, even one created later', async () => {
  await withFixture(async (fixture, capture) => {
    const session = await lotSession(fixture, capture, capture.packetA)
    const token = await issue(fixture, session.attempt)
    const source = noteSource(session.manifest, capture.packetA.id)
    const page = { kind: 'web_page', url: 'https://example.com/shared.pdf' }
    const proposal = (summary: string) => ({
      proposal: {
        schema_version: 'bench-intake-proposal/6',
        subject_id: capture.packetA.id,
        summary,
        sources: [source, page],
        relies_on: { fields: ['identity'], sources: [source] },
      },
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const late = sessionTools({
      pool: heldPool(fixture.runner.pool, gate),
      config: fixture.config,
      statusIntervalMs: 0,
      imageBudget: new Map(),
      deliveredMedia: new Map(),
    })
    // The held call starts first but commits second, with the higher sequence.
    const started = late.propose(token, proposal('Started first'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await tools(fixture)('propose', token, proposal('Committed first'))
    release()
    assert.equal((await started).result.ok, true)

    const history = await readHistory(fixture, capture.batch.id, session.job)
    const proposals = entriesOf(history, 'proposal')
    const bySummary = new Map(proposals.map((entry) => [entry.summary, entry]))
    const first = bySummary.get('Proposed Committed first')!
    const second = bySummary.get('Proposed Started first')!
    assert.ok(Date.parse(second.at) < Date.parse(first.at), 'created earlier, sequenced later')
    const [read] = entriesOf(history, 'web_read')
    assert.equal(entriesOf(history, 'web_read').length, 1)
    assert.equal(details(read, 'web_read').proposal_entry_id, first.id)
  })
})
