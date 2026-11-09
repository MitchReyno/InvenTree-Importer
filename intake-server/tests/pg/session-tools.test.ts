import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability, revokeSessionCapability } from '#/agents/tools/capability.ts'
import { submitSessionInbox } from '#/agents/tools/inbox.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'

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
    issues?: { path: string; rule: string; reason: string }[]
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
      const beforeInvalid = await counts(fixture, a.attempt, a.job)
      const invalid = await call(session, 'propose', {
        proposal: { ...proposal([noteSource]).proposal, quantity: { status: 'estimated' } },
      })
      assert.equal(invalid.error, 'validation_failed')
      assert.ok(
        invalid.issues?.some(
          (issue) => issue.path === '/proposal/quantity/value' && issue.rule === 'required',
        ),
      )
      assert.deepEqual(await counts(fixture, a.attempt, a.job), beforeInvalid)
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
      // Agent asks without an assumption: refused, so it cannot block silently.
      const question = {
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in the packet?',
        reason: 'The label only says approximately 20.',
      }
      assert.equal(
        (await call(session, 'ask', { ...question, fields: ['quantity'] })).error,
        'validation_failed',
      )
      assert.equal(
        (await call(session, 'ask', { ...question, assumption: 'Using 20 until counted.' })).error,
        'validation_failed',
      )
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
        binding: fixture.config,
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

test('questions keep when they were asked, and are read oldest first', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    try {
      for (const prompt of ['First: how many are in the packet?', 'Second: which reel is it?']) {
        const asked = await call(session, 'ask', {
          kind: 'quantity',
          subject_id: capture.packetA.id,
          prompt,
          reason: 'The label is torn.',
          fields: ['quantity'],
          assumption: 'Using 20 until counted.',
        })
        assert.equal(asked.ok, true)
      }
    } finally {
      await session.close()
    }
    const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(snapshot.status, 200)
    const job = (
      snapshot.value as {
        jobs: { id: string; questions: { spec: { prompt: string }; asked_at?: string }[] }[]
      }
    ).jobs.find((item) => item.id === a.job)!
    assert.deepEqual(
      job.questions.map((item) => item.spec.prompt),
      ['First: how many are in the packet?', 'Second: which reel is it?'],
    )
    const times = job.questions.map((item) => Date.parse(item.asked_at ?? ''))
    assert.ok(times.every(Number.isFinite))
    assert.ok(times[0] <= times[1])
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
    // The same answer under a fresh delivery key adopts the retained one, revision included.
    const adopted = await fixture.http(
      `/batches/${capture.batch.id}/questions/${questionId}/answers`,
      answer,
      randomUUID(),
    )
    assert.deepEqual(adopted.value, first.value)
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
  const { listAgentSessions } = await import('#/agents/session/sessions.ts')
  const { activeHeaderSessions } = await import('#/header/active-sessions.ts')
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

test('tools refuse a cancelled attempt, chat from another account, duplicate replies and undelivered citations', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const chat = await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: a.job,
      actorId: fixture.identity.actor,
      idempotencyKey: 'chat-1',
      kind: 'chat',
      payload: { text: 'Check the back label.' },
    })
    await assert.rejects(
      submitSessionInbox(fixture.api.pool, {
        binding: { ...fixture.config, targetContextId: randomUUID() },
        lineageId: a.job,
        actorId: fixture.identity.actor,
        idempotencyKey: 'chat-2',
        kind: 'chat',
        payload: { text: 'From another scope.' },
      }),
      /session_not_found/,
    )
    const session = await connect(url, a.token)
    try {
      const reply = { inbox_item_id: chat.item_id, text: 'Checking now.' }
      assert.equal((await call(session, 'reply', reply)).ok, true)
      assert.equal((await call(session, 'reply', { ...reply, text: 'A second answer' })).ok, true)
      const replies = await fixture.db.pool.query(
        "SELECT 1 FROM agent_session_outbox WHERE session_id=$1 AND kind='reply'",
        [a.attempt],
      )
      assert.equal(replies.rowCount, 1)

      const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
      const noteSource = {
        kind: 'note',
        note_id: note.id,
        text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
      }
      const base = {
        schema_version: 'bench-intake-proposal/5',
        subject_id: capture.packetA.id,
        summary: 'About 20 parts.',
        sources: [noteSource],
        relies_on: { fields: ['quantity'], sources: [noteSource] },
      }
      const undeliveredNested = {
        ...base,
        catalogue: {
          category: {
            choice: 'proposed_new',
            name: 'Resistors',
            reason: 'Seen on the label.',
            sources: [{ kind: 'note', note_id: randomUUID(), text_sha256: 'b'.repeat(64) }],
          },
          parameters: [],
          manufacturer: null,
          supplier: null,
          description: null,
        },
      }
      assert.equal(
        (await call(session, 'propose', { proposal: undeliveredNested })).error,
        'source_not_delivered',
      )
      const otherLineage = {
        ...base,
        relies_on: {
          fields: ['quantity'],
          sources: [noteSource, { kind: 'proposal', proposal_id: randomUUID() }],
        },
      }
      assert.equal(
        (await call(session, 'propose', { proposal: otherLineage })).error,
        'source_not_delivered',
      )
      assert.equal((await counts(fixture, a.attempt, a.job)).proposals, '0')

      await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
        a.attempt,
      ])
      assert.equal(
        (await call(session, 'status', { text: 'Still here' })).error,
        'capability_refused',
      )
    } finally {
      await session.close()
    }
  })
})

