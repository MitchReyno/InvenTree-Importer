import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  AgentSessionListDto,
  AgentSessionQueryDto,
  ProcessingStateDto,
  SessionFailureDto,
  SessionStateDto,
} from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { processingMediaFixture } from '../support/processing-media.ts'
import { transaction } from '#/db/database.ts'
import { listAgentSessions } from '#/agents/session/sessions.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { NativeSessionError, providerError, sessionFailure } from '#/agents/failure-model.ts'
import { submitSessionInbox } from '#/agents/tools/inbox.ts'
import { readSessionHistory } from '#/agents/tools/history.ts'
import { startFreshEligibility } from '#/processing/start-fresh-eligibility.ts'
import { replaceSession } from '#/processing/session-replacement.ts'
import { processingRepository } from '#/processing/repository.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
/** One attempt of a chain: the attempt states it passes through, and its session's last state. */
type Step = { path: ProcessingStateDto[]; session: SessionStateDto }

const failedStep: Step = { path: ['running', 'failed'], session: 'failed' }
const supersededFailure: Step = { path: ['running', 'failed', 'superseded'], session: 'failed' }
// The browser's local day in UTC+11, which spans UTC midnight.
const LOCAL_DAY = {
  day_start: '2026-11-24T00:00:00.000+11:00',
  day_end: '2026-11-25T00:00:00.000+11:00',
}

/** A job and its attempts, oldest first; the last is the job's current attempt. */
async function sessionChain(
  f: Fixture,
  capture: Capture,
  lot: { id: string },
  steps: Step[],
  stage: 'research' | 'images' = 'research',
) {
  const first = await lotSession(f, capture, lot, { state: 'queued', stage })
  const attempts = [first.attempt]
  for (let number = 2; number <= steps.length; number++) {
    const attemptId = randomUUID()
    const commandId = randomUUID()
    await f.db.pool.query(
      `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
       SELECT $1,actor_id,target_id,target_context_id,kind,handler_version,$2,queue_name,payload_bytes,payload_digest
         FROM command WHERE id=$3`,
      [commandId, `processing:${attemptId}`, first.command],
    )
    await f.db.pool.query(
      `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
       SELECT $1,batch_id,job_id,$2,input_id,profile_id,$3,channel_digest,'queued'
         FROM processing_attempt WHERE id=$4`,
      [attemptId, number, commandId, first.attempt],
    )
    await f.db.pool.query(
      "INSERT INTO agent_session(attempt_id,session_state,session_lineage_id) VALUES($1,'queued',$2)",
      [attemptId, first.job],
    )
    attempts.push(attemptId)
  }
  for (const [index, step] of steps.entries()) {
    for (const state of step.path) {
      await f.db.pool.query('UPDATE processing_attempt SET state=$2 WHERE id=$1', [
        attempts[index],
        state,
      ])
    }
    await f.db.pool.query('UPDATE agent_session SET session_state=$2 WHERE attempt_id=$1', [
      attempts[index],
      step.session,
    ])
  }
  const current = attempts.at(-1)!
  await f.db.pool.query(
    'UPDATE processing_job SET current_attempt_id=$2,state=(SELECT state FROM processing_attempt WHERE id=$2) WHERE id=$1',
    [first.job, current],
  )
  return { job: first.job, attempts, current }
}

/** Finished sessions on new lots of the batch, two steps a lot; the newest is queued last. */
async function finishedSessions(f: Fixture, capture: Capture, count: number) {
  const sessions = []
  for (let index = 0; sessions.length < count; index++) {
    await capture.edit({
      kind: 'add_lot',
      label: `Filler ${index}`,
      note: 'Finished earlier.',
      part_subject_id: null,
    })
    const lot = capture.batch.lots.find((candidate) => candidate.label === `Filler ${index}`)!
    for (const stage of ['research', 'images'] as const) {
      if (sessions.length < count) {
        sessions.push(
          await sessionChain(
            f,
            capture,
            lot,
            [{ path: ['running', 'ready'], session: 'finished' }],
            stage,
          ),
        )
      }
    }
  }
  return sessions
}

