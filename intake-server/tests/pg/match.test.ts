import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type {
  BatchAttentionDto,
  BatchMatchDto,
  CaptureSnapshotDto,
  MatchQuestionDto,
} from '@invimport/contracts'
import { inventoryTransport } from '#/inventory/transport.ts'
import { matchReader, type MatchReader } from '#/inventory/match-reads.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { matchSearch } from '#/processing/match/search.ts'
import {
  settleInTransaction,
  settlePendingSearches,
  type MatchSearch,
} from '#/processing/match/settle.ts'
import { startMatchSweep } from '#/processing/match/sweep.ts'
import { matchGate } from '#/processing/match/gate.ts'
import { decodeRequest } from '#/processing/match/state.ts'
import { transaction } from '#/db/database.ts'
import { inventoryFake, type MatchFakeRecords } from '../fixtures/inventory-fake.ts'
import { processingFixture } from '../support/processing.ts'
import { formedBatch, settleMatch, type Fixture } from '../support/lot-pipeline.ts'
import { call, requeueLot, running, withClients } from '../support/stage-sessions.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { claimSessionSlot } from '#/agents/session/slots.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { singleProvider } from '../support/agent-settings.ts'

const MPN = 'RC0603FR-0710KL'
const YAGEO = '61'

/** An InvenTree with RES-0144 under the Yageo MPN: an image, no datasheet, one key parameter empty. */
const RES_0144: MatchFakeRecords = {
  categories: [
    { pk: 80, name: 'Passives' },
    { pk: 81, name: 'Resistors', parent: 80 },
  ],
  parts: [
    {
      pk: 144,
      name: '10k resistor 0603',
      ipn: 'RES-0144',
      category: 81,
      image: '/media/part_images/r.png',
    },
  ],
  manufacturerParts: [
    { pk: 501, part: 144, mpn: MPN, manufacturer: 61, manufacturer_name: 'Yageo Corporation' },
  ],
  parameters: [{ pk: 3001, model_type: 'part', model_id: 144, template: 201, data: '10k' }],
  categoryParameters: [
    { pk: 311, category: 81, template: 201 },
    { pk: 312, category: 80, template: 202 },
  ],
}

async function matchFixture(t: TestContext, records: MatchFakeRecords = {}) {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  fixture.config.stageInputs = 'local'
  t.after(() => fixture.dispose())
  const fake = await inventoryFake(fixture.db.pool)
  t.after(() => fake.close())
  await fake.seedMatch(records)
  const binding = { targetId: fixture.config.targetId, contextId: fixture.config.targetContextId }
  const transport = inventoryTransport({
    kind: 'protected-read-only',
    origin: fake.origin,
    ...binding,
    protectedOrigins: [fake.origin],
    credential: 'fake-only',
  })
  const reader = matchReader({
    matchList: (operation, timeoutMs) => transport.matchList(binding, operation, timeoutMs),
    read: (operation) => transport.read(binding, operation),
    targetContextId: fixture.config.targetContextId,
  })
  return { fixture, fake, reader }
}

/** Retains catalogue observations a Part spec can cite, as the pickers would. */
async function observe(fixture: Fixture, batchId: string) {
  const category = randomUUID()
  const company = randomUUID()
  const context = fixture.config.targetContextId
  for (const [id, model, pk, label, mapping] of [
    [category, 'category', '81', 'Resistors', { kind: 'category' }],
    [company, 'company', YAGEO, 'Yageo', { kind: 'company', manufacturer: true, supplier: false }],
  ] as const) {
    await fixture.db.pool.query(
      `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label,observed_at,mapping)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)`,
      [id, batchId, fixture.config.targetId, context, model, pk, label, mapping],
    )
  }
  return {
    category: {
      observation_id: category,
      target_context_id: context,
      model: 'category' as const,
      pk: '81',
    },
    company: {
      observation_id: company,
      target_context_id: context,
      model: 'company' as const,
      pk: YAGEO,
    },
  }
}

/** Two operator lots sharing a draft Part whose spec the operator confirms with `mpn`. */
async function operatorLots(fixture: Fixture, mpn: string | null) {
  const capture = await fixture.seedCapture()
  const refs = await observe(fixture, capture.batch.id)
  await capture.edit({ kind: 'add_part', label: 'Resistor' })
  const part = capture.batch.parts[0]
  for (const lot of [capture.packetA, capture.packetB]) {
    await capture.edit({ kind: 'lot', id: lot.id, part_subject_id: part.id })
  }
  await capture.edit({
    kind: 'part',
    id: part.id,
    choice: {
      mode: 'create',
      spec: {
        name: mpn ?? 'Mystery resistor',
        category: refs.category,
        parameters: [],
        manufacturer: mpn ? { company: refs.company, mpn } : null,
        supplier: null,
        tags: [],
      },
    },
  })
  return { capture, part, a: capture.packetA, b: capture.packetB }
}

async function readMatch(fixture: Fixture, batchId: string) {
  const read = await fixture.http(`/batches/${batchId}/match`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  return read.value as BatchMatchDto
}

async function stageJobs(fixture: Fixture, lotId: string) {
  const rows = await fixture.db.pool.query<{
    stage: string
    attempt_id: string
    attempt_state: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
  }>(
    `SELECT j.stage,a.id AS attempt_id,a.state AS attempt_state,i.manifest_bytes,i.manifest_digest
     FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
     JOIN processing_input i ON i.id=a.input_id
     WHERE j.subject_id=$1 AND j.stage IN ('research','images') ORDER BY j.stage`,
    [lotId],
  )
  return rows.rows.map((row) => {
    const input = decodeSessionInput(row.manifest_bytes, row.manifest_digest)
    return {
      stage: row.stage,
      attemptId: row.attempt_id,
      state: row.attempt_state,
      match: 'match' in input ? input.match : undefined,
    }
  })
}

function answer(question: MatchQuestionDto, optionId: string) {
  return {
    expected_question_revision: question.revision,
    steps: [{ step_id: 'decision', value: { kind: 'choice', option_id: optionId } }],
  }
}

function openQuestion(match: BatchMatchDto, lotId: string) {
  return match.questions.find((question) => question.lot_id === lotId && question.state === 'open')
}

test('an operator lot with a confirmed MPN and manufacturer is searched, and a clear search queues both stages', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, '1N4148W-7-F')
  const before = await readMatch(fixture, capture.batch.id)
  assert.equal(before.pipeline, 'match')
  const lot = before.lots.find((item) => item.lot_id === a.id)!
  assert.equal(lot.state, 'searching')
  assert.deepEqual(lot.identity, { kind: 'operator', revision: '1' })
  assert.equal(lot.searchable, true)
  // Nothing starts while the search is pending.
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  assert.deepEqual(await settleMatch(fixture, reader), ['clear', 'clear'])
  const after = (await readMatch(fixture, capture.batch.id)).lots.find(
    (item) => item.lot_id === a.id,
  )!
  assert.equal(after.state, 'clear')
  assert.equal(after.verdict, 'none')
  assert.equal(after.outcome?.basis.kind, 'clear')
  const jobs = await stageJobs(fixture, a.id)
  assert.deepEqual(
    jobs.map((job) => [job.stage, job.match?.mode.mode, job.match?.outcome?.revision]),
    [
      ['images', 'full', after.outcome!.revision],
      ['research', 'full', after.outcome!.revision],
    ],
  )
  // The Processing read says the batch has the Match step in place of Inventory.
  const processing = await fixture.http(`/batches/${capture.batch.id}/processing`)
  assert.equal((processing.value as { pipeline?: string }).pipeline, 'match')
})