test('the header keeps a cancelled attempt that still holds a slot', async () => {
  const { activeHeaderSessions } = await import('#/header/active-sessions.ts')
  await withSessions(async ({ fixture, a, capture }) => {
    await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
      a.attempt,
    ])
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='cancelling' WHERE attempt_id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query(
      'INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at) VALUES($1,0,$2,now())',
      [fixture.identity.actor, a.attempt],
    )
    const header = await transaction(fixture.api.pool, (client) =>
      activeHeaderSessions(client, fixture.config, capture.batch.id),
    )
    const row = header.sessions.find((item) => item.attempt_id === a.attempt)
    assert.ok(row, 'the slot holder is listed')
    assert.equal(row.occupies_lane, true)
  })
})

test('the wake sweep gives a queued session with no live workflow a fresh one', async () => {
  const { wakePendingSessions } = await import('#/agents/session/session-execution.ts')
  await withSessions(async ({ fixture, a, b }) => {
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='queued',turn_count=1 WHERE attempt_id=ANY($1)",
      [[a.attempt, b.attempt]],
    )
    // B was cancelled before any claim: it is settled, not woken.
    await fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
      b.attempt,
    ])
    const workflows = new Map<string, string>()
    const enqueued: string[] = []
    const scheduler = {
      getWorkflow: async (id: string) =>
        workflows.has(id) ? { status: workflows.get(id) } : undefined,
      enqueue: async (options: { workflowID: string }) => {
        enqueued.push(options.workflowID)
        workflows.set(options.workflowID, 'ENQUEUED')
      },
    }
    await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
    assert.equal(enqueued.length, 1)
    assert.match(enqueued[0], new RegExp(`^resume:${a.attempt}:1:`))
    // A live workflow is left alone.
    await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
    assert.equal(enqueued.length, 1)
    const state = await fixture.db.pool.query<{ session_state: string }>(
      'SELECT session_state FROM agent_session WHERE attempt_id=$1',
      [b.attempt],
    )
    assert.equal(state.rows[0].session_state, 'cancelled')
  })
})

