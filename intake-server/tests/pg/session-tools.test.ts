import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { sealed } from '../../src/processing/model.ts'
import { transaction } from '../../src/db/database.ts'
import {
  issueSessionCapability,
  revokeSessionCapability,
} from '../../src/agents/tools/capability.ts'
import { submitSessionInbox } from '../../src/agents/tools/inbox.ts'
import { startSessionToolServer } from '../../src/agents/tools/server.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>

async function connect(url: string, token: string) {
  const client = new Client({ name: 'session-tools-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  return result.structuredContent as {
    ok: boolean
    error?: string
    pending_inbox: number
    items?: { id: string; seq: string; kind: string }[]
  }
}

async function counts(fixture: Fixture, attemptId: string, jobId: string) {
  const row = await fixture.db.pool.query<{
    outbox: string
    inbox: string
    cursor: string
    proposals: string
  }>(
    `SELECT (SELECT count(*) FROM agent_session_outbox WHERE session_id=$1) AS outbox,
      (SELECT count(*) FROM agent_session_inbox WHERE session_lineage_id=$2) AS inbox,
      (SELECT count(*) FROM agent_session_cursor WHERE session_lineage_id=$2) AS cursor,
      (SELECT count(*) FROM processing_proposal WHERE attempt_id=$1) AS proposals`,
    [attemptId, jobId],
  )
  return row.rows[0]
}

async function withSessions(
  run: (context: {
    fixture: Fixture
    capture: Capture
    url: string
    a: Awaited<ReturnType<typeof lotSession>> & { token: string }
    b: Awaited<ReturnType<typeof lotSession>> & { token: string }
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

test('only a live capability reaches the tools, and only for its own session', async () => {
  await withSessions(async ({ fixture, url, a, b }) => {
    const stored = await fixture.db.pool.query<{ capability_sha256: Buffer }>(
      'SELECT capability_sha256 FROM agent_session WHERE attempt_id=$1',
      [a.attempt],
    )
    assert.deepEqual(
      stored.rows[0].capability_sha256,
      createHash('sha256').update(a.token).digest(),
    )
    const before = await counts(fixture, a.attempt, a.job)
    await assert.rejects(connect(url, randomBytes(32).toString('base64url')))
    const plain = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    assert.equal(plain.status, 401)

    const sessionB = await connect(url, b.token)
    assert.equal((await call(sessionB, 'status', { text: 'Reading packet B' })).ok, true)
    await sessionB.close()
    await transaction(fixture.runner.pool, (client) => revokeSessionCapability(client, b.attempt))
    await assert.rejects(connect(url, b.token))
    assert.deepEqual(await counts(fixture, a.attempt, a.job), before)
    const outboxB = await fixture.db.pool.query(
      'SELECT session_id FROM agent_session_outbox WHERE session_id=$1',
      [b.attempt],
    )
    assert.equal(outboxB.rowCount, 1)

    const sessionA = await connect(url, a.token)
    const tools = (await sessionA.listTools()).tools.map((tool) => tool.name).sort()
    assert.deepEqual(tools, ['ask', 'fetch_evidence', 'propose', 'read_inbox', 'reply', 'status'])
    await sessionA.close()
  })
})

test('invalid outbox items return typed errors and publish nothing', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    try {
      assert.equal(
        (await call(session, 'status', { text: 'x'.repeat(121) })).error,
        'validation_failed',
      )
      assert.equal((await call(session, 'status', { text: 'Reading the label' })).ok, true)
      assert.equal(
        (await call(session, 'status', { text: 'Reading it again' })).error,
        'status_rate_limited',
      )
      const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
      const noteSource = {
        kind: 'note',
        note_id: note.id,
        text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
      }
      const proposal = (sources: unknown[]) => ({
        proposal: {
          schema_version: 'bench-intake-proposal/5',
          subject_id: capture.packetA.id,
          summary: 'About 20 parts according to the label.',
          sources,
          quantity: { value: '20', status: 'estimated' },
          relies_on: { fields: ['quantity'], sources },
        },
      })
      const undelivered = {
        kind: 'media_version',
        evidence_id: randomUUID(),
        version_id: randomUUID(),
        sha256: 'a'.repeat(64),
      }
      assert.equal(
        (await call(session, 'propose', proposal([undelivered]))).error,
        'source_not_delivered',
      )
      assert.equal(
        (
          await call(session, 'propose', {
            proposal: { ...proposal([noteSource]).proposal, subject_id: capture.packetB.id },
          })
        ).error,
        'validation_failed',
      )
      assert.equal((await counts(fixture, a.attempt, a.job)).proposals, '0')
      assert.equal((await call(session, 'propose', proposal([noteSource]))).ok, true)
      const asked = await call(session, 'ask', {
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in the packet?',
        reason: 'The label only says approximately 20.',
        fields: ['quantity'],
        assumption: 'Using 20 until counted.',
      })
      assert.equal(asked.ok, true)
      const outbox = await fixture.db.pool.query<{ seq: string; kind: string }>(
        'SELECT seq,kind FROM agent_session_outbox WHERE session_id=$1 ORDER BY seq',
        [a.attempt],
      )
      assert.deepEqual(
        outbox.rows.map((row) => [row.seq, row.kind]),
        [
          ['1', 'status'],
          ['2', 'proposal'],
          ['3', 'question'],
        ],
      )
      const attempt = await fixture.db.pool.query<{ state: string }>(
        'SELECT state FROM processing_attempt WHERE id=$1',
        [a.attempt],
      )
      assert.equal(attempt.rows[0].state, 'running')
      const reliance = await fixture.db.pool.query<{ relies_on: { fields: string[] } }>(
        'SELECT relies_on FROM processing_proposal WHERE attempt_id=$1',
        [a.attempt],
      )
      assert.deepEqual(reliance.rows[0].relies_on.fields, ['quantity'])
    } finally {
      await session.close()
    }
  })
})

test('inbox items are idempotent and redelivered until acknowledged', async () => {
  await withSessions(async ({ fixture, url, a }) => {
    const submit = (key: string, text: string) =>
      submitSessionInbox(fixture.api.pool, {
        lineageId: a.job,
        actorId: fixture.identity.actor,
        idempotencyKey: key,
        kind: 'chat',
        payload: { text },
      })
    const first = await submit('chat-1', 'Check the back label.')
    assert.deepEqual(await submit('chat-1', 'Check the back label.'), first)
    await assert.rejects(submit('chat-1', 'Something else'), /idempotency_conflict/)
    const second = await submit('chat-2', 'It is a 1k resistor.')
    assert.equal((await counts(fixture, a.attempt, a.job)).inbox, '2')

    const session = await connect(url, a.token)
    try {
      const status = await call(session, 'status', { text: 'Working' })
      assert.equal(status.pending_inbox, 2)
      const read = await call(session, 'read_inbox', { after_seq: '0' })
      assert.deepEqual(
        read.items?.map((item) => item.id),
        [first.item_id, second.item_id],
      )
      // A crash before acknowledgement: the next read redelivers the same items.
      const again = await call(session, 'read_inbox', { after_seq: '0' })
      assert.deepEqual(
        again.items?.map((item) => item.id),
        [first.item_id, second.item_id],
      )
      const acked = await call(session, 'read_inbox', { after_seq: second.seq })
      assert.deepEqual(acked.items, [])
      assert.equal(acked.pending_inbox, 0)
      const stale = await call(session, 'read_inbox', { after_seq: first.seq })
      assert.deepEqual(stale.items, [])
      const replied = await call(session, 'reply', {
        inbox_item_id: second.item_id,
        text: 'Thanks, updating the identity.',
      })
      assert.equal(replied.ok, true)
      assert.equal(
        (await call(session, 'reply', { inbox_item_id: randomUUID(), text: 'Hello' })).error,
        'inbox_item_unknown',
      )
    } finally {
      await session.close()
    }
    const cursor = await fixture.db.pool.query<{ acked_seq: string }>(
      'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
      [a.job],
    )
    assert.equal(cursor.rows[0].acked_seq, '2')
  })
})

test('session proposals and questions stay readable in Processing and the session list', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
    const noteSource = {
      kind: 'note',
      note_id: note.id,
      text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
    }
    try {
      assert.equal(
        (
          await call(session, 'propose', {
            proposal: {
              schema_version: 'bench-intake-proposal/5',
              subject_id: capture.packetA.id,
              summary: 'About 20 parts according to the label.',
              sources: [noteSource],
              relies_on: { fields: ['quantity'], sources: [noteSource] },
            },
          })
        ).ok,
        true,
      )
      assert.equal(
        (
          await call(session, 'ask', {
            kind: 'quantity',
            subject_id: capture.packetA.id,
            prompt: 'How many are in the packet?',
            reason: 'The label only says approximately 20.',
            fields: ['quantity'],
            assumption: 'Using 20 until counted.',
          })
        ).ok,
        true,
      )
    } finally {
      await session.close()
    }
    const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(snapshot.status, 200)
    const job = (
      snapshot.value as {
        jobs: {
          id: string
          proposals: { value: { schema_version: string } }[]
          questions: {
            spec: { prompt: string }
            assumption?: string
            fields?: string[]
            state: string
          }[]
          qualification: string
          state: string
        }[]
      }
    ).jobs.find((item) => item.id === a.job)!
    assert.equal(job.qualification, 'fixture_only')
    assert.equal(job.state, 'running')
    assert.deepEqual(
      job.proposals.map((item) => item.value.schema_version),
      ['bench-intake-proposal/5'],
    )
    assert.equal(job.questions[0].spec.prompt, 'How many are in the packet?')
    assert.equal(job.questions[0].assumption, 'Using 20 until counted.')
    assert.deepEqual(job.questions[0].fields, ['quantity'])
    assert.equal(job.questions[0].state, 'open')

    const sessions = await fixture.http('/agent-sessions')
    assert.equal(sessions.status, 200)
    const listed = (
      sessions.value as { sessions: { attempt_id: string; selection: unknown; stage: string }[] }
    ).sessions
    const row = listed.find((item) => item.attempt_id === a.attempt)!
    assert.equal(row.selection, null)
    assert.equal(row.stage, 'research')
  })
})