test('an operator lot with a name but no manufacturer is asked about, not searched or researched', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, null)
  await settleMatch(fixture, reader)
  const match = await readMatch(fixture, capture.batch.id)
  const question = openQuestion(match, a.id)!
  assert.equal(question.kind, 'unresolved')
  const step = question.steps[0]
  assert.equal(step.answer.kind, 'choice')
  assert.deepEqual(
    step.answer.kind === 'choice' ? step.answer.options.map((option) => option.id) : [],
    ['new_part', 'already_imported'],
  )
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  // A weak key never reaches InvenTree.
  assert.equal(
    (await fake.records()).filter((record) => record.path.startsWith('/api/company/part/')).length,
    0,
  )
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'new_part'),
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  assert.deepEqual(
    (await stageJobs(fixture, a.id)).map((job) => [job.stage, job.match?.mode.mode]),
    [
      ['images', 'full'],
      ['research', 'full'],
    ],
  )
})

test('an exact match holds the lot, and add stock binds only that lot to the existing Part', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t, RES_0144)
  const { capture, part, a, b } = await operatorLots(fixture, MPN)
  assert.deepEqual(await settleMatch(fixture, reader), ['question', 'question'])
  let match = await readMatch(fixture, capture.batch.id)
  const lotA = match.lots.find((lot) => lot.lot_id === a.id)!
  assert.equal(lotA.verdict, 'exact')
  assert.deepEqual(lotA.waits, ['research', 'images'])
  const candidate = lotA.candidates[0]
  assert.equal(candidate.kind, 'part')
  if (candidate.kind === 'part') {
    assert.equal(candidate.part.ipn, 'RES-0144')
    assert.deepEqual(
      candidate.matched_by.map((item) => item.reason),
      ['mpn_and_manufacturer'],
    )
    // It has an image and a manufacturer Part; the datasheet and the inherited parameter are missing.
    assert.deepEqual(
      candidate.missing.map((missing) =>
        missing.kind === 'parameter' ? `parameter:${missing.template}` : missing.kind,
      ),
      ['datasheet', 'parameter:202'],
    )
    assert.equal(candidate.parameters_known, true)
  }
  const question = openQuestion(match, a.id)!
  assert.equal(question.kind, 'candidates')
  assert.deepEqual(
    question.steps[0].answer.kind === 'choice'
      ? question.steps[0].answer.options.map((option) => option.id)
      : [],
    ['add_stock_1', 'fill_gaps_1', 'new_part', 'already_imported'],
  )
  // Needs you lists both questions, before any lot job exists.
  const attention = (await fixture.http(`/batches/${capture.batch.id}/attention`))
    .value as BatchAttentionDto
  if (attention.items) {
    assert.equal(attention.items.filter((item) => item.key.startsWith('match:')).length, 2)
  }
  assert.deepEqual(await stageJobs(fixture, a.id), [])

  const reads = (await fake.records()).length
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'add_stock_1'),
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  // The decision reads nothing more from InvenTree.
  assert.equal((await fake.records()).length, reads)
  const snapshot = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const lotAfter = snapshot.lots.find((lot) => lot.id === a.id)!
  const peer = snapshot.lots.find((lot) => lot.id === b.id)!
  assert.equal(peer.part_subject_id, part.id)
  const target = snapshot.parts.find((item) => item.id === lotAfter.part_subject_id)!
  assert.notEqual(target.id, part.id)
  assert.equal(target.choice.mode, 'set')
  const observation = snapshot.observations.find(
    (item) => target.choice.mode === 'set' && item.id === target.choice.value.observation_id,
  )!
  assert.deepEqual(
    [observation.model, observation.pk, observation.target_context_id],
    ['part', '144', fixture.config.targetContextId],
  )
  // Add stock skips Research; Images takes stock photos only, the Part having an image.
  match = await readMatch(fixture, capture.batch.id)
  const decided = match.lots.find((lot) => lot.lot_id === a.id)!
  assert.equal(decided.state, 'decided')
  assert.deepEqual(decided.outcome?.research, { stage: 'research', mode: 'skipped' })
  assert.deepEqual(decided.outcome?.images, { stage: 'images', mode: 'stock', part_image: false })
  assert.deepEqual(decided.target, { part_pk: '144', name: '10k resistor 0603' })
  assert.deepEqual(
    (await stageJobs(fixture, a.id)).map((job) => [job.stage, job.match?.mode.mode]),
    [['images', 'stock']],
  )
  assert.deepEqual(await stageJobs(fixture, b.id), [])

  // The same question can't be answered twice.
  const again = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'new_part'),
  )
  assert.equal(again.status, 409)
  assert.equal((again.value as { code: string }).code, 'stale_question')

  // Check again with the same result keeps the decision and its revision; Images isn't requeued.
  const images = (await stageJobs(fixture, a.id))[0].attemptId
  const checked = await fixture.http(`/batches/${capture.batch.id}/match/checks`, {
    lot_ids: [a.id],
  })
  assert.equal(checked.status, 202, JSON.stringify(checked.value))
  assert.equal(
    (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!.state,
    'searching',
  )
  assert.deepEqual(await settleMatch(fixture, reader), ['keep'])
  const kept = (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!
  assert.equal(kept.outcome?.revision, decided.outcome?.revision)
  assert.equal((await stageJobs(fixture, a.id))[0].attemptId, images)

  // Decide again as a new Part: A moves to a draft of its own; the shared draft keeps B.
  const reopened = await fixture.http(
    `/batches/${capture.batch.id}/match/lots/${a.id}/question`,
    {},
  )
  assert.equal(reopened.status, 200, JSON.stringify(reopened.value))
  const reasked = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const renewed = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${reasked.id}/answers`,
    answer(reasked, 'new_part'),
  )
  assert.equal(renewed.status, 200, JSON.stringify(renewed.value))
  const moved = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const ownDraft = moved.parts.find(
    (item) => item.id === moved.lots.find((lot) => lot.id === a.id)!.part_subject_id,
  )!
  assert.notEqual(ownDraft.id, part.id)
  assert.notEqual(ownDraft.id, target.id)
  assert.equal(ownDraft.choice.mode, 'unset')
  assert.equal(moved.lots.find((lot) => lot.id === b.id)!.part_subject_id, part.id)
  assert.deepEqual(
    (await stageJobs(fixture, a.id)).map((job) => [job.stage, job.match?.mode.mode]),
    [
      ['images', 'full'],
      ['research', 'full'],
    ],
  )
})

test('two lots answered as one batch share the existing Part subject', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a, b } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const match = await readMatch(fixture, capture.batch.id)
  const questions = [openQuestion(match, a.id)!, openQuestion(match, b.id)!]
  const answered = await fixture.http(`/batches/${capture.batch.id}/match/answers`, {
    answers: questions.map((question) => ({
      question_id: question.id,
      expected_question_revision: question.revision,
      option_id: 'add_stock_1',
    })),
  })
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const snapshot = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const subjects = new Set(
    snapshot.lots.filter((lot) => [a.id, b.id].includes(lot.id)).map((lot) => lot.part_subject_id),
  )
  assert.equal(subjects.size, 1)
  assert.equal(snapshot.observations.filter((item) => item.model === 'part').length, 1)
})

test('InvenTree unavailable holds both stages until Check again can search', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t, RES_0144)
  const { capture, a } = await operatorLots(fixture, '1N4148W-7-F')
  await fake.fault('read_unavailable')
  await settleMatch(fixture, reader)
  const held = (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!
  assert.equal(held.state, 'unavailable')
  assert.deepEqual(held.waits, ['research', 'images'])
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  await fake.fault('none')
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  assert.equal(
    (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!.state,
    'clear',
  )
  assert.equal((await stageJobs(fixture, a.id)).length, 2)
})

test('a result settles only as the latest search, and an answer waits for a newer search', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const question = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  // Two searches on the same identity: generation 2 is read, then generation 3 settles first.
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  const second = await fixture.db.pool.query<{ request_bytes: Buffer }>(
    'SELECT request_bytes FROM processing_match_search WHERE lot_id=$1 AND generation=2',
    [a.id],
  )
  const request = decodeRequest(second.rows[0].request_bytes)
  const early = await matchSearch(fixture.api.pool, fixture.config, reader)(request)
  // While a newer search is pending, the open question can't be answered.
  const refused = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'new_part'),
  )
  assert.equal(refused.status, 409)
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  const settled = await settleMatch(fixture, reader)
  assert.ok(settled.includes('discarded'))
  assert.ok(settled.includes('keep_question'))
  // The older result arriving after the newer one is discarded.
  assert.equal(
    await transaction(fixture.api.pool, (client) =>
      settleInTransaction(client, fixture.config, request, early),
    ),
    'discarded',
  )
  // The question is the same one, answerable again now its pin holds.
  const accepted = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'new_part'),
  )
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
})

test('a committed request still settles after the API restarts, on the deployed roles', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { a } = await operatorLots(fixture, '1N4148W-7-F')
  await fixture.stop()
  await fixture.start()
  // The API's own sweep finds the requests committed before the restart and settles them.
  const sweep = startMatchSweep(
    fixture.api.pool,
    fixture.config,
    matchSearch(fixture.api.pool, fixture.config, reader),
    (event) => assert.fail(event),
    50,
  )
  try {
    const deadline = Date.now() + 30_000
    while ((await stageJobs(fixture, a.id)).length < 2) {
      assert.ok(Date.now() < deadline, 'the sweep settled nothing')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    await sweep.stop()
  }
  const pending = await fixture.db.pool.query(
    'SELECT 1 FROM processing_match_search WHERE settlement IS NULL',
  )
  assert.equal(pending.rowCount, 0)
})

test('another batch of the same actor with the same key is a competing lot, and add stock is not offered', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const first = await operatorLots(fixture, '1N4148W-7-F')
  await settleMatch(fixture, reader)
  const second = await operatorLots(fixture, '1N4148W-7-F')
  await settleMatch(fixture, reader)
  // Lots of one batch never compete; the first batch settled clear before the second existed.
  assert.equal(
    (await readMatch(fixture, first.capture.batch.id)).lots.find(
      (lot) => lot.lot_id === first.a.id,
    )!.state,
    'clear',
  )
  const match = await readMatch(fixture, second.capture.batch.id)
  const question = openQuestion(match, second.a.id)!
  assert.equal(question.kind, 'candidates')
  assert.deepEqual(
    question.candidates.map((candidate) => candidate.kind),
    ['lot', 'lot'],
  )
  assert.deepEqual(
    question.steps[0].answer.kind === 'choice'
      ? question.steps[0].answer.options.map((option) => option.id)
      : [],
    ['new_part', 'already_imported'],
  )
})

/**
 * A representative approval of a lot's original contribution in the execution journal, written
 * with constraint triggers off: only the rows the import reference lookup reads.
 */
async function approveContribution(
  fixture: Fixture,
  lotId: string,
  { actorId, stockPk }: { actorId: string; stockPk?: string },
) {
  const client = await fixture.db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    const ids = {
      approval: randomUUID(),
      preparation: randomUUID(),
      run: randomUUID(),
      operation: randomUUID(),
      key: randomUUID(),
    }
    const bytes = "'\\x7b7d'"
    await client.query(
      `INSERT INTO manual_preparation(id,batch_id,prepare_command_id,actor_id,target_revision,plan_bytes,plan_digest,
         review_bytes,review_digest,dependency_bytes,dependency_digest,preview_bytes)
       SELECT $1,l.batch_id,$2,$3,1,${bytes},sha256(${bytes}),${bytes},sha256(${bytes}),${bytes},sha256(${bytes}),${bytes}
       FROM capture_lot l WHERE l.id=$4`,
      [ids.preparation, randomUUID(), actorId, lotId],
    )
    await client.query(
      `INSERT INTO executor_approval(id,preparation_id,actor_id,deployment_id,target_id,context_id,source_id,original_key,plan_bytes,plan_digest)
       SELECT $1,$2,$3,$4,$5,$6,l.source_id,$7,'\\x7b7d',sha256('\\x7b7d') FROM capture_lot l WHERE l.id=$8`,
      [
        ids.approval,
        ids.preparation,
        actorId,
        randomUUID(),
        fixture.config.targetId,
        fixture.config.targetContextId,
        ids.key,
        lotId,
      ],
    )
    await client.query(
      'INSERT INTO executor_run(id,approval_id,command_id,target_id,original_key) VALUES ($1,$2,$3,$4,$5)',
      [ids.run, ids.approval, randomUUID(), fixture.config.targetId, ids.key],
    )
    await client.query(
      `INSERT INTO executor_operation(run_id,operation_key,target_id,original_key,contribution_key,request_bytes,request_digest)
       SELECT $1,$2,$3,$4,l.contribution_key,'\\x7b7d',sha256('\\x7b7d') FROM capture_lot l WHERE l.id=$5`,
      [ids.run, ids.operation, fixture.config.targetId, ids.key, lotId],
    )
    if (stockPk) {
      await client.query(
        "INSERT INTO executor_effect(intent_id,run_id,operation_key,certainty,remote_pk) VALUES ($1,$2,$3,'confirmed',$4)",
        [randomUUID(), ids.run, ids.operation, stockPk],
      )
    }
    await client.query('COMMIT')
    return ids.run
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

test('an approved original contribution is a hit that offers only already imported, whatever its stock', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a, b } = await operatorLots(fixture, MPN)
  // A's stock was created and later deleted; B was approved by another operator.
  const run = await approveContribution(fixture, a.id, {
    actorId: fixture.config.actorId,
    stockPk: '7999',
  })
  await approveContribution(fixture, b.id, { actorId: randomUUID() })
  await settleMatch(fixture, reader)
  const match = await readMatch(fixture, capture.batch.id)
  const hitA = openQuestion(match, a.id)!
  assert.equal(hitA.kind, 'contribution')
  assert.deepEqual(hitA.contribution, {
    readable: true,
    run_id: run,
    batch_id: capture.batch.id,
    stock: 'deleted',
  })
  // The hit decides: no identity candidates are searched for it.
  assert.deepEqual(hitA.candidates, [])
  assert.deepEqual(
    hitA.steps[0].answer.kind === 'choice'
      ? hitA.steps[0].answer.options.map((option) => option.id)
      : [],
    ['already_imported', 'keep_held'],
  )
  const hitB = openQuestion(match, b.id)!
  assert.deepEqual(hitB.contribution, { readable: false })
  assert.equal(JSON.stringify(hitB).includes('run_id'), false)
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${hitA.id}/answers`,
    answer(hitA, 'already_imported'),
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const decided = (await readMatch(fixture, capture.batch.id)).lots.find(
    (lot) => lot.lot_id === a.id,
  )!
  assert.deepEqual(decided.outcome?.basis, { kind: 'decision', decision: 'already_imported' })
  assert.equal(decided.outcome?.research.mode, 'skipped')
  assert.equal(decided.outcome?.images.mode, 'skipped')
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  // Recorded on the decision, not as a Capture exclusion.
  const snapshot = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  assert.equal(snapshot.lots.find((lot) => lot.id === a.id)!.excluded, undefined)
})