test('a claim needs the worker account and a live batch, and results stop at the snapshot limit', async () => {
  const { runSessionTurn } = await import('#/agents/session/session-runner.ts')
  await withSessions(async ({ fixture, url, b, capture }) => {
    const host = {
      codexExecutable: 'unused',
      claudeExecutable: 'unused',
      stateRoot: '/nonexistent',
      env: {},
    }
    const deps = (config = fixture.config) => ({
      pool: fixture.runner.pool,
      config,
      host,
      toolUrl: url,
    })
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='queued' WHERE attempt_id=$1",
      [b.attempt],
    )
    await fixture.db.pool.query("UPDATE processing_attempt SET state='queued' WHERE id=$1", [
      b.attempt,
    ])
    assert.equal(
      await runSessionTurn(
        deps({ ...fixture.config, profileId: 'shared-vm-agent/1' }),
        b.attempt,
        new AbortController().signal,
      ),
      'queued',
    )
    await assert.rejects(
      runSessionTurn(
        deps({ ...fixture.config, targetContextId: randomUUID() }),
        b.attempt,
        new AbortController().signal,
      ),
      /session_command_binding_invalid/,
    )
    const untouched = await fixture.db.pool.query<{ session_state: string; turn_count: string }>(
      'SELECT session_state,turn_count::text FROM agent_session WHERE attempt_id=$1',
      [b.attempt],
    )
    assert.deepEqual(untouched.rows[0], { session_state: 'queued', turn_count: '0' })

    const chat = await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: b.job,
      actorId: fixture.identity.actor,
      idempotencyKey: 'before-archive',
      kind: 'chat',
      payload: { text: 'Before archiving.' },
    })
    await capture.edit({ kind: 'batch', archived: true })
    assert.equal(await runSessionTurn(deps(), b.attempt, new AbortController().signal), 'queued')
    await assert.rejects(
      submitSessionInbox(fixture.api.pool, {
        binding: fixture.config,
        lineageId: b.job,
        actorId: fixture.identity.actor,
        idempotencyKey: 'after-archive',
        kind: 'chat',
        payload: { text: 'After archiving.' },
      }),
      /batch_archived/,
    )
    // A replay of an earlier submission still returns its receipt.
    assert.deepEqual(
      await submitSessionInbox(fixture.api.pool, {
        binding: fixture.config,
        lineageId: b.job,
        actorId: fixture.identity.actor,
        idempotencyKey: 'before-archive',
        kind: 'chat',
        payload: { text: 'Before archiving.' },
      }),
      chat,
    )
  })
})

test('questions stop at the snapshot limit with a typed refusal', async () => {
  await withSessions(async ({ url, a, capture }) => {
    const session = await connect(url, a.token)
    try {
      const ask = (n: number) =>
        call(session, 'ask', {
          kind: 'clarification',
          subject_id: capture.packetA.id,
          prompt: `Question ${n}?`,
          reason: 'Testing the limit.',
          fields: ['identity'],
          assumption: 'Continuing as before.',
        })
      for (let n = 0; n < 100; n += 1) {
        assert.equal((await ask(n)).ok, true)
      }
      assert.equal((await ask(100)).error, 'capacity_reached')
    } finally {
      await session.close()
    }
  })
})

test('large results stop at the batch size budget and the snapshot stays readable', async () => {
  await withSessions(async ({ fixture, url, a, capture }) => {
    const session = await connect(url, a.token)
    const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
    const source = {
      kind: 'note',
      note_id: note.id,
      text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
    }
    let refused = -1
    try {
      for (let n = 0; n < 100; n += 1) {
        const result = await call(session, 'propose', {
          proposal: {
            schema_version: 'bench-intake-proposal/5',
            subject_id: capture.packetA.id,
            summary: `${n} `.padEnd(2000, 'x'),
            sources: [source],
            relies_on: { fields: ['identity'], sources: [source] },
          },
        })
        if (!result.ok) {
          assert.equal(result.error, 'capacity_reached')
          refused = n
          break
        }
      }
    } finally {
      await session.close()
    }
    assert.ok(refused > 0 && refused < 100, `refused at ${refused}`)
    const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(snapshot.status, 200)
  })
})

test('many small questions across jobs stop before the snapshot overflows', async () => {
  await withSessions(async ({ fixture, url, a, b, capture }) => {
    let accepted = 0
    let refused = false
    for (const principal of [a, b]) {
      const session = await connect(url, principal.token)
      try {
        for (let n = 0; n < 100 && !refused; n += 1) {
          const result = await call(session, 'ask', {
            kind: 'clarification',
            subject_id: principal === a ? capture.packetA.id : capture.packetB.id,
            prompt: `Q${n}?`,
            reason: 'r',
            fields: ['identity'],
            assumption: 'a',
          })
          if (result.ok) {
            accepted += 1
          } else {
            assert.equal(result.error, 'capacity_reached')
            refused = true
          }
        }
      } finally {
        await session.close()
      }
    }
    assert.ok(accepted > 100, `accepted ${accepted}`)
    const snapshot = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(snapshot.status, 200)
    // The per-item allowance covers each projected question with room to spare.
    const jobs = (snapshot.value as { jobs: { questions: unknown[] }[] }).jobs
    for (const question of jobs.flatMap((job) => job.questions)) {
      assert.ok(JSON.stringify(question).length < 1024)
    }
  })
})

