import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  MAX_ANSWER_SUMMARY_BYTES,
  type ProcessingAnswerDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { legacySessionQuestion, lotSession, nextSessionAttempt } from '../support/sessions.ts'
import { sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { acknowledgeSessionInbox, submitSessionInbox } from '#/agents/tools/inbox.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import { MAX_PROCESSING_SNAPSHOT_BYTES } from '#/processing/limits.ts'
import { answerMemberBytes } from '#/processing/answer-summary.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type Session = Awaited<ReturnType<typeof lotSession>> & { token: string }
type Question = ProcessingSnapshotDto['jobs'][number]['questions'][number]

interface ToolResult {
  ok: boolean
  id?: string
  error?: string
  issues?: { path: string }[]
  items?: { seq: string; kind: string }[]
}

async function call(url: string, token: string, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: 'answered-questions-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  try {
    const result = await client.callTool({ name, arguments: args })
    return result.structuredContent as unknown as ToolResult
  } finally {
    await client.close()
  }
}

async function withSessions(
  run: (context: {
    fixture: Fixture
    capture: Capture
    url: string
    a: Session
    b: Session
  }) => Promise<void>,
) {
  const fixture = await processingFixture()
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 60_000,
  })
  try {
    const capture = await fixture.seedCapture()
    const a = await lotSession(fixture, capture, capture.packetA)
    const b = await lotSession(fixture, capture, capture.packetB)
    const issue = (attemptId: string) =>
      transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
    await run({
      fixture,
      capture,
      url: server.url,
      a: { ...a, token: await issue(a.attempt) },
      b: { ...b, token: await issue(b.attempt) },
    })
  } finally {
    await server.close()
    await fixture.dispose()
  }
}

const choiceStep = {
  id: 'labels',
  prompt: 'Are the package labels reliable?',
  assumption: 'Treat labels as provisional.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'verified', label: 'Contents verified' },
      { id: 'differ', label: 'Some packages differ' },
    ],
    other: true,
  },
}
const numberStep = {
  id: 'count',
  prompt: 'How many 1N4148 diodes are in the loose bag?',
  assumption: '200 (estimate).',
  answer: { kind: 'number' },
}
const textStep = {
  id: 'where',
  prompt: 'Where does it go?',
  assumption: 'Drawer R4.',
  answer: { kind: 'text' },
}

function ask(subjectId: string, steps: unknown[], extra: Record<string, unknown> = {}) {
  return {
    schema_version: 'bench-intake-question/2',
    subject_id: subjectId,
    reason: 'The bag is half full.',
    fields: ['identity', 'quantity'],
    title: 'Labels, count and place',
    steps,
    ...extra,
  }
}

async function snapshot(fixture: Fixture, batchId: string) {
  const read = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  return read.value as ProcessingSnapshotDto
}

async function question(fixture: Fixture, batchId: string, questionId: string) {
  const found = (await snapshot(fixture, batchId)).jobs
    .flatMap((job) => job.questions)
    .find((item) => item.id === questionId)
  assert.ok(found, 'question in the read')
  return found
}

async function captureRevision(fixture: Fixture, batchId: string) {
  return ((await fixture.http(`/batches/${batchId}`)).value as { revision: string }).revision
}

async function answer(
  fixture: Fixture,
  capture: Capture,
  session: Session,
  questionId: string,
  body: Record<string, unknown>,
) {
  const answered = await fixture.http(
    `/batches/${capture.batch.id}/questions/${questionId}/answers`,
    {
      expected_question_revision: '1',
      expected_capture_revision: await captureRevision(fixture, capture.batch.id),
      attempt_id: session.attempt,
      input_sha256: sealed(session.manifest).digest.toString('hex'),
      ...body,
    } satisfies Partial<ProcessingAnswerDto>,
  )
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  return answered.value as { answer_id: string }
}

async function sessionChanges(fixture: Fixture, batchId: string) {
  const rows = await fixture.db.pool.query<{ count: string }>(
    `SELECT count(*)::text FROM ui_event e JOIN ui_stream s ON s.id=e.stream_id
      WHERE s.stream_key=$1 AND e.kind='session_changed'`,
    [`capture:${batchId}`],
  )
  return Number(rows.rows[0].count)
}

async function ackLog(fixture: Fixture, lineageId: string) {
  const rows = await fixture.db.pool.query<{ from_seq: string; to_seq: string; acked_at: Date }>(
    `SELECT from_seq::text, to_seq::text, acked_at FROM agent_session_ack
      WHERE session_lineage_id=$1 ORDER BY to_seq`,
    [lineageId],
  )
  return rows.rows
}