test('a queued stage waits at its claim, and Start refuses, while a newer search is pending', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, deps } = batch
  const lot = await batch.lot('16 mhz crystal')
  const [images, research] = await batch.successors(lot.id)
  assert.equal(research.stage, 'research')
  assert.equal(research.attempt_state, 'queued')
  // Examine's lots have no strong key yet, so Match settled them clear; Check again searches anew.
  const checked = await fixture.http(`/batches/${batchId}/match/checks`, { lot_ids: [lot.id] })
  assert.equal(checked.status, 202, JSON.stringify(checked.value))
  assert.equal(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'queued',
  )
  const held = await fixture.db.pool.query<{ state: string; turn_count: string }>(
    'SELECT a.state, s.turn_count::text FROM processing_attempt a JOIN agent_session s ON s.attempt_id=a.id WHERE a.id=$1',
    [research.attempt_id],
  )
  assert.deepEqual(held.rows[0], { state: 'queued', turn_count: '0' })
  const snapshot = (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
  const start = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: snapshot.revision,
    subject_ids: [lot.id],
    stages: ['images'],
  })
  assert.equal(start.status, 409, JSON.stringify(start.value))
  assert.equal((start.value as { code: string }).code, 'match_waiting')
  // The same result keeps the outcome, so the queued attempts are the ones that run.
  assert.deepEqual(await settleMatch(fixture), ['keep'])
  assert.deepEqual(
    (await batch.successors(lot.id)).map((row) => row.attempt_id),
    [images.attempt_id, research.attempt_id],
  )
  assert.notEqual(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'queued',
  )
})