/** Dates an attempt's latest transition, as if it had ended then. */
async function endedAt(f: Fixture, attemptId: string, at: string) {
  await transaction(f.db.pool, async (client) => {
    await client.query(
      'ALTER TABLE processing_transition DISABLE TRIGGER processing_transition_immutable',
    )
    await client.query(
      `UPDATE processing_transition SET created_at=$2
        WHERE sequence=(SELECT max(sequence) FROM processing_transition WHERE attempt_id=$1)`,
      [attemptId, at],
    )
    await client.query(
      'ALTER TABLE processing_transition ENABLE TRIGGER processing_transition_immutable',
    )
  })
}

/** Dates every transition of an attempt into `state`. */
async function enteredAt(f: Fixture, attemptId: string, state: ProcessingStateDto, at: string) {
  await transaction(f.db.pool, async (client) => {
    await client.query(
      'ALTER TABLE processing_transition DISABLE TRIGGER processing_transition_immutable',
    )
    await client.query(
      'UPDATE processing_transition SET created_at=$3 WHERE attempt_id=$1 AND state=$2',
      [attemptId, state, at],
    )
    await client.query(
      'ALTER TABLE processing_transition ENABLE TRIGGER processing_transition_immutable',
    )
  })
}

async function holdSlot(f: Fixture, attemptId: string, index = 0) {
  await f.db.pool.query(
    `INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at) VALUES($1,$2,$3,now())
     ON CONFLICT (actor_id,slot_index) DO UPDATE SET attempt_id=excluded.attempt_id,claimed_at=now()`,
    [f.identity.actor, index, attemptId],
  )
}

async function recordFailure(f: Fixture, attemptId: string, diagnostic: SessionFailureDto) {
  await f.db.pool.query(
    `INSERT INTO agent_session_failure(id,attempt_id,turn_count,diagnostic)
     VALUES($1,$2,(SELECT turn_count FROM agent_session WHERE attempt_id=$2),$3::jsonb)`,
    [diagnostic.id, attemptId, JSON.stringify(diagnostic)],
  )
}

function diagnostic(
  attemptId: string,
  jobId: string,
  error: unknown,
  provider: 'claude' | 'codex',
) {
  return sessionFailure(error, {
    attemptId,
    lineageId: jobId,
    turn: '0',
    stage: 'turn',
    provider,
  })
}

async function status(f: Fixture, attemptId: string, seq: number, text: string) {
  await f.db.pool.query(
    "INSERT INTO agent_session_outbox(session_id,seq,kind,payload) VALUES($1,$2,'status',$3)",
    [attemptId, seq, JSON.stringify({ text })],
  )
}

async function list(f: Fixture, query: AgentSessionQueryDto = {}) {
  return listAgentSessions(f.api.pool, f.config, query)
}

async function allPages(f: Fixture, query: AgentSessionQueryDto) {
  const rows: AgentSessionListDto['sessions'] = []
  let before: string | undefined
  do {
    const page = await list(f, { ...query, ...(before ? { before } : {}) })
    rows.push(...page.sessions)
    before = page.next_before ?? undefined
  } while (before)
  return rows
}

async function eligibility(f: Fixture, jobIds: string[], config = f.config) {
  return transaction(f.api.pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    return startFreshEligibility(client, config, jobIds)
  })
}