test('cancelling an idle session settles it, with or without pending chat', async () => {
  const { wakePendingSessions } = await import('#/agents/session/session-execution.ts')
  await withSessions(async ({ fixture, a, b }) => {
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='waiting_input' WHERE attempt_id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='waiting_for_login' WHERE attempt_id=$1",
      [b.attempt],
    )
    await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: b.job,
      actorId: fixture.identity.actor,
      idempotencyKey: 'login-chat',
      kind: 'chat',
      payload: { text: 'Still there?' },
    })
    await fixture.db.pool.query(
      "UPDATE processing_attempt SET state='cancelled' WHERE id=ANY($1)",
      [[a.attempt, b.attempt]],
    )
    const scheduler = { getWorkflow: async () => undefined, enqueue: async () => undefined }
    await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
    const states = await fixture.db.pool.query<{ session_state: string }>(
      'SELECT session_state FROM agent_session WHERE attempt_id=ANY($1)',
      [[a.attempt, b.attempt]],
    )
    assert.deepEqual(
      states.rows.map((row) => row.session_state),
      ['cancelled', 'cancelled'],
    )
  })
})

test('a paused batch keeps its sessions queued and their messages, and resuming lets them run', async () => {
  const { runSessionTurn } = await import('#/agents/session/session-runner.ts')
  const { wakePendingSessions } = await import('#/agents/session/session-execution.ts')
  const { setBatchPause, setAllPause } = await import('#/agents/pause.ts')
  const { listAgentSessions } = await import('#/agents/session/sessions.ts')
  await withSessions(async ({ fixture, url, a, b, capture }) => {
    const batchId = capture.batch.id
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='queued',turn_count=1 WHERE attempt_id=ANY($1)",
      [[a.attempt, b.attempt]],
    )
    await fixture.db.pool.query("UPDATE processing_attempt SET state='queued' WHERE id=ANY($1)", [
      [a.attempt, b.attempt],
    ])
    await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: a.job,
      actorId: fixture.identity.actor,
      idempotencyKey: 'while-paused',
      kind: 'chat',
      payload: { text: 'Use the datasheet values.' },
    })
    const before = await counts(fixture, a.attempt, a.job)

    assert.deepEqual(await setBatchPause(fixture.api.pool, fixture.config, batchId, true), {
      batch_id: batchId,
      paused: true,
    })
    // Pausing twice is the same pause.
    await setBatchPause(fixture.api.pool, fixture.config, batchId, true)
    const deps = {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: '/x', env: {} },
      toolUrl: url,
    }
    assert.equal(await runSessionTurn(deps, a.attempt, new AbortController().signal), 'queued')
    const enqueued: string[] = []
    const scheduler = {
      getWorkflow: async () => undefined,
      enqueue: async (options: { workflowID: string }) => {
        enqueued.push(options.workflowID)
      },
    }
    await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
    assert.deepEqual(enqueued, [])
    // Nothing is cancelled and the queued message is kept.
    const states = await fixture.db.pool.query<{ session_state: string; state: string }>(
      `SELECT s.session_state, a.state FROM agent_session s JOIN processing_attempt a ON a.id=s.attempt_id
        WHERE s.attempt_id=ANY($1) ORDER BY s.attempt_id`,
      [[a.attempt, b.attempt]],
    )
    assert.deepEqual(
      states.rows.map((row) => [row.session_state, row.state]),
      [
        ['queued', 'queued'],
        ['queued', 'queued'],
      ],
    )
    assert.deepEqual(await counts(fixture, a.attempt, a.job), before)
    const listed = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.ok(
      listed.sessions.filter((item) => item.batch_id === batchId).every((item) => item.paused),
    )
    assert.deepEqual(listed.paused_batch_ids, [batchId])

    assert.deepEqual(await setBatchPause(fixture.api.pool, fixture.config, batchId, false), {
      batch_id: batchId,
      paused: false,
    })
    await wakePendingSessions(fixture.runner.pool, fixture.config, scheduler as never)
    assert.equal(enqueued.length, 2)
    const resumed = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.ok(resumed.sessions.every((item) => !item.paused))
    assert.deepEqual(resumed.paused_batch_ids, [])

    // Pause all reaches every live batch of the account, and Resume all clears them.
    const other = await fixture.seedCapture()
    const all = await setAllPause(fixture.api.pool, fixture.config, true)
    assert.deepEqual(all.batch_ids.sort(), [batchId, other.batch.id].sort())
    assert.equal(all.paused, true)
    assert.deepEqual(
      (await listAgentSessions(fixture.api.pool, fixture.config)).paused_batch_ids?.sort(),
      [batchId, other.batch.id].sort(),
    )
    await setAllPause(fixture.api.pool, fixture.config, false)
    assert.deepEqual(
      (await listAgentSessions(fixture.api.pool, fixture.config)).paused_batch_ids,
      [],
    )

    // Another account's batch is not found.
    await assert.rejects(
      setBatchPause(fixture.api.pool, { ...fixture.config, actorId: randomUUID() }, batchId, true),
      (error: { code?: string }) => error.code === 'not_found',
    )
  })
})