test('a clear search after add stock asks again, every time, until the operator decides', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a, b } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const match = await readMatch(fixture, capture.batch.id)
  const questions = [openQuestion(match, a.id)!, openQuestion(match, b.id)!]
  await fixture.http(`/batches/${capture.batch.id}/match/answers`, {
    answers: questions.map((question) => ({
      question_id: question.id,
      expected_question_revision: question.revision,
      option_id: 'add_stock_1',
    })),
  })
  // RES-0144 loses the MPN: A's search now finds nothing, twice over.
  await fixture.db.pool.query('DELETE FROM fake_match_manufacturer_part WHERE pk=501')
  for (const round of [1, 2]) {
    await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
    await settleMatch(fixture, reader)
    const lot = (await readMatch(fixture, capture.batch.id)).lots.find(
      (item) => item.lot_id === a.id,
    )!
    assert.equal(lot.state, 'question', `round ${round}`)
    assert.equal(
      openQuestion(await readMatch(fixture, capture.batch.id), a.id)!.kind,
      'target_lost',
    )
    assert.deepEqual(
      (await stageJobs(fixture, a.id)).map((job) => [job.stage, job.match?.mode.mode]),
      [['images', 'stock']],
    )
  }
  const lost = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${lost.id}/answers`,
    answer(lost, 'new_part'),
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const snapshot = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const partOf = (lotId: string) =>
    snapshot.parts.find(
      (part) => part.id === snapshot.lots.find((lot) => lot.id === lotId)!.part_subject_id,
    )!
  assert.equal(partOf(a.id).choice.mode, 'unset')
  const peer = partOf(b.id).choice
  assert.equal(peer.mode === 'set' ? peer.value.pk : null, '144')
})

test('removing the confirmed manufacturer asks again and holds work sealed for the old keys', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, part, a } = await operatorLots(fixture, '1N4148W-7-F')
  await settleMatch(fixture, reader)
  const [, research] = await stageJobs(fixture, a.id)
  const spec = capture.batch.parts.find((item) => item.id === part.id)!.choice
  assert.equal(spec.mode, 'create')
  if (spec.mode === 'create') {
    await capture.edit({
      kind: 'part',
      id: part.id,
      choice: { mode: 'create', spec: { ...spec.spec, manufacturer: null } },
    })
  }
  await settleMatch(fixture, reader)
  assert.equal(openQuestion(await readMatch(fixture, capture.batch.id), a.id)!.kind, 'unresolved')
  const gate = await transaction(fixture.runner.pool, (client) =>
    matchGate(client, a.id, 'research', research.match),
  )
  assert.equal(gate.allowed, false)
})

test('a changed gap asks again, and an equivalent repeat search keeps the open question', async (t) => {
  const imageless: MatchFakeRecords = {
    ...RES_0144,
    parts: [{ pk: 144, name: '10k resistor 0603', ipn: 'RES-0144', category: 81 }],
    categoryParameters: [],
    attachments: [{ pk: 4001, model_type: 'part', model_id: 144, comment: 'Datasheet' }],
  }
  const { fixture, reader } = await matchFixture(t, imageless)
  const { capture, a } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const before = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const options = (question: MatchQuestionDto) =>
    question.steps[0].answer.kind === 'choice'
      ? question.steps[0].answer.options.map((option) => option.id)
      : []
  assert.deepEqual(options(before), ['add_stock_1', 'fill_gaps_1', 'new_part', 'already_imported'])
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  assert.equal(openQuestion(await readMatch(fixture, capture.batch.id), a.id)!.id, before.id)
  // The Part gains its image: nothing is left to fill, so the question is asked afresh.
  await fixture.db.pool.query(
    "UPDATE fake_match_part SET image='/media/part_images/r.png' WHERE pk=144",
  )
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  const after = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  assert.notEqual(after.id, before.id)
  assert.deepEqual(options(after), ['add_stock_1', 'new_part', 'already_imported'])
  const stale = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${before.id}/answers`,
    answer(before, 'fill_gaps_1'),
  )
  assert.equal((stale.value as { code: string }).code, 'stale_question')
})