function full(item: Question) {
  assert.ok(item.answer && 'values' in item.answer, JSON.stringify(item.answer))
  return item.answer
}

test('an answered question reads its summary and effects, waiting, then read at the advance', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const asked = await call(
      url,
      a.token,
      'ask',
      ask(capture.packetA.id, [choiceStep, numberStep, textStep]),
    )
    assert.equal(asked.ok, true, JSON.stringify(asked))
    const open = await question(fixture, capture.batch.id, asked.id!)
    assert.equal(open.answer, undefined)
    assert.equal(open.session_history, true)

    const where = `"Lade ⟨R4⟩" — 漢字\\\n${'é'.repeat(300)}`
    const receipt = await answer(fixture, capture, a, asked.id!, {
      schema_version: 'bench-intake-answer/2',
      steps: [
        { step_id: 'labels', value: { kind: 'choice', other: 'Labels are 2 years old' } },
        { step_id: 'count', value: { kind: 'number', value: '186', basis: 'counted' } },
        { step_id: 'where', value: { kind: 'text', text: where } },
      ],
    })
    const waiting = full(await question(fixture, capture.batch.id, asked.id!))
    assert.equal(waiting.answer_id, receipt.answer_id)
    assert.deepEqual(
      waiting.values.map((value) => [value.step_id, value.prompt, value.truncated]),
      [
        ['labels', choiceStep.prompt, false],
        ['count', numberStep.prompt, false],
        ['where', textStep.prompt, true],
      ],
    )
    assert.deepEqual(
      waiting.values.slice(0, 2).map((value) => value.text),
      ['Labels are 2 years old', '186 · counted'],
    )
    // Cut at 200 code points, then further so the member's escaped JSON fits its bound.
    assert.ok(where.startsWith(waiting.values[2].text))
    assert.ok([...waiting.values[2].text].length <= 200)
    assert.ok(answerMemberBytes(waiting) <= 1024)
    assert.deepEqual(waiting.effects, [
      { kind: 'quantity', lot_id: capture.packetA.id, value: '186', basis: 'counted' },
      { kind: 'note', subject_id: capture.packetA.id },
    ])
    assert.deepEqual(waiting.delivery, { state: 'waiting', read_at: null })

    const before = await sessionChanges(fixture, capture.batch.id)
    const read = await call(url, a.token, 'read_inbox', { after_seq: '0' })
    const seq = read.items!.find((item) => item.kind === 'answer')!.seq
    await call(url, a.token, 'read_inbox', { after_seq: seq })
    assert.equal(await sessionChanges(fixture, capture.batch.id), before + 1)
    // Reading again at the same cursor logs nothing and publishes nothing.
    await call(url, a.token, 'read_inbox', { after_seq: seq })
    assert.equal(await sessionChanges(fixture, capture.batch.id), before + 1)
    const log = await ackLog(fixture, a.job)
    assert.deepEqual(
      log.map((row) => [row.from_seq, row.to_seq]),
      [['0', seq]],
    )
    const done = full(await question(fixture, capture.batch.id, asked.id!))
    assert.deepEqual(done.delivery, { state: 'read', read_at: log[0].acked_at.toISOString() })
  })
})

test('a steered turn acknowledges its delivered items, logs the advance and tells open readers', async () => {
  const { runSessionTurn } = await import('#/agents/session/session-runner.ts')
  await withSessions(async ({ fixture, capture, url, a }) => {
    const asked = await call(url, a.token, 'ask', ask(capture.packetA.id, [choiceStep]))
    await answer(fixture, capture, a, asked.id!, {
      schema_version: 'bench-intake-answer/2',
      steps: [{ step_id: 'labels', value: { kind: 'choice', option_id: 'verified' } }],
    })
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='queued',turn_count=1 WHERE attempt_id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query("UPDATE processing_attempt SET state='queued' WHERE id=$1", [
      a.attempt,
    ])
    const before = await sessionChanges(fixture, capture.batch.id)
    const settled = await runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: '/tmp', env: {} },
        toolUrl: url,
        drivers: {
          'synthetic-session/1': async (turn) => {
            for (let next = await turn.nextDelivery!(); next; next = await turn.nextDelivery!()) {
              turn.onDelivered!(next.seq)
            }
          },
        },
      },
      a.attempt,
      new AbortController().signal,
    )
    assert.notEqual(settled, 'failed')
    assert.ok((await sessionChanges(fixture, capture.batch.id)) > before)
    const log = await ackLog(fixture, a.job)
    assert.equal(log.length, 1)
    const read = full(await question(fixture, capture.batch.id, asked.id!))
    assert.deepEqual(read.values[0].text, 'Contents verified')
    assert.deepEqual(read.delivery, { state: 'read', read_at: log[0].acked_at.toISOString() })
  })
})