test('one row per session, filtered before paging, with scoped counts and filter-independent totals', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const heyyy = await f.seedCapture()
    const spill = await f.seedCapture()
    const archived = await f.seedCapture()
    const filler = await f.seedCapture()
    // Heyyy: a retried Research session now working, a recovered Images session and one waiting.
    const research = await sessionChain(f, heyyy, heyyy.packetA, [
      supersededFailure,
      supersededFailure,
      { path: ['running'], session: 'running' },
    ])
    const recovered = await sessionChain(
      f,
      heyyy,
      heyyy.packetA,
      [supersededFailure, { path: ['running', 'ready'], session: 'finished' }],
      'images',
    )
    const waiting = await sessionChain(f, heyyy, heyyy.packetB, [
      { path: ['running', 'waiting_for_user'], session: 'waiting_input' },
    ])
    // Spill: one that can't resume and one waiting for the provider's sign-in.
    const stuck = await sessionChain(f, spill, spill.packetA, [
      { path: ['running', 'interrupted'], session: 'resume_unavailable' },
    ])
    const signIn = await sessionChain(f, spill, spill.packetB, [
      { path: ['running', 'waiting_for_login'], session: 'waiting_for_login' },
    ])
    const old = await sessionChain(f, archived, archived.packetA, [failedStep])
    await f.db.pool.query('UPDATE capture_batch SET archived=true WHERE id=$1', [archived.batch.id])
    // Newer finished sessions push the ones needing attention beyond the first page of All.
    const fillers = await finishedSessions(f, filler, 52)
    const firstStart = '2026-11-20T01:02:03.000Z'
    await enteredAt(f, research.attempts[0], 'running', firstStart)
    const fillerStart = '2026-11-21T04:05:06.000Z'
    await enteredAt(f, fillers[0].attempts[0], 'running', fillerStart)

    const everything = await list(f)
    assert.equal(everything.filter, 'all')
    assert.equal(everything.sessions.length, 50)
    assert.ok(everything.next_before)
    assert.ok(!everything.sessions.some((row) => row.job_id === stuck.job))
    const all = await allPages(f, {})
    assert.equal(all.length, 58)
    assert.equal(new Set(all.map((row) => row.job_id)).size, 58)

    const attention = await list(f, { filter: 'needs_attention' })
    assert.deepEqual(
      new Set(attention.sessions.map((row) => row.job_id)),
      new Set([waiting.job, stuck.job, signIn.job]),
    )
    assert.equal(attention.next_before, null)
    assert.deepEqual(attention.counts, {
      needs_attention: 3,
      working: 1,
      waiting: 1,
      queued: 0,
      all: 58,
    })
    // Slots, waiting and queued ignore the filter and the page; the batch summary lists every
    // live batch, with Heyyy's earliest start from its first attempt's run.
    await holdSlot(f, research.current)
    const held = await list(f, { filter: 'needs_attention' })
    assert.deepEqual(held.totals, { slots_in_use: 1, queued: 0, waiting: 1 })
    const summary = new Map(held.batches.map((batch) => [batch.batch_id, batch]))
    assert.equal(summary.has(archived.batch.id), false)
    assert.equal(summary.get(heyyy.batch.id)!.matching, 1)
    assert.equal(summary.get(heyyy.batch.id)!.sessions, 3)
    assert.equal(summary.get(heyyy.batch.id)!.first_started_at, firstStart)
    assert.equal(summary.get(spill.batch.id)!.matching, 2)
    assert.equal(summary.get(filler.batch.id)!.matching, 0)
    assert.equal(summary.get(filler.batch.id)!.first_started_at, fillerStart)

    // A resumed turn runs again later; the batch's first start doesn't move.
    await f.db.pool.query("UPDATE processing_attempt SET state='waiting_for_user' WHERE id=$1", [
      research.current,
    ])
    await f.db.pool.query("UPDATE processing_attempt SET state='running' WHERE id=$1", [
      research.current,
    ])
    const resumed = await list(f, { filter: 'working', batch_id: heyyy.batch.id })
    assert.equal(resumed.batches[0].first_started_at, firstStart)

    const row = everything.sessions.find((session) => session.job_id === research.job)
    const retried = row ?? all.find((session) => session.job_id === research.job)!
    assert.equal(retried.attempt_id, research.current)
    assert.equal(retried.attempt_number, 3)
    assert.equal(retried.latest_on_job, true)
    assert.equal(retried.earlier_attempt_count, 2)
    assert.deepEqual(
      retried.earlier_attempts.map((attempt) => [attempt.number, attempt.state]),
      [
        [2, 'superseded'],
        [1, 'superseded'],
      ],
    )
    assert.ok(retried.earlier_attempts.every((attempt) => attempt.ended_at))
    assert.equal(retried.runs_on, 'fixture')
    assert.equal(retried.web, null)
    assert.equal(retried.archived, false)

    // A failure followed by a successful retry no longer needs attention.
    assert.ok(!attention.sessions.some((session) => session.job_id === recovered.job))
    // Archived batches only under All.
    const archivedRow = all.find((session) => session.job_id === old.job)!
    assert.equal(archivedRow.archived, true)
    const allBatches = await list(f)
    assert.equal(
      allBatches.batches.find((batch) => batch.batch_id === archived.batch.id)?.archived,
      true,
    )
    const failedAnywhere = await allPages(f, { filter: 'needs_attention' })
    assert.ok(!failedAnywhere.some((session) => session.job_id === old.job))
  } finally {
    await f.dispose()
  }
})