test('a search reads every page of its matches before it can settle clear', async (t) => {
  const crowd = Array.from({ length: 120 }, (_, index) => ({
    pk: 400 + index,
    name: `Aaa crowd ${String(index).padStart(3, '0')}`,
    description: 'Cross-reference for ZX-1',
  }))
  const { fixture, reader } = await matchFixture(t, {
    parts: [...crowd, { pk: 900, name: 'ZX-1' }],
  })
  const { capture, a } = await operatorLots(fixture, 'ZX-1')
  await settleMatch(fixture, reader)
  const lot = (await readMatch(fixture, capture.batch.id)).lots.find(
    (item) => item.lot_id === a.id,
  )!
  assert.equal(lot.verdict, 'possible')
  assert.deepEqual(
    lot.candidates.map((candidate) => (candidate.kind === 'part' ? candidate.part.pk : null)),
    ['900'],
  )
})

test('a generation settles once: a duplicate sweep’s result never replaces it', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t, RES_0144)
  const { a } = await operatorLots(fixture, MPN)
  const pending = await fixture.db.pool.query<{ request_bytes: Buffer }>(
    'SELECT request_bytes FROM processing_match_search WHERE lot_id=$1 AND settlement IS NULL',
    [a.id],
  )
  const request = decodeRequest(pending.rows[0].request_bytes)
  const search = matchSearch(fixture.api.pool, fixture.config, reader)
  const found = await search(request)
  await fake.fault('read_unavailable')
  const unavailable = await search(request)
  assert.equal(unavailable.searched, 'unavailable')
  const settle = (result: typeof found) =>
    transaction(fixture.api.pool, (client) =>
      settleInTransaction(client, fixture.config, request, result),
    )
  assert.equal(await settle(found), 'question')
  assert.equal(await settle(unavailable), 'discarded')
  const row = await fixture.db.pool.query<{ settlement: string; result_bytes: Buffer }>(
    'SELECT settlement,result_bytes FROM processing_match_search WHERE lot_id=$1 AND generation=$2',
    [a.id, request.generation],
  )
  assert.equal(row.rows[0].settlement, 'settled')
  assert.equal(JSON.parse(row.rows[0].result_bytes.toString()).searched, 'remote')
})