test('an answer acknowledged before read times were kept still reads with no time later', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const asked = await call(url, a.token, 'ask', ask(capture.packetA.id, [choiceStep]))
    await answer(fixture, capture, a, asked.id!, {
      schema_version: 'bench-intake-answer/2',
      steps: [{ step_id: 'labels', value: { kind: 'choice', option_id: 'verified' } }],
    })
    // As a build before the log did: the cursor moves and nothing is logged.
    await fixture.db.pool.query(
      `INSERT INTO agent_session_cursor(session_lineage_id,acked_seq,acked_at)
       SELECT session_lineage_id,max(seq),now() FROM agent_session_inbox
        WHERE session_lineage_id=$1 GROUP BY session_lineage_id`,
      [a.job],
    )
    // The migration's own baseline statement, run over that retained cursor.
    const migration = await readFile(
      new URL('../../migrations/0037_answered_question_delivery.sql', import.meta.url),
      'utf8',
    )
    await fixture.db.pool.query(/INSERT INTO agent_session_ack[\s\S]*?;/.exec(migration)![0])
    await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: a.job,
      actorId: fixture.identity.actor,
      idempotencyKey: 'later',
      kind: 'chat',
      payload: { text: 'A later message.' },
    })
    await transaction(fixture.runner.pool, (client) =>
      acknowledgeSessionInbox(client, a.job, 1000n),
    )
    const log = await ackLog(fixture, a.job)
    assert.equal(log.length, 2)
    assert.equal(log[0].acked_at, null)
    assert.ok(log[1].acked_at)
    const read = full(await question(fixture, capture.batch.id, asked.id!))
    assert.deepEqual(read.delivery, { state: 'read', read_at: null })
  })
})