test('answers and chat reach the running session once, through the inbox', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    let questionId: string
    try {
      const asked = (await call(session, 'ask', {
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in the packet?',
        reason: 'The label only says approximately 20.',
        fields: ['quantity'],
        assumption: 'Using 20 until counted.',
      })) as { ok: boolean; id?: string }
      questionId = asked.id!
    } finally {
      await session.close()
    }
    const batch = await fixture.http(`/batches/${capture.batch.id}`)
    const answer = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: '1',
      expected_capture_revision: (batch.value as { revision: string }).revision,
      attempt_id: a.attempt,
      input_sha256: sealed(a.manifest).digest.toString('hex'),
      value: { kind: 'quantity', value: '19', basis: 'counted' },
    }
    const key = randomUUID()
    const first = await fixture.http(
      `/batches/${capture.batch.id}/questions/${questionId}/answers`,
      answer,
      key,
    )
    assert.equal(first.status, 200, JSON.stringify(first.value))
    const again = await fixture.http(
      `/batches/${capture.batch.id}/questions/${questionId}/answers`,
      answer,
      key,
    )
    assert.deepEqual(again.value, first.value)
    assert.equal((first.value as { attempt_id: string }).attempt_id, a.attempt)
    const inbox = await fixture.db.pool.query<{ kind: string; payload: { answer_id: string } }>(
      'SELECT kind,payload FROM agent_session_inbox WHERE session_lineage_id=$1',
      [a.job],
    )
    assert.deepEqual(
      inbox.rows.map((row) => [row.kind, row.payload.answer_id]),
      [['answer', (first.value as { answer_id: string }).answer_id]],
    )
    const states = await fixture.db.pool.query<{ question: string; attempt: string }>(
      `SELECT (SELECT state FROM processing_question WHERE id=$1) AS question,
        (SELECT state FROM processing_attempt WHERE id=$2) AS attempt`,
      [questionId, a.attempt],
    )
    assert.deepEqual(states.rows[0], { question: 'answered', attempt: 'running' })
    const lot = (
      (await fixture.http(`/batches/${capture.batch.id}`)).value as {
        lots: { id: string; quantity: unknown }[]
      }
    ).lots.find((item) => item.id === capture.packetA.id)!
    assert.deepEqual(lot.quantity, { mode: 'set', value: '19' })

    const chat = { idempotency_key: randomUUID(), text: 'Check the back label too.' }
    const sent = await fixture.http(`/batches/${capture.batch.id}/processing/${a.job}/inbox`, chat)
    assert.equal(sent.status, 200, JSON.stringify(sent.value))
    const resent = await fixture.http(
      `/batches/${capture.batch.id}/processing/${a.job}/inbox`,
      chat,
    )
    assert.deepEqual(resent.value, sent.value)
    const otherBatch = await fixture.http('/batches', { title: 'Other', note: 'Other batch.' })
    const wrong = await fixture.http(
      `/batches/${(otherBatch.value as { id: string }).id}/processing/${a.job}/inbox`,
      chat,
    )
    assert.equal(wrong.status, 404)
    const count = await fixture.db.pool.query<{ count: string }>(
      'SELECT count(*) FROM agent_session_inbox WHERE session_lineage_id=$1',
      [a.job],
    )
    assert.equal(count.rows[0].count, '2')
  })
})