test('a lot Review retired leaves the Match read, its question superseded', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a, b } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  await fixture.db.pool.query(
    'INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id) VALUES ($1,$2,$3,$4)',
    [capture.batch.id, a.id, capture.batch.revision, fixture.config.actorId],
  )
  const match = await readMatch(fixture, capture.batch.id)
  assert.deepEqual(
    match.lots.map((lot) => lot.lot_id),
    [b.id],
  )
  const retired = match.questions.find((question) => question.lot_id === a.id)!
  assert.equal(retired.state, 'superseded')
  const refused = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${retired.id}/answers`,
    answer(retired, 'new_part'),
  )
  assert.equal((refused.value as { code: string }).code, 'stale_question')
})

test('a request the session worker committed settles through the API sweep after a restart', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture } = batch
  const crystal = await batch.lot('16 mhz crystal')
  const before = await batch.successors(crystal.id)
  const [identity] = await batch.identities(crystal.id)
  const value = await fixture.db.pool.query<{ value: Record<string, unknown> }>(
    "SELECT convert_from(value_bytes,'UTF8')::jsonb AS value FROM processing_proposal WHERE id=$1",
    [identity.id],
  )
  // Examine republishes the identity on the worker's writer role: only the request commits.
  await withClients(async (open) => {
    const lead = await open(batch.deps.toolUrl, await running(fixture, batch.leadAttempt))
    const published = await call(lead, 'propose', { proposal: value.rows[0].value })
    assert.equal(published.ok, true, JSON.stringify(published))
  })
  const pending = await fixture.db.pool.query(
    'SELECT 1 FROM processing_match_search WHERE lot_id=$1 AND settlement IS NULL',
    [crystal.id],
  )
  assert.equal(pending.rowCount, 1)
  // The API restarts with the sweep wired as `main.ts` wires it, and settles the request.
  await fixture.stop()
  await fixture.start({
    matchSweep: { reader: undefined, report: (event) => assert.fail(event) },
  })
  const deadline = Date.now() + 30_000
  for (;;) {
    const after = await batch.successors(crystal.id)
    if (after.every((row, index) => row.attempt_id !== before[index].attempt_id)) {
      assert.deepEqual(
        after.map((row) => [row.stage, row.attempt_state]),
        [
          ['images', 'queued'],
          ['research', 'queued'],
        ],
      )
      break
    }
    assert.ok(Date.now() < deadline, 'the API sweep settled nothing')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
})

test('a repeat search that can’t read InvenTree leaves the open question unanswerable until one can', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t, RES_0144)
  // The part number as the operator typed it, with a space: Match asks InvenTree for its spellings.
  const { capture, a } = await operatorLots(fixture, 'RC0603FR -0710KL')
  await settleMatch(fixture, reader)
  const question = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  assert.equal(question.kind, 'candidates')
  await fake.fault('read_unavailable')
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  const refused = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'add_stock_1'),
  )
  assert.equal((refused.value as { code: string }).code, 'match_waiting')
  assert.deepEqual(await stageJobs(fixture, a.id), [])
  await fake.fault('none')
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  const accepted = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'add_stock_1'),
  )
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
})

test('a decision stands for a new operator identity, recorded again so old work waits', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, part, a } = await operatorLots(fixture, null)
  await settleMatch(fixture, reader)
  const question = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'new_part'),
  )
  const [, research] = await stageJobs(fixture, a.id)
  const decided = (await readMatch(fixture, capture.batch.id)).lots.find((l) => l.lot_id === a.id)!
  // The operator confirms an MPN and manufacturer that find nothing.
  const refs = await observe(fixture, capture.batch.id)
  const spec = capture.batch.parts.find((item) => item.id === part.id)!.choice
  if (spec.mode === 'create') {
    await capture.edit({
      kind: 'part',
      id: part.id,
      choice: {
        mode: 'create',
        spec: { ...spec.spec, manufacturer: { company: refs.company, mpn: 'ZZ-404' } },
      },
    })
  }
  await settleMatch(fixture, reader)
  const renewed = (await readMatch(fixture, capture.batch.id)).lots.find((l) => l.lot_id === a.id)!
  assert.deepEqual(renewed.outcome?.basis, decided.outcome?.basis)
  assert.notEqual(renewed.outcome?.revision, decided.outcome?.revision)
  const gate = await transaction(fixture.runner.pool, (client) =>
    matchGate(client, a.id, 'research', research.match),
  )
  assert.equal(gate.allowed, false)
  const [, requeued] = await stageJobs(fixture, a.id)
  assert.notEqual(requeued.attemptId, research.attemptId)
  assert.equal(requeued.match?.outcome?.revision, renewed.outcome?.revision)
})

test('a part number that lengthens when upper-cased is still searched, and the sweep moves on', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, 'ß'.repeat(51))
  assert.deepEqual(await settleMatch(fixture, reader), ['clear', 'clear'])
  assert.equal(
    (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!.state,
    'clear',
  )
})

test('a question asked of an Examine identity since made stale waits for the next identity', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const fake = await inventoryFake(fixture.db.pool)
  t.after(() => fake.close())
  await fake.seedMatch(RES_0144)
  const binding = { targetId: fixture.config.targetId, contextId: fixture.config.targetContextId }
  const transport = inventoryTransport({
    kind: 'protected-read-only',
    origin: fake.origin,
    ...binding,
    protectedOrigins: [fake.origin],
    credential: 'fake-only',
  })
  const reader = matchReader({
    matchList: (operation, timeoutMs) => transport.matchList(binding, operation, timeoutMs),
    read: (operation) => transport.read(binding, operation),
    targetContextId: fixture.config.targetContextId,
  })
  const crystal = await batch.lot('16 mhz crystal')
  const [identity] = await batch.identities(crystal.id)
  const value = await fixture.db.pool.query<{ value: Record<string, unknown> }>(
    "SELECT convert_from(value_bytes,'UTF8')::jsonb AS value FROM processing_proposal WHERE id=$1",
    [identity.id],
  )
  // Examine names the MPN and maker, which InvenTree holds as RES-0144.
  const withMpn = {
    ...value.rows[0].value,
    candidates: [{ mpn: MPN, manufacturer: 'Yageo', confidence: 'high' }],
  }
  await withClients(async (open) => {
    const lead = await open(batch.deps.toolUrl, await running(fixture, batch.leadAttempt))
    const published = await call(lead, 'propose', { proposal: withMpn })
    assert.equal(published.ok, true, JSON.stringify(published))
  })
  await settleMatch(fixture, reader)
  const question = openQuestion(await readMatch(fixture, batchId), crystal.id)!
  assert.equal(question.kind, 'candidates')
  // Capture moves on under the identity (as a regroup does): it is stale before any republish.
  const [current] = (await batch.identities(crystal.id)).filter((row) => row.stale === null)
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES ($1,'lot_regrouped')",
    [current.id],
  )
  const refused = await fixture.http(
    `/batches/${batchId}/match/questions/${question.id}/answers`,
    answer(question, 'add_stock_1'),
  )
  assert.equal((refused.value as { code: string }).code, 'match_waiting')
  const snapshot = (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
  assert.equal(
    snapshot.parts.some((part) => part.choice.mode === 'set'),
    false,
  )
})

test('archiving a batch mid-search neither blocks its settlement nor the requests behind it', async (t) => {
  const { fixture, fake, reader } = await matchFixture(t)
  const first = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  assert.equal((await stageJobs(fixture, first.a.id)).length, 2)
  // RES-0144 appears, so the next search opens a question; the batch is archived before it settles.
  await fake.seedMatch(RES_0144)
  await fixture.http(`/batches/${first.capture.batch.id}/match/checks`, { lot_ids: [first.a.id] })
  await first.capture.edit({ kind: 'batch', archived: true })
  const second = await operatorLots(fixture, '1N4148W-7-F')
  const settled = await settleMatch(fixture, reader)
  assert.ok(settled.includes('question'), JSON.stringify(settled))
  assert.equal(
    (await readMatch(fixture, second.capture.batch.id)).lots.find(
      (lot) => lot.lot_id === second.a.id,
    )!.state,
    'clear',
  )
})

test('a short page or a search past its budget settles as couldn’t search', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a } = await operatorLots(fixture, MPN)
  const state = async () =>
    (await readMatch(fixture, capture.batch.id)).lots.find((lot) => lot.lot_id === a.id)!.state
  // InvenTree counts a match its page leaves out.
  const short: MatchReader = {
    ...reader,
    targetContextId: reader.targetContextId,
    list: (async (operation, timeoutMs) => {
      const page = await reader.list(operation, timeoutMs)
      return page.kind === 'found' ? { ...page, rows: [], count: page.count + 1 } : page
    }) as MatchReader['list'],
  }
  await settlePendingSearches(
    fixture.api.pool,
    fixture.config,
    matchSearch(fixture.api.pool, fixture.config, short),
  )
  assert.equal(await state(), 'unavailable')
  // Reads slower than the whole search's budget.
  const slow: MatchReader = {
    ...reader,
    targetContextId: reader.targetContextId,
    list: (async (operation, timeoutMs) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return reader.list(operation, timeoutMs)
    }) as MatchReader['list'],
  }
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settlePendingSearches(
    fixture.api.pool,
    fixture.config,
    matchSearch(fixture.api.pool, fixture.config, slow, 100),
  )
  assert.equal(await state(), 'unavailable')
  // Once InvenTree reads in full, the lot is asked about.
  await fixture.http(`/batches/${capture.batch.id}/match/checks`, { lot_ids: [a.id] })
  await settleMatch(fixture, reader)
  assert.equal(await state(), 'question')
})

test('a request that keeps failing waits out a backoff, so the requests behind it settle', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const first = await operatorLots(fixture, MPN)
  const second = await operatorLots(fixture, '1N4148W-7-F')
  const failing: MatchSearch = async (request) => {
    if (request.batch_id === first.capture.batch.id) {
      throw new Error('search_failed')
    }
    return matchSearch(fixture.api.pool, fixture.config, reader)(request)
  }
  // The sweep takes one request at a time; the first batch's two fail and wait.
  for (let sweep = 0; sweep < 4; sweep += 1) {
    await settlePendingSearches(fixture.api.pool, fixture.config, failing, 1).catch(() => [])
  }
  const lots = (await readMatch(fixture, second.capture.batch.id)).lots
  assert.deepEqual(
    lots.map((lot) => lot.state),
    ['clear', 'clear'],
  )
  const deferred = await fixture.db.pool.query<{ attempts: number }>(
    'SELECT attempts FROM processing_match_search WHERE batch_id=$1 AND settlement IS NULL',
    [first.capture.batch.id],
  )
  assert.deepEqual(
    deferred.rows.map((row) => row.attempts),
    [1, 1],
  )
})

test('a lot relinked in Capture away from its decided Part is asked about again before work runs', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, part, a } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const question = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${question.id}/answers`,
    answer(question, 'add_stock_1'),
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const [images] = await stageJobs(fixture, a.id)
  // The operator moves the lot back to the shared draft: the decision no longer binds it.
  const current = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const moved = await fixture.http(`/batches/${capture.batch.id}/edits`, {
    expected_revision: current.revision,
    change: { kind: 'lot', id: a.id, part_subject_id: part.id },
  })
  assert.equal(moved.status, 200, JSON.stringify(moved.value))
  const lot = async () =>
    (await readMatch(fixture, capture.batch.id)).lots.find((item) => item.lot_id === a.id)!
  const gate = () =>
    transaction(fixture.runner.pool, (client) => matchGate(client, a.id, 'images', images.match))
  assert.equal((await gate()).allowed, false)
  assert.deepEqual(await settleMatch(fixture, reader), ['question'])
  assert.equal((await lot()).state, 'question')
  assert.equal((await gate()).allowed, false)
})