test('the batch-scoped read under All folds a job outside the first Agents page', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const heyyy = await f.seedCapture()
    const other = await f.seedCapture()
    const retried = await sessionChain(f, heyyy, heyyy.packetA, [
      supersededFailure,
      supersededFailure,
      { path: ['running', 'ready'], session: 'finished' },
    ])
    await finishedSessions(f, other, 51)
    const first = await list(f)
    assert.ok(!first.sessions.some((row) => row.job_id === retried.job))
    const scoped = await list(f, { batch_id: heyyy.batch.id })
    assert.equal(scoped.sessions.length, 1)
    assert.equal(scoped.sessions[0].earlier_attempt_count, 2)
    assert.equal(scoped.counts.all, 1)
    assert.deepEqual(
      scoped.batches.map((batch) => batch.batch_id),
      [heyyy.batch.id],
    )
    await assert.rejects(list(f, { before: 'bm90LWEtY3Vyc29y' }), {
      message: 'invalid_session_cursor',
    })
  } finally {
    await f.dispose()
  }
})

test("Done today follows the browser's day and each attempt's recorded end", async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    // Settled a turn yesterday, cancelled at 01:00 local today (still the 23rd in UTC).
    const cancelled = await sessionChain(f, capture, capture.packetA, [
      { path: ['running', 'ready', 'cancelled'], session: 'cancelled' },
    ])
    await f.db.pool.query(
      "UPDATE agent_session SET finished_at='2026-11-23T10:00:00Z' WHERE attempt_id=$1",
      [cancelled.current],
    )
    await endedAt(f, cancelled.current, '2026-11-23T14:00:00Z')
    // Ended at 23:30 local yesterday.
    const yesterday = await sessionChain(f, capture, capture.packetB, [
      { path: ['running', 'ready'], session: 'finished' },
    ])
    await endedAt(f, yesterday.current, '2026-11-23T12:30:00Z')
    // Cancelled this morning, its worker not yet reaped: it still holds its slot.
    const stopping = await sessionChain(
      f,
      capture,
      capture.packetA,
      [{ path: ['running', 'cancelled'], session: 'cancelling' }],
      'images',
    )
    await endedAt(f, stopping.current, '2026-11-24T01:00:00Z')
    await holdSlot(f, stopping.current)

    const done = await list(f, { filter: 'done_today', ...LOCAL_DAY })
    assert.deepEqual(
      new Set(done.sessions.map((row) => row.job_id)),
      new Set([cancelled.job, stopping.job]),
    )
    assert.equal(done.counts.done_today, 2)
    const working = await list(f, { filter: 'working', ...LOCAL_DAY })
    assert.equal(working.sessions.length, 0)
    assert.equal(working.counts.working, 0)
    // The Done today count is the same while another chip is selected.
    assert.equal(working.counts.done_today, 2)
    assert.equal(working.totals.slots_in_use, 1)
    const stoppingRow = (await list(f, LOCAL_DAY)).sessions.find(
      (row) => row.job_id === stopping.job,
    )!
    assert.equal(stoppingRow.occupies_lane, true)
    assert.equal(stoppingRow.state_since, '2026-11-24T01:00:00.000Z')
    // A UTC day would count differently, so the bounds the browser sent decide.
    const utc = await list(f, {
      filter: 'done_today',
      day_start: '2026-11-24T00:00:00.000Z',
      day_end: '2026-11-25T00:00:00.000Z',
    })
    assert.deepEqual(
      utc.sessions.map((row) => row.job_id),
      [stopping.job],
    )
    assert.equal((await list(f)).counts.done_today, undefined)
    await assert.rejects(list(f, { filter: 'done_today' }), { message: 'invalid_session_query' })
    await assert.rejects(list(f, { day_start: LOCAL_DAY.day_start }), {
      message: 'invalid_session_query',
    })
    await assert.rejects(list(f, { day_start: LOCAL_DAY.day_end, day_end: LOCAL_DAY.day_start }), {
      message: 'invalid_session_query',
    })
  } finally {
    await f.dispose()
  }
})