test('the timeline, session list and header show the latest status line and the waiting state', async () => {
  const { listAgentSessions } = await import('../../src/agents/sessions.ts')
  const { activeHeaderSessions } = await import('../../src/header/active-sessions.ts')
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    try {
      assert.equal((await call(session, 'status', { text: 'Reading the label' })).ok, true)
      assert.equal(
        (
          await call(session, 'ask', {
            kind: 'quantity',
            subject_id: capture.packetA.id,
            prompt: 'How many are in the packet?',
            reason: 'The label only says approximately 20.',
            fields: ['quantity'],
            assumption: 'Using 20 until counted.',
          })
        ).ok,
        true,
      )
    } finally {
      await session.close()
    }
    // Settle as the runner does when a turn ends with an open question.
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='waiting_input',capability_sha256=NULL WHERE attempt_id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query(
      "UPDATE processing_attempt SET state='waiting_for_user' WHERE id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query("UPDATE processing_job SET state='waiting_for_user' WHERE id=$1", [
      a.job,
    ])

    const timeline = await fixture.http(`/batches/${capture.batch.id}/processing/${a.job}/session`)
    assert.equal(timeline.status, 200, JSON.stringify(timeline.value))
    const value = timeline.value as {
      session_state: string
      outbox: { kind: string; payload: { text?: string } }[]
    }
    assert.equal(value.session_state, 'waiting_input')
    assert.deepEqual(
      value.outbox.map((item) => item.kind),
      ['status', 'question'],
    )
    const missing = await fixture.http(
      `/batches/${capture.batch.id}/processing/${randomUUID()}/session`,
    )
    assert.equal(missing.status, 404)

    const listed = (await listAgentSessions(fixture.api.pool, fixture.config)).sessions.find(
      (row) => row.attempt_id === a.attempt,
    )!
    assert.equal(listed.session_state, 'waiting_input')
    assert.equal(listed.latest_status?.text, 'Reading the label')

    const header = await transaction(fixture.api.pool, (client) =>
      activeHeaderSessions(client, fixture.config, capture.batch.id),
    )
    const row = header.sessions.find((item) => item.attempt_id === a.attempt)
    assert.ok(row, 'a waiting session is listed in the header')
    assert.equal(row.session_state, 'waiting_input')
    assert.equal(row.occupies_lane, false)
    assert.equal(row.latest_status?.text, 'Reading the label')
  })
})