test('a lot Match holds keeps no place in the slot queue ahead of runnable work', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: (current.value as { revision: string }).revision,
      selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
      session_concurrency: 1,
    }),
  )
  const crystal = await batch.lot('16 mhz crystal')
  const led = await batch.lot('led 0603 red')
  const attempts = [...(await batch.successors(crystal.id)), ...(await batch.successors(led.id))]
  const created = await fixture.db.pool.query<{ id: string; subject_id: string }>(
    `SELECT a.id, j.subject_id FROM processing_attempt a JOIN processing_job j ON j.id=a.job_id
     JOIN agent_session s ON s.attempt_id=a.id
     WHERE a.id = ANY($1::uuid[]) ORDER BY s.queued_since, a.id`,
    [attempts.map((row) => row.attempt_id)],
  )
  // Hold the lot with the oldest queued session; the other lot's first session, queued behind
  // it, still claims the one slot.
  const held = created.rows[0].subject_id
  const runnable = created.rows.find((row) => row.subject_id !== held)!
  assert.ok(created.rows.indexOf(runnable) > 0)
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, runnable.id), false)
  })
  const checked = await fixture.http(`/batches/${batchId}/match/checks`, { lot_ids: [held] })
  assert.equal(checked.status, 202, JSON.stringify(checked.value))
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, runnable.id), true)
  })
})

/** Binds a Part subject of the batch to the existing InvenTree Part `pk`, as the picker would. */
async function existingPart(fixture: Fixture, batchId: string, pk: string) {
  const edit = async (change: unknown) => {
    const current = (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
    const response = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: current.revision,
      change,
    })
    assert.equal(response.status, 200, JSON.stringify(response.value))
    return response.value as CaptureSnapshotDto
  }
  const label = `Existing ${pk}`
  const added = await edit({ kind: 'add_part', label })
  const part = added.parts.find((item) => item.label === label)!
  const observation = randomUUID()
  await fixture.db.pool.query(
    `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label)
     VALUES($1,$2,$3,$4,'part',$5,$6)`,
    [observation, batchId, fixture.config.targetId, fixture.config.targetContextId, pk, label],
  )
  await edit({
    kind: 'part',
    id: part.id,
    choice: {
      mode: 'set',
      value: {
        observation_id: observation,
        target_context_id: fixture.config.targetContextId,
        model: 'part',
        pk,
      },
    },
  })
  return { part, edit }
}

test('a cleared lot bound in Capture to an existing Part is asked about before Research runs', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, MPN)
  assert.deepEqual(await settleMatch(fixture, reader), ['clear', 'clear'])
  const research = (await stageJobs(fixture, a.id)).find((job) => job.stage === 'research')!
  const { part, edit } = await existingPart(fixture, capture.batch.id, '29')
  await edit({ kind: 'lot', id: a.id, part_subject_id: part.id })
  const gate = () =>
    transaction(fixture.runner.pool, (client) =>
      matchGate(client, a.id, 'research', research.match),
    )
  assert.equal((await gate()).allowed, false)
  assert.deepEqual(await settleMatch(fixture, reader), ['question'])
  assert.equal(openQuestion(await readMatch(fixture, capture.batch.id), a.id)!.kind, 'target_lost')
  assert.equal((await gate()).allowed, false)
})

test('a lot relinked by a path that asks Match nothing keeps no place in the slot queue', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: (current.value as { revision: string }).revision,
      selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
      session_concurrency: 1,
    }),
  )
  const crystal = await batch.lot('16 mhz crystal')
  const led = await batch.lot('led 0603 red')
  const attempts = [...(await batch.successors(crystal.id)), ...(await batch.successors(led.id))]
  const created = await fixture.db.pool.query<{ id: string; subject_id: string }>(
    `SELECT a.id, j.subject_id FROM processing_attempt a JOIN processing_job j ON j.id=a.job_id
     JOIN agent_session s ON s.attempt_id=a.id
     WHERE a.id = ANY($1::uuid[]) ORDER BY s.queued_since, a.id`,
    [attempts.map((row) => row.attempt_id)],
  )
  const held = created.rows[0].subject_id
  const runnable = created.rows.find((row) => row.subject_id !== held)!
  const { part } = await existingPart(fixture, batchId, '29')
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, runnable.id), false)
  })
  // Written directly: no hook requests a search, so only the queue scan sees the new target.
  await fixture.db.pool.query('UPDATE capture_lot SET part_subject_id=$2 WHERE id=$1', [
    held,
    part.id,
  ])
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, runnable.id), true)
  })
})

/** A draft Part of the batch confirming `mpn` with the observed maker. */
async function draftPart(fixture: Fixture, batchId: string, mpn: string) {
  const refs = await observe(fixture, batchId)
  const edit = async (change: unknown) => {
    const current = (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
    const response = await fixture.http(`/batches/${batchId}/edits`, {
      expected_revision: current.revision,
      change,
    })
    assert.equal(response.status, 200, JSON.stringify(response.value))
    return response.value as CaptureSnapshotDto
  }
  const label = `Draft ${mpn}`
  const part = (await edit({ kind: 'add_part', label })).parts.find((item) => item.label === label)!
  await edit({
    kind: 'part',
    id: part.id,
    choice: {
      mode: 'create',
      spec: {
        name: mpn,
        category: refs.category,
        parameters: [],
        manufacturer: { company: refs.company, mpn },
        supplier: null,
        tags: [],
      },
    },
  })
  return part
}

test('an operator lot moved to another draft by any path waits, then is searched for the new draft', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, MPN)
  assert.deepEqual(await settleMatch(fixture, reader), ['clear', 'clear'])
  const before = (await stageJobs(fixture, a.id)).find((job) => job.stage === 'research')!
  assert.equal(before.match?.binding?.part_subject_id, capture.batch.parts[0].id)
  const other = await draftPart(fixture, capture.batch.id, '1N4148W-7-F')
  // Written as a Review move would, through no Capture edit hook.
  await fixture.db.pool.query('UPDATE capture_lot SET part_subject_id=$2 WHERE id=$1', [
    a.id,
    other.id,
  ])
  const gate = await transaction(fixture.runner.pool, (client) =>
    matchGate(client, a.id, 'research', before.match),
  )
  assert.deepEqual(gate, { allowed: false, reason: 'binding_changed' })
  // The sweep searches the new draft's identifiers; the stale attempt is replaced.
  assert.deepEqual(await settleMatch(fixture, reader), ['renew'])
  const after = (await stageJobs(fixture, a.id)).find((job) => job.stage === 'research')!
  assert.notEqual(after.attemptId, before.attemptId)
  assert.equal(after.match?.binding?.part_subject_id, other.id)
  const requested = await fixture.db.pool.query<{ request_bytes: Buffer }>(
    'SELECT request_bytes FROM processing_match_search WHERE lot_id=$1 ORDER BY generation DESC LIMIT 1',
    [a.id],
  )
  assert.deepEqual(
    decodeRequest(requested.rows[0].request_bytes).keys.map((key) =>
      key.kind === 'mpn' ? key.mpn : key.kind,
    ),
    ['1N4148W-7-F'],
  )
  const now = await transaction(fixture.runner.pool, (client) =>
    matchGate(client, a.id, 'research', after.match),
  )
  assert.equal(now.allowed, true)
})