/** An earlier runner's quantity question on packet A's Reading job. */
async function runnerQuestion(fixture: Fixture, capture: Capture) {
  const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: capture.batch.revision,
    subject_ids: [capture.packetA.id],
    stages: ['reading'],
  })
  assert.equal(started.status, 202, JSON.stringify(started.value))
  const job = (await snapshot(fixture, capture.batch.id)).jobs.find(
    (item) => item.stage === 'reading',
  )!
  const retained = await fixture.db.pool.query<{ workflow_id: string; payload_bytes: Buffer }>(
    `SELECT command.workflow_id,command.payload_bytes FROM command
     JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
    [job.attempt_id],
  )
  const claimed = await claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.rows[0].workflow_id,
    strictJson(retained.rows[0].payload_bytes.toString('utf8')),
    'processing/2',
  )
  assert.ok(claimed)
  await acceptEnvelope(fixture.runner.pool, fixture.config, claimed.channelToken, {
    schema_version: 'bench-intake-runner/2',
    job_id: claimed.payload.job_id,
    attempt_id: claimed.payload.attempt_id,
    command_id: claimed.payload.command_id,
    input_sha256: claimed.payload.input_sha256,
    profile_id: 'synthetic-research/2',
    handler_version: 'processing/2',
    sequence: '1',
    kind: 'question',
    payload: {
      kind: 'quantity',
      subject_id: capture.packetA.id,
      prompt: 'How many are in Packet A?',
      reason: 'The label is torn.',
    },
  })
  return (await snapshot(fixture, capture.batch.id)).jobs.find((item) => item.id === job.id)!
}

test('an earlier runner answer has its summary, no delivery, and the job check for its history', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const job = await runnerQuestion(fixture, capture)
    const asked = job.questions[0]
    const answered = await fixture.http(
      `/batches/${capture.batch.id}/questions/${asked.id}/answers`,
      {
        schema_version: 'bench-intake-answer/1',
        expected_question_revision: asked.revision,
        expected_capture_revision: await captureRevision(fixture, capture.batch.id),
        attempt_id: job.attempt_id,
        input_sha256: job.input_sha256,
        value: { kind: 'quantity', value: '20', basis: 'counted' },
      },
    )
    assert.equal(answered.status, 200, JSON.stringify(answered.value))
    // The earlier native runner writes a session row with no state; it proves no history.
    await fixture.db.pool.query('INSERT INTO agent_session(attempt_id) VALUES($1)', [
      job.attempt_id,
    ])
    const history = await fixture.http(`/batches/${capture.batch.id}/processing/${job.id}/history`)
    assert.equal(history.status, 404)
    const runner = await question(fixture, capture.batch.id, asked.id)
    assert.equal(runner.session_history, false)
    const summary = full(runner)
    assert.deepEqual(
      summary.values.map((value) => [value.step_id, value.prompt, value.text]),
      [[null, 'How many are in Packet A?', '20 · counted']],
    )
    assert.equal(summary.delivery, undefined)
    assert.deepEqual(summary.effects, [
      { kind: 'quantity', lot_id: capture.packetA.id, value: '20', basis: 'counted' },
    ])

    // A later session attempt of the same job makes its history readable, and the flag follows.
    await nextSessionAttempt(fixture, capture, { job: job.id }, capture.packetA, 3, {
      id: 'synthetic-session/1',
    })
    const reused = await question(fixture, capture.batch.id, asked.id)
    assert.equal(reused.session_history, true)
    assert.equal(full(reused).delivery, undefined)
  } finally {
    await fixture.dispose()
  }
})

test('an ask may name the open question it replaces, and naming another is correctable', async () => {
  await withSessions(async ({ fixture, capture, url, a, b }) => {
    const first = await call(url, a.token, 'ask', ask(capture.packetA.id, [numberStep]))
    const second = await call(
      url,
      a.token,
      'ask',
      ask(capture.packetA.id, [numberStep], { replaces: first.id }),
    )
    assert.equal(second.ok, true, JSON.stringify(second))
    const replaced = await question(fixture, capture.batch.id, first.id!)
    assert.equal(replaced.state, 'superseded')
    assert.equal(replaced.replaced_by, second.id)
    assert.equal(replaced.revision, '2')
    assert.equal((await question(fixture, capture.batch.id, second.id!)).state, 'open')

    const other = await call(url, b.token, 'ask', ask(capture.packetB.id, [textStep]))
    await answer(fixture, capture, a, second.id!, {
      schema_version: 'bench-intake-answer/2',
      steps: [{ step_id: 'count', value: { kind: 'number', value: '12', basis: 'counted' } }],
    })
    const refusals = [
      ['another session', other.id],
      ['answered', second.id],
      ['already replaced', first.id],
      ['unknown', randomUUID()],
    ] as const
    for (const [label, replaces] of refusals) {
      const refused = await call(
        url,
        a.token,
        'ask',
        ask(capture.packetA.id, [numberStep], { replaces }),
      )
      assert.equal(refused.ok, false, label)
      assert.equal(refused.error, 'validation_failed', label)
      assert.deepEqual(
        refused.issues?.map((issue) => issue.path),
        ['/replaces'],
        label,
      )
    }
    const counts = await fixture.db.pool.query<{ count: string }>(
      'SELECT count(*)::text FROM processing_question WHERE job_id=$1',
      [a.job],
    )
    assert.equal(counts.rows[0].count, '2')
  })
})

test('the API role reads the log and replacements but cannot write them', async () => {
  await withSessions(async ({ fixture }) => {
    await fixture.api.pool.query('SELECT 1 FROM agent_session_ack')
    await fixture.api.pool.query('SELECT 1 FROM processing_question_replacement')
    await assert.rejects(
      fixture.api.pool.query(
        'INSERT INTO agent_session_ack(session_lineage_id,from_seq,to_seq) VALUES($1,0,1)',
        [randomUUID()],
      ),
      /permission denied/,
    )
  })
})

test('a retained batch near the size limit reads its answers in full, compact and state-only tiers', async () => {
  await withSessions(async ({ fixture, capture, a, b }) => {
    const answerText = 'ß'.repeat(400)
    const answered: string[] = []
    for (let n = 0; n < 30; n += 1) {
      const id = await legacySessionQuestion(fixture, a, {
        kind: 'clarification',
        subject_id: capture.packetA.id,
        prompt: `Retained question ${n}: ${'p'.repeat(200)}`,
        reason: 'Asked before the answer summaries existed.',
        fields: ['identity'],
        assumption: 'Continuing as before.',
      })
      await answer(fixture, capture, a, id, {
        schema_version: 'bench-intake-answer/1',
        value: { kind: 'clarification', text: `${n} ${answerText}` },
      })
      answered.push(id)
    }
    // The session reads every answer, so a compact member carries a recorded read time.
    await transaction(fixture.runner.pool, (client) =>
      acknowledgeSessionInbox(client, a.job, 1_000_000n),
    )
    const [acknowledged] = await ackLog(fixture, a.job)
    const readAt = acknowledged.acked_at.toISOString()
    // Open questions retained before the per-question allowance fill the rest of the budget.
    const filler = (length: number) =>
      legacySessionQuestion(fixture, b, {
        kind: 'clarification',
        subject_id: capture.packetB.id,
        prompt: 'f'.repeat(length),
        reason: 'r'.repeat(2000),
        fields: ['identity'],
        assumption: 'a'.repeat(2000),
      })
    const readAll = async () => {
      const result = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(result.status, 200, JSON.stringify(result.value))
      return result.value as ProcessingSnapshotDto
    }
    // The snapshot's bytes without its answer members, as the read budgets them.
    const withoutAnswers = (read: ProcessingSnapshotDto) =>
      Buffer.byteLength(JSON.stringify(read)) -
      read.jobs
        .flatMap((job) => job.questions)
        .reduce((sum, item) => sum + (item.answer ? answerMemberBytes(item.answer) : 0), 0)
    const first = await readAll()
    const members = first.jobs.flatMap((job) => job.questions).flatMap((item) => item.answer ?? [])
    assert.equal(members.length, answered.length, 'every answer fits in full before filling')
    const fullBytes = Math.max(...members.map(answerMemberBytes))
    const compactBytes = answerMemberBytes({
      answered_at: members[0].answered_at,
      values_omitted: true,
      delivery: members[0].delivery,
    })
    await filler(1)
    const overhead = withoutAnswers(await readAll()) - withoutAnswers(first) - 1
    // Room for one full answer and ten compact ones: every tier appears.
    const wanted =
      MAX_PROCESSING_SNAPSHOT_BYTES - (fullBytes + 10 * compactBytes) - withoutAnswers(first)
    let left = wanted - (overhead + 1)
    const count = Math.ceil(left / (overhead + 2000))
    for (let index = 0; index < count; index += 1) {
      const length = Math.round((left - overhead * (count - index)) / (count - index))
      await filler(length)
      left -= overhead + length
    }
    const read = { value: await readAll() }
    const room = MAX_PROCESSING_SNAPSHOT_BYTES - withoutAnswers(read.value)
    assert.ok(room > fullBytes && room < fullBytes + 20 * compactBytes, `room ${room}`)
    const snapshotRead = read.value as ProcessingSnapshotDto
    assert.ok(Buffer.byteLength(JSON.stringify(snapshotRead)) <= MAX_PROCESSING_SNAPSHOT_BYTES)
    const byId = new Map(snapshotRead.jobs.flatMap((job) => job.questions).map((q) => [q.id, q]))
    const tiers = answered
      .map((id) => byId.get(id)!)
      .sort((x, y) => (y.answer?.answered_at ?? '').localeCompare(x.answer?.answered_at ?? ''))
      .map((item) => {
        assert.equal(item.state, 'answered')
        assert.equal(item.session_history, true)
        if (!item.answer) {
          return 'state'
        }
        return 'values' in item.answer ? 'full' : 'compact'
      })
    // Newest first: full, then compact, then none, each at least once.
    const order = { full: 0, compact: 1, state: 2 }
    assert.deepEqual(
      [...tiers].sort((x, y) => order[x] - order[y]),
      tiers,
    )
    assert.ok(tiers.includes('full') && tiers.includes('compact') && tiers.includes('state'))
    const compactMembers = answered
      .map((id) => byId.get(id)!.answer)
      .filter((member) => member !== undefined && !('values' in member))
    assert.ok(compactMembers.length > 0)
    for (const member of compactMembers) {
      assert.ok(member && 'values_omitted' in member)
      assert.equal(member.values_omitted, true)
      assert.deepEqual(member.delivery, { state: 'read', read_at: readAt })
      // About 140 bytes with its read time, well within the per-question reserve.
      assert.ok(answerMemberBytes(member) <= 160, `${answerMemberBytes(member)} bytes`)
      assert.ok(answerMemberBytes(member) <= MAX_ANSWER_SUMMARY_BYTES)
    }
    for (const item of answered.map((id) => byId.get(id)!)) {
      if (item.answer && 'values' in item.answer) {
        assert.deepEqual(item.answer.delivery, { state: 'read', read_at: readAt })
      }
    }
  })
})