test('the route takes the query and refuses anything else', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    await sessionChain(f, capture, capture.packetA, [failedStep])
    const query = new URLSearchParams({ filter: 'needs_attention', batch_id: capture.batch.id })
    const listed = await f.http(`/agent-sessions?${query}`)
    assert.equal(listed.status, 200)
    assert.equal((listed.value as AgentSessionListDto).counts.needs_attention, 1)
    const unknown = await f.http('/agent-sessions?filter=running')
    assert.equal(unknown.status, 400)
    assert.equal(unknown.value.code, 'invalid_session_query')
    const extra = await f.http('/agent-sessions?page=2')
    assert.equal(extra.status, 400)
    const cursor = await f.http('/agent-sessions?before=!!')
    assert.equal(cursor.value.code, 'invalid_session_cursor')
  } finally {
    await f.dispose()
  }
})

test('failure summaries carry the sanitized cause and the last status line without debug mode', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    const overloaded = await sessionChain(f, capture, capture.packetA, [failedStep])
    await recordFailure(
      f,
      overloaded.current,
      diagnostic(
        overloaded.current,
        overloaded.job,
        new NativeSessionError('agent_turn_failed', {
          providerError: providerError('claude', { kind: 'overloaded', httpStatus: 529 }),
        }),
        'claude',
      ),
    )
    await status(f, overloaded.current, 1, 'Reading the batch and fetching photos')
    // Two hundred and five later inputs put the status beyond the newest history page.
    for (let index = 0; index < 205; index++) {
      await submitSessionInbox(f.api.pool, {
        binding: f.config,
        batchId: capture.batch.id,
        lineageId: overloaded.job,
        actorId: f.identity.actor,
        idempotencyKey: `later-${index}`,
        kind: 'chat',
        payload: { text: `Later message ${index}` },
      })
    }
    const vm = await sessionChain(f, capture, capture.packetB, [failedStep])
    await recordFailure(
      f,
      vm.current,
      diagnostic(
        vm.current,
        vm.job,
        new NativeSessionError('agent_turn_failed', {
          cause: new NativeSessionError('agent_protocol_invalid'),
        }),
        'claude',
      ),
    )
    const legacy = await sessionChain(f, capture, capture.packetA, [failedStep], 'images')
    const legacyDiagnostic = {
      ...diagnostic(
        legacy.current,
        legacy.job,
        new NativeSessionError('agent_turn_failed'),
        'codex',
      ),
      causes: [],
    }
    await recordFailure(f, legacy.current, legacyDiagnostic)

    const rows = new Map((await list(f)).sessions.map((row) => [row.job_id, row]))
    assert.deepEqual(rows.get(overloaded.job)!.failure!.cause, {
      code: 'agent_turn_failed',
      provider: 'claude',
      provider_error: { kind: 'overloaded', result: null, http_status: 529 },
    })
    assert.equal(
      rows.get(overloaded.job)!.failure!.last_status!.text,
      'Reading the batch and fetching photos',
    )
    assert.deepEqual(rows.get(vm.job)!.failure!.cause, {
      code: 'agent_protocol_invalid',
      provider: 'claude',
    })
    assert.equal(rows.get(legacy.job)!.failure!.cause, undefined)
    assert.equal(rows.get(legacy.job)!.failure!.failed_at, legacyDiagnostic.timestamp)

    const history = await readSessionHistory(f.api.pool, f.config, capture.batch.id, overloaded.job)
    assert.ok(history.before, 'the newest page leaves older entries')
    assert.ok(!history.entries.some((entry) => entry.details.kind === 'status'))
    const attempt = history.session.attempts[0]
    assert.equal(attempt.failure!.last_status!.text, 'Reading the batch and fetching photos')
    assert.equal(attempt.failure!.cause!.provider_error!.http_status, 529)
  } finally {
    await f.dispose()
  }
})