test('a saved batch instruction reaches the running session and wakes the finished one, once', async () => {
  const { wakePendingSessions } = await import('#/agents/session/session-execution.ts')
  const { deliverInstructions } = await import('#/agents/instructions.ts')
  await withSessions(async ({ fixture, a, b, capture }) => {
    const batchId = capture.batch.id
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='running' WHERE attempt_id=$1",
      [a.attempt],
    )
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='finished',turn_count=1 WHERE attempt_id=$1",
      [b.attempt],
    )
    const instruction = randomUUID()
    await fixture.db.pool.query(
      `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
       VALUES($1,$2,NULL,(SELECT revision FROM capture_batch WHERE id=$2),$3,$4)`,
      [instruction, batchId, 'Keep the two resistor packets apart.', fixture.identity.actor],
    )
    const delivered = await deliverInstructions(fixture.api.pool, fixture.config, batchId)
    assert.deepEqual(delivered, { sessions: 2, woken: 1 })
    const items = await fixture.db.pool.query<{ session_lineage_id: string; payload: unknown }>(
      "SELECT session_lineage_id,payload FROM agent_session_inbox WHERE kind='instruction' ORDER BY session_lineage_id",
    )
    assert.deepEqual(
      items.rows.map((row) => row.payload),
      [
        {
          instruction_id: instruction,
          text: 'Keep the two resistor packets apart.',
          group_id: null,
        },
        {
          instruction_id: instruction,
          text: 'Keep the two resistor packets apart.',
          group_id: null,
        },
      ],
    )
    // Delivering again sends nothing new.
    assert.deepEqual(await deliverInstructions(fixture.api.pool, fixture.config, batchId), {
      sessions: 2,
      woken: 1,
    })
    assert.equal(
      (await fixture.db.pool.query("SELECT 1 FROM agent_session_inbox WHERE kind='instruction'"))
        .rowCount,
      2,
    )
    // The finished session is woken to apply it; the running one reads it as it works.
    const enqueued: string[] = []
    await wakePendingSessions(fixture.runner.pool, fixture.config, {
      getWorkflow: async () => undefined,
      enqueue: async (options: { workflowID: string }) => {
        enqueued.push(options.workflowID)
      },
    } as never)
    const states = await fixture.db.pool.query<{ attempt_id: string; session_state: string }>(
      'SELECT attempt_id,session_state FROM agent_session WHERE attempt_id=ANY($1)',
      [[a.attempt, b.attempt]],
    )
    assert.equal(states.rows.find((row) => row.attempt_id === a.attempt)?.session_state, 'running')
    assert.equal(states.rows.find((row) => row.attempt_id === b.attempt)?.session_state, 'queued')
    assert.ok(enqueued.some((workflow) => workflow.includes(b.attempt)))

    await assert.rejects(
      deliverInstructions(fixture.api.pool, { ...fixture.config, actorId: randomUUID() }, batchId),
      (error: { code?: string }) => error.code === 'not_found',
    )
  })
})

test('the longest instruction, in four-byte characters, still reaches a session', async () => {
  const { deliverInstructions } = await import('#/agents/instructions.ts')
  await withSessions(async ({ fixture, capture }) => {
    const text = '🔧'.repeat(8192)
    await fixture.db.pool.query(
      `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
       VALUES(gen_random_uuid(),$1,NULL,(SELECT revision FROM capture_batch WHERE id=$1),$2,$3)`,
      [capture.batch.id, text, fixture.identity.actor],
    )
    assert.deepEqual(
      await deliverInstructions(fixture.api.pool, fixture.config, capture.batch.id),
      { sessions: 2, woken: 0 },
    )
    const stored = await fixture.db.pool.query<{ text: string }>(
      "SELECT payload->>'text' AS text FROM agent_session_inbox WHERE kind='instruction'",
    )
    assert.ok(stored.rows.length === 2 && stored.rows.every((row) => row.text === text))
  })
})