test('a stage sealed under an earlier outcome, as when New Part could not queue, keeps no queue place', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture } = batch
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: (current.value as { revision: string }).revision,
      selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
      session_concurrency: 1,
    }),
  )
  const crystal = await batch.lot('16 mhz crystal')
  const led = await batch.lot('led 0603 red')
  // The crystal's Images is sealed under an outcome revision Match no longer has in force.
  const crystalPins = (
    await fixture.db.pool.query<{ pin: string }>(
      `SELECT unnest(ARRAY(SELECT jsonb_array_elements_text(convert_from(i.manifest_bytes,'UTF8')::jsonb->'pinned_proposal_ids'))) AS pin
       FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
       JOIN processing_input i ON i.id=a.input_id WHERE j.subject_id=$1 AND j.stage='images'`,
      [crystal.id],
    )
  ).rows.map((row) => row.pin)
  const stale = await requeueLot(
    fixture,
    batch.batchId,
    crystal.id,
    'images',
    {
      outcome: { revision: '999', basis: { kind: 'decision', decision: 'add_stock' } },
      mode: { stage: 'images', mode: 'stock', part_image: false },
    },
    crystalPins,
  )
  // It is the oldest queued session.
  await fixture.db.pool.query(
    `UPDATE agent_session SET queued_since=queued_since - interval '1 hour' WHERE attempt_id=$1`,
    [stale],
  )
  const gate = await transaction(fixture.runner.pool, async (client) => {
    const sealed = await client.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
      `SELECT i.manifest_bytes, i.manifest_digest FROM processing_attempt a
       JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
      [stale],
    )
    const input = decodeSessionInput(sealed.rows[0].manifest_bytes, sealed.rows[0].manifest_digest)
    return matchGate(client, crystal.id, 'images', 'match' in input ? input.match : undefined)
  })
  assert.deepEqual(gate, { allowed: false, reason: 'outcome_changed' })
  const runnable = await fixture.db.pool.query<{ id: string }>(
    `SELECT a.id FROM processing_attempt a JOIN processing_job j ON j.id=a.job_id
     JOIN agent_session s ON s.attempt_id=a.id
     WHERE j.subject_id=$1 AND a.state='queued' ORDER BY s.queued_since, a.id LIMIT 1`,
    [led.id],
  )
  // Only the crystal's Research, still current, is ahead of the LED's first session.
  const crystalResearch = (await batch.successors(crystal.id)).find(
    (row) => row.stage === 'research',
  )!
  await fixture.db.pool.query(
    `UPDATE agent_session SET queued_since=now() + interval '1 hour' WHERE attempt_id=$1`,
    [crystalResearch.attempt_id],
  )
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, runnable.rows[0].id), true)
  })
})

test('a Part the detail read finds gone is never offered to add stock to', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a } = await operatorLots(fixture, MPN)
  const gone: MatchReader = {
    ...reader,
    targetContextId: reader.targetContextId,
    list: reader.list.bind(reader) as MatchReader['list'],
    part: async (pk) => (pk === '144' ? { kind: 'not_found' } : reader.part(pk)),
  }
  await settlePendingSearches(
    fixture.api.pool,
    fixture.config,
    matchSearch(fixture.api.pool, fixture.config, gone),
  )
  const lot = (await readMatch(fixture, capture.batch.id)).lots.find(
    (item) => item.lot_id === a.id,
  )!
  assert.deepEqual(lot.candidates, [])
  assert.equal(openQuestion(await readMatch(fixture, capture.batch.id), a.id), undefined)
})

test('New Part gives a lot moved off every Part a draft of its own', async (t) => {
  const { fixture, reader } = await matchFixture(t, RES_0144)
  const { capture, a } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const first = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const added = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${first.id}/answers`,
    answer(first, 'add_stock_1'),
  )
  assert.equal(added.status, 200, JSON.stringify(added.value))
  // Review's Move lots with no destination leaves the lot on no Part.
  await fixture.db.pool.query('UPDATE capture_lot SET part_subject_id=NULL WHERE id=$1', [a.id])
  await settleMatch(fixture, reader)
  const again = openQuestion(await readMatch(fixture, capture.batch.id), a.id)!
  const renewed = await fixture.http(
    `/batches/${capture.batch.id}/match/questions/${again.id}/answers`,
    answer(again, 'new_part'),
  )
  assert.equal(renewed.status, 200, JSON.stringify(renewed.value))
  const snapshot = (await fixture.http(`/batches/${capture.batch.id}`)).value as CaptureSnapshotDto
  const own = snapshot.lots.find((lot) => lot.id === a.id)!.part_subject_id
  assert.ok(own)
  assert.equal(snapshot.parts.find((part) => part.id === own)!.choice.mode, 'unset')
  assert.deepEqual(
    (await stageJobs(fixture, a.id)).map((job) => [job.stage, job.match?.mode.mode]),
    [
      ['images', 'full'],
      ['research', 'full'],
    ],
  )
})

test('a lot moved to a draft with the same identifiers keeps its outcome but not its sealed work', async (t) => {
  const { fixture, reader } = await matchFixture(t)
  const { capture, a } = await operatorLots(fixture, MPN)
  await settleMatch(fixture, reader)
  const before = (await stageJobs(fixture, a.id)).find((job) => job.stage === 'research')!
  const twin = await draftPart(fixture, capture.batch.id, MPN)
  await fixture.db.pool.query('UPDATE capture_lot SET part_subject_id=$2 WHERE id=$1', [
    a.id,
    twin.id,
  ])
  assert.deepEqual(await settleMatch(fixture, reader), ['keep'])
  const after = (await stageJobs(fixture, a.id)).find((job) => job.stage === 'research')!
  assert.equal(after.match?.outcome?.revision, before.match?.outcome?.revision)
  assert.notEqual(after.attemptId, before.attemptId)
  // Work sealed for the old draft can't resume, even under the same outcome.
  const stale = await transaction(fixture.runner.pool, (client) =>
    matchGate(client, a.id, 'research', before.match),
  )
  assert.deepEqual(stale, { allowed: false, reason: 'binding_changed' })
})