test('Start fresh eligibility names each refusal the command makes before writing', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    const allowed = await sessionChain(f, capture, capture.packetA, [failedStep])
    const running = await sessionChain(
      f,
      capture,
      capture.packetA,
      [{ path: ['running'], session: 'running' }],
      'images',
    )
    // An earlier attempt of this job still holds a slot until its worker is reaped.
    const reaping = await sessionChain(f, capture, capture.packetB, [
      { path: ['running', 'cancelled', 'superseded'], session: 'cancelling' },
      failedStep,
    ])
    await holdSlot(f, reaping.attempts[0])
    const counts = async () =>
      (
        await f.db.pool.query(
          'SELECT (SELECT count(*) FROM processing_attempt) AS attempts, (SELECT count(*) FROM command) AS commands, (SELECT count(*) FROM processing_input) AS inputs',
        )
      ).rows[0]
    const before = await counts()
    const results = await eligibility(f, [allowed.job, running.job, reaping.job])
    assert.deepEqual(results.get(allowed.job), { allowed: true })
    assert.deepEqual(results.get(running.job), {
      allowed: false,
      reason: 'session_not_replaceable',
    })
    assert.deepEqual(results.get(reaping.job), { allowed: false, reason: 'session_reap_pending' })
    // The preflight runs in a read-only transaction and writes nothing.
    assert.deepEqual(await counts(), before)

    const unconfigured = await eligibility(f, [allowed.job], { ...f.config, channelSecret: 'x' })
    assert.deepEqual(unconfigured.get(allowed.job), {
      allowed: false,
      reason: 'processing_channel_unconfigured',
    })
    const unsupported = await eligibility(f, [allowed.job], { ...f.config, profileId: undefined })
    assert.deepEqual(unsupported.get(allowed.job), {
      allowed: false,
      reason: 'unsupported_processing_profile',
    })

    // The Processing step card's job carries it, with no history open, beyond the Agents page.
    const other = await f.seedCapture()
    await finishedSessions(f, other, 51)
    assert.ok(!(await list(f)).sessions.some((row) => row.job_id === allowed.job))
    // Reads only; answering, which needs the capture lock, isn't exercised.
    const noAnswers = undefined as never
    const repository = processingRepository(
      f.api.pool,
      { ...f.config, channelSecret: 'x' },
      noAnswers,
    )
    const snapshot = await repository.read(capture.batch.id)
    const card = snapshot.jobs.find((job) => job.id === allowed.job)!
    assert.deepEqual(card.start_fresh, {
      allowed: false,
      reason: 'processing_channel_unconfigured',
    })
    const configured = await processingRepository(f.api.pool, f.config, noAnswers).read(
      capture.batch.id,
    )
    assert.deepEqual(configured.jobs.find((job) => job.id === allowed.job)!.start_fresh, {
      allowed: true,
    })
    const history = await readSessionHistory(f.api.pool, f.config, capture.batch.id, reaping.job)
    assert.deepEqual(history.session.start_fresh, {
      allowed: false,
      reason: 'session_reap_pending',
    })

    // A retired lot and an archived batch can't start again.
    await f.db.pool.query(
      'INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id) VALUES($1,$2,$3,$4)',
      [capture.batch.id, capture.packetB.id, capture.batch.revision, f.identity.actor],
    )
    const retired = await eligibility(f, [reaping.job])
    assert.deepEqual(retired.get(reaping.job), { allowed: false, reason: 'subject_retired' })
    await f.db.pool.query('UPDATE capture_batch SET archived=true WHERE id=$1', [capture.batch.id])
    const archived = await eligibility(f, [allowed.job])
    assert.deepEqual(archived.get(allowed.job), { allowed: false, reason: 'batch_archived' })
    const listed = await list(f, { batch_id: capture.batch.id })
    assert.deepEqual(listed.sessions.find((row) => row.job_id === allowed.job)!.start_fresh, {
      allowed: false,
      reason: 'batch_archived',
    })
  } finally {
    await f.dispose()
  }
})

test('Start fresh waits while a lot’s linked evidence is still preparing', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    const session = await sessionChain(f, capture, capture.packetA, [failedStep])
    const media = await processingMediaFixture(f, capture.batch.id)
    try {
      await media.upload(capture.packetA.id, 'Still decoding')
      const results = await eligibility(f, [session.job])
      assert.deepEqual(results.get(session.job), { allowed: false, reason: 'media_not_ready' })
    } finally {
      await media.dispose()
    }
  } finally {
    await f.dispose()
  }
})