test('Pause all refuses rather than pausing only some batches, and an archived batch is not listed', async () => {
  const { setAllPause, setBatchPause } = await import('#/agents/pause.ts')
  const { listAgentSessions } = await import('#/agents/session/sessions.ts')
  await withSessions(async ({ fixture }) => {
    const other = await fixture.seedCapture()
    await assert.rejects(setAllPause(fixture.api.pool, fixture.config, true, 1), {
      code: 'pause_scope_too_large',
    })
    assert.deepEqual(
      (await listAgentSessions(fixture.api.pool, fixture.config)).paused_batch_ids,
      [],
    )
    await setBatchPause(fixture.api.pool, fixture.config, other.batch.id, true)
    await other.edit({ kind: 'batch', archived: true })
    assert.deepEqual(
      (await listAgentSessions(fixture.api.pool, fixture.config)).paused_batch_ids,
      [],
    )
  })
})

test('an instruction saved while delivery failed reaches the sessions on the next supervisor pass', async () => {
  const { deliverMissingInstructions } = await import('#/agents/instructions.ts')
  await withSessions(async ({ fixture, capture }) => {
    await fixture.db.pool.query(
      `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
       VALUES(gen_random_uuid(),$1,NULL,(SELECT revision FROM capture_batch WHERE id=$1),$2,$3)`,
      [capture.batch.id, 'Keep the two resistor packets apart.', fixture.identity.actor],
    )
    assert.equal(await deliverMissingInstructions(fixture.runner.pool, fixture.config), 2)
    const items = await fixture.db.pool.query(
      "SELECT 1 FROM agent_session_inbox WHERE kind='instruction'",
    )
    assert.equal(items.rowCount, 2)
    assert.equal(await deliverMissingInstructions(fixture.runner.pool, fixture.config), 0)
  })
})

test("a batch's own processing read says it is paused", async () => {
  const { setBatchPause } = await import('#/agents/pause.ts')
  await withSessions(async ({ fixture, capture }) => {
    const read = async () =>
      ((await fixture.http(`/batches/${capture.batch.id}/processing`)).value as { paused?: true })
        .paused
    assert.equal(await read(), undefined)
    await setBatchPause(fixture.api.pool, fixture.config, capture.batch.id, true)
    assert.equal(await read(), true)
    await setBatchPause(fixture.api.pool, fixture.config, capture.batch.id, false)
    assert.equal(await read(), undefined)
  })
})

test('a relay pass waits for a save in progress and sends the newer instruction, not the one it replaced', async () => {
  const { deliverMissingInstructions } = await import('#/agents/instructions.ts')
  await withSessions(async ({ fixture, capture }) => {
    const insert = (client: { query: typeof fixture.db.pool.query }, text: string, ahead: number) =>
      client.query(
        `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
         VALUES(gen_random_uuid(),$1,NULL,(SELECT revision FROM capture_batch WHERE id=$1)+$4,$2,$3)`,
        [capture.batch.id, text, fixture.identity.actor, ahead],
      )
    await insert(fixture.db.pool, 'Older instruction.', 0)
    // An operator save holds the batch while it writes the newer version.
    const save = await fixture.db.pool.connect()
    try {
      await save.query('BEGIN')
      await save.query('SELECT 1 FROM capture_batch WHERE id=$1 FOR UPDATE', [capture.batch.id])
      await insert(save, 'Newer instruction.', 1)
      let settled = false
      const pass = deliverMissingInstructions(fixture.runner.pool, fixture.config).finally(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(settled, false)
      await save.query('COMMIT')
      await pass
    } finally {
      save.release()
    }
    const texts = await fixture.db.pool.query<{ text: string }>(
      "SELECT DISTINCT payload->>'text' AS text FROM agent_session_inbox WHERE kind='instruction'",
    )
    assert.deepEqual(
      texts.rows.map((row) => row.text),
      ['Newer instruction.'],
    )
  })
})