test('a step whose provider was disabled after the attempt is refused, and the command agrees', async () => {
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    const session = await sessionChain(f, capture, capture.packetA, [failedStep])
    const native = { ...f.config, profileId: 'native-agent/2' as const }
    const selection = {
      provider: 'claude' as const,
      authentication: 'subscription' as const,
      model: 'sonnet',
    }
    await saveAgentSettings(
      f.api.pool,
      f.config,
      singleProvider({ expected_revision: '0', selection }),
    )
    assert.deepEqual((await eligibility(f, [session.job], native)).get(session.job), {
      allowed: true,
    })
    const enabled = singleProvider({ expected_revision: '1', selection })
    await saveAgentSettings(f.api.pool, f.config, {
      ...enabled,
      providers: {
        ...enabled.providers,
        claude: { ...enabled.providers.claude, enabled: false },
      },
      default_provider: null,
    })
    assert.deepEqual((await eligibility(f, [session.job], native)).get(session.job), {
      allowed: false,
      reason: 'agent_settings_required',
    })
    // A tab that still shows Start fresh as allowed is refused by the command with the same code.
    await assert.rejects(
      replaceSession(f.api.pool, native, capture.batch.id, session.job, randomUUID(), {
        expected_capture_revision: capture.batch.revision,
        expected_revision: '1',
        attempt_id: session.current,
      }),
      { code: 'agent_settings_required' },
    )
  } finally {
    await f.dispose()
  }
})

test('an otherwise eligible session whose new input would be too large is refused', async () => {
  const { seedPhoto } = await import('../support/sessions.ts')
  const f = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    const capture = await f.seedCapture()
    const session = await sessionChain(f, capture, capture.packetA, [failedStep])
    let result = (await eligibility(f, [session.job])).get(session.job)
    assert.deepEqual(result, { allowed: true })
    // Photo notes are sealed into the lot's media manifest, which the input embeds, so the input
    // passes its limit while the media manifest and the capture stay within theirs.
    for (let index = 0; index < 40 && result?.allowed; index++) {
      const photo = await seedPhoto(
        f,
        capture.batch.id,
        { width: 10, height: 10 },
        `Photo ${index}`,
      )
      await f.db.pool.query(
        `INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id)
         VALUES(gen_random_uuid(),$1,$2,$3,true,1,$4)`,
        [capture.batch.id, photo.evidence, capture.packetA.id, f.identity.actor],
      )
      await f.db.pool.query(
        `INSERT INTO media_evidence_note(id,batch_id,evidence_id,revision,text,actor_id)
         VALUES(gen_random_uuid(),$1,$2,1,repeat('n',8000),$3)`,
        [capture.batch.id, photo.evidence, f.identity.actor],
      )
      result = (await eligibility(f, [session.job])).get(session.job)
    }
    assert.deepEqual(result, { allowed: false, reason: 'processing_input_capacity' })
  } finally {
    await f.dispose()
  }
})

test('a stale pinned identity makes Start fresh wait', async (t) => {
  const { formedBatch } = await import('../support/lot-pipeline.ts')
  const { fixture, lot, successors, identities } = await formedBatch(t)
  const formed = await lot('led 0603 red')
  const [identity] = await identities(formed.id)
  const prior = (await successors(formed.id)).find((row) => row.stage === 'research')!
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
    [prior.attempt_id],
  )
  await fixture.db.pool.query("UPDATE processing_attempt SET state='interrupted' WHERE id=$1", [
    prior.attempt_id,
  ])
  const check = () =>
    transaction(fixture.api.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return startFreshEligibility(client, fixture.config, [prior.job_id])
    })
  // The successor was queued with the identity pinned; while it is current, replacing is fine.
  const pinned = await fixture.db.pool.query<{ manifest_bytes: Buffer }>(
    `SELECT i.manifest_bytes FROM processing_input i
       JOIN processing_attempt a ON a.input_id=i.id WHERE a.id=$1`,
    [prior.attempt_id],
  )
  assert.ok(pinned.rows[0].manifest_bytes.toString().includes(identity.id))
  assert.deepEqual((await check()).get(prior.job_id), { allowed: true })
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'lot_regrouped')",
    [identity.id],
  )
  assert.deepEqual((await check()).get(prior.job_id), {
    allowed: false,
    reason: 'identity_waiting',
  })
})
