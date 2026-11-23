import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type {
  CaptureEditDto,
  ProcessingAnswerV2Dto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { leadSession, legacySessionQuestion, lotSession } from '../support/sessions.ts'
import { sealed } from '#/processing/model.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { answerQuestion } from '#/processing/answers.ts'
import { lockCaptureForEdit } from '#/capture/repository.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import type { LockCapture } from '#/processing/capture.ts'
import { MAX_PROCESSING_SNAPSHOT_BYTES } from '#/processing/limits.ts'
import { openingText } from '#/agents/session/session-runner.ts'
import { ASK_GUIDANCE } from '#/agents/tools/ask-guidance.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type Session = Awaited<ReturnType<typeof lotSession>> & { token: string }

interface ToolResult {
  ok: boolean
  id?: string
  error?: string
  message?: string
  issues?: { path: string; rule: string }[]
  items?: { id: string; seq: string; kind: string; payload: Record<string, unknown> }[]
}

async function connect(url: string, token: string) {
  const client = new Client({ name: 'session-questions-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

async function call(url: string, token: string, name: string, args: Record<string, unknown>) {
  const client = await connect(url, token)
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
    issue: (attemptId: string) => Promise<string>
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
      issue,
    })
  } finally {
    await server.close()
    await fixture.dispose()
  }
}

const choiceStep = {
  id: 'same_part',
  prompt: 'Are both packets the same Part?',
  assumption: 'Treating them as the same Part.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'same', label: 'Yes, same Part' },
      { id: 'different', label: 'No, different Parts', detail: 'Each packet gets its own lot.' },
    ],
    other: false,
  },
}
const numberStep = {
  id: 'left',
  prompt: 'How many are left?',
  assumption: 'An estimated 380.',
  answer: { kind: 'number' },
}
const placeStep = {
  id: 'place',
  prompt: 'Where does it go?',
  assumption: 'Drawer R4.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'drawer_r4', label: 'Drawer R4' },
      { id: 'reel_rack', label: 'Reel rack' },
    ],
    other: true,
  },
}

function stepped(subjectId: string | null, steps: unknown[] = [choiceStep, numberStep, placeStep]) {
  return {
    schema_version: 'bench-intake-question/2',
    subject_id: subjectId,
    reason: 'The two packets look alike and the count is unclear.',
    fields: ['identity', 'quantity'],
    title: 'Same Part, how many left and where it goes',
    steps,
  }
}

async function questionCount(fixture: Fixture, jobId: string) {
  const rows = await fixture.db.pool.query<{ questions: string; messages: string }>(
    `SELECT (SELECT count(*) FROM processing_question WHERE job_id=$1) AS questions,
      (SELECT count(*) FROM processing_message m JOIN processing_attempt a ON a.id=m.attempt_id
        WHERE a.job_id=$1) AS messages`,
    [jobId],
  )
  return rows.rows[0]
}

async function snapshot(fixture: Fixture, batchId: string) {
  const read = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  return read.value as ProcessingSnapshotDto
}

async function captureRevision(fixture: Fixture, batchId: string) {
  return ((await fixture.http(`/batches/${batchId}`)).value as { revision: string }).revision
}

async function lotQuantity(fixture: Fixture, batchId: string, lotId: string) {
  const batch = (await fixture.http(`/batches/${batchId}`)).value as {
    lots: { id: string; quantity: unknown }[]
  }
  return batch.lots.find((lot) => lot.id === lotId)!.quantity
}

async function notes(fixture: Fixture, batchId: string, subjectId: string) {
  const batch = (await fixture.http(`/batches/${batchId}`)).value as {
    notes: { subject_id: string | null; text: string }[]
  }
  return batch.notes.filter((note) => note.subject_id === subjectId).map((note) => note.text)
}

async function answerRows(fixture: Fixture, jobId: string) {
  const rows = await fixture.db.pool.query<{ answers: string; inbox: string }>(
    `SELECT (SELECT count(*) FROM processing_answer WHERE job_id=$1) AS answers,
      (SELECT count(*) FROM agent_session_inbox WHERE session_lineage_id=$1 AND kind='answer') AS inbox`,
    [jobId],
  )
  return rows.rows[0]
}

/** An open stepped question on session a's lot, and what an answer to it must name. */
async function askedQuestion(
  context: { fixture: Fixture; capture: Capture; url: string; a: Session },
  steps?: unknown[],
) {
  const { fixture, capture, url, a } = context
  const asked = await call(url, a.token, 'ask', stepped(capture.packetA.id, steps))
  assert.equal(asked.ok, true, JSON.stringify(asked))
  const revision = await captureRevision(fixture, capture.batch.id)
  return {
    questionId: asked.id!,
    path: `/batches/${capture.batch.id}/questions/${asked.id}/answers`,
    base: {
      schema_version: 'bench-intake-answer/2' as const,
      expected_question_revision: '1',
      expected_capture_revision: revision,
      attempt_id: a.attempt,
      input_sha256: sealed(a.manifest).digest.toString('hex'),
    },
  }
}

const fullAnswer: ProcessingAnswerV2Dto['steps'] = [
  { step_id: 'same_part', value: { kind: 'choice', option_id: 'same' } },
  { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
  { step_id: 'place', value: { kind: 'choice', option_id: 'drawer_r4' } },
]

test('ask stores a valid stepped question, and the snapshot reads it once in its version', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const asked = await call(url, a.token, 'ask', stepped(capture.packetA.id))
    assert.equal(asked.ok, true, JSON.stringify(asked))
    const job = (await snapshot(fixture, capture.batch.id)).jobs.find((item) => item.id === a.job)!
    assert.equal(job.state, 'running')
    const question = job.questions[0]
    assert.ok('steps' in question)
    assert.equal(question.schema_version, 'bench-intake-question/2')
    assert.equal(question.subject_id, capture.packetA.id)
    assert.equal(question.title, 'Same Part, how many left and where it goes')
    assert.deepEqual(
      question.steps.map((step) => [step.id, step.answer.kind, step.assumption]),
      [
        ['same_part', 'choice', 'Treating them as the same Part.'],
        ['left', 'number', 'An estimated 380.'],
        ['place', 'choice', 'Drawer R4.'],
      ],
    )
    assert.equal('spec' in question, false)
    const message = await fixture.db.pool.query<{ envelope_bytes: Buffer }>(
      'SELECT envelope_bytes FROM processing_message WHERE attempt_id=$1',
      [a.attempt],
    )
    const envelope = strictJson(message.rows[0].envelope_bytes.toString('utf8')) as {
      kind: string
      payload: { schema_version: string }
    }
    assert.deepEqual(
      [envelope.kind, envelope.payload.schema_version],
      ['question', 'bench-intake-question/2'],
    )
  })
})

test('ask refuses duplicate IDs, misplaced number steps and oversized questions, naming the step', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const lot = capture.packetA.id
    const refusals: [string, unknown, string | RegExp, string][] = [
      [
        'duplicate step IDs',
        stepped(lot, [choiceStep, { ...placeStep, id: 'same_part' }]),
        /Step 2 \(same_part\)/,
        '/steps/1/id',
      ],
      [
        'duplicate option IDs',
        stepped(lot, [
          {
            ...placeStep,
            answer: {
              ...placeStep.answer,
              options: [placeStep.answer.options[0], { id: 'drawer_r4', label: 'Another' }],
            },
          },
        ]),
        /Step 1 \(place\).*drawer_r4/,
        '/steps/0/answer/options/1/id',
      ],
      [
        'two number steps',
        stepped(lot, [numberStep, choiceStep, { ...numberStep, id: 'more' }]),
        /Step 3 \(more\)/,
        '/steps/2/answer/kind',
      ],
      [
        'a number step without quantity in its fields',
        { ...stepped(lot, [numberStep]), fields: ['identity'] },
        /Step 1 \(left\)/,
        '/fields',
      ],
    ]
    for (const [label, ask, message, path] of refusals) {
      const result = await call(url, a.token, 'ask', ask as Record<string, unknown>)
      assert.equal(result.error, 'validation_failed', label)
      assert.match(result.message ?? '', message as RegExp, label)
      assert.ok(
        result.issues?.some((issue) => issue.path === path),
        `${label}: ${JSON.stringify(result.issues)}`,
      )
    }
    // Schema refusals name the steps or the step's options.
    const five = await call(
      url,
      a.token,
      'ask',
      stepped(
        lot,
        [1, 2, 3, 4, 5].map((n) => ({ ...placeStep, id: `s${n}` })),
      ),
    )
    assert.equal(five.error, 'validation_failed')
    assert.ok(five.issues?.some((issue) => issue.path === '/steps'))
    const oneOption = await call(
      url,
      a.token,
      'ask',
      stepped(lot, [
        { ...placeStep, answer: { ...placeStep.answer, options: [placeStep.answer.options[0]] } },
      ]),
    )
    assert.equal(oneOption.error, 'validation_failed')
    assert.ok(oneOption.issues?.some((issue) => issue.path === '/steps/0/answer/options'))
    // A blank assumption is no assumption.
    const blank = await call(url, a.token, 'ask', stepped(lot, [{ ...placeStep, assumption: ' ' }]))
    assert.equal(blank.error, 'validation_failed')
    assert.ok(blank.issues?.some((issue) => issue.path === '/steps/0/assumption'))
    // Within every field limit, but escaped control characters outgrow the stored envelope.
    const escaped = `A${'\u0001'.repeat(2047)}`
    const oversized = await call(
      url,
      a.token,
      'ask',
      stepped(
        lot,
        [1, 2, 3, 4].map((n) => ({ ...placeStep, id: `s${n}`, assumption: escaped })),
      ),
    )
    assert.equal(oversized.error, 'validation_failed')
    assert.match(oversized.message ?? '', /32768-byte limit/)
    assert.deepEqual(await questionCount(fixture, a.job), { questions: '0', messages: '0' })
  })
})

test('the lead session cannot ask for a number about the whole batch', async () => {
  const fixture = await processingFixture()
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 60_000,
  })
  try {
    const capture = await fixture.seedCapture()
    const lead = await leadSession(fixture, capture)
    const token = await transaction(fixture.runner.pool, (client) =>
      issueSessionCapability(client, lead.attempt),
    )
    const result = await call(server.url, token, 'ask', stepped(null, [choiceStep, numberStep]))
    assert.equal(result.error, 'validation_failed')
    assert.match(result.message ?? '', /Step 2 \(left\).*not about one live lot/)
    assert.ok(result.issues?.some((issue) => issue.path === '/steps/1/answer/kind'))
    assert.equal(
      (await call(server.url, token, 'ask', stepped(null, [choiceStep]))).ok,
      true,
      'a choice about the whole batch is fine',
    )
  } finally {
    await server.close()
    await fixture.dispose()
  }
})

test('a batch near the snapshot limit with /1 and /2 questions still reads, each carried once', async () => {
  await withSessions(async ({ fixture, capture, url, a, b }) => {
    for (const n of [1, 2, 3]) {
      await legacySessionQuestion(fixture, b, {
        kind: 'clarification',
        subject_id: capture.packetB.id,
        prompt: `Retained question ${n}?`,
        reason: 'Asked before stepped questions.',
        fields: ['identity'],
        assumption: 'Continuing as before.',
      })
    }
    const long = 'x'.repeat(2000)
    let accepted = 0
    for (let n = 0; n < 100; n += 1) {
      const result = await call(
        url,
        a.token,
        'ask',
        stepped(
          capture.packetA.id,
          [1, 2, 3, 4].map((step) => ({ ...placeStep, id: `s${step}`, assumption: long })),
        ),
      )
      if (!result.ok) {
        assert.equal(result.error, 'capacity_reached')
        break
      }
      accepted += 1
    }
    assert.ok(accepted > 5, `accepted ${accepted}`)
    const read = await fixture.http(`/batches/${capture.batch.id}/processing`)
    assert.equal(read.status, 200)
    assert.ok(JSON.stringify(read.value).length < MAX_PROCESSING_SNAPSHOT_BYTES)
    const questions = (read.value as ProcessingSnapshotDto).jobs.flatMap((job) => job.questions)
    assert.equal(questions.length, accepted + 3)
    for (const question of questions) {
      // One shape or the other, never both.
      assert.notEqual('spec' in question, 'steps' in question)
    }
  })
})

test('a stepped answer sets the quantity and one note in one transaction and reaches the session', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
    const noteSource = {
      kind: 'note',
      note_id: note.id,
      text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
    }
    const proposed = await call(url, a.token, 'propose', {
      proposal: {
        schema_version: 'bench-intake-proposal/5',
        subject_id: capture.packetA.id,
        summary: 'About 380 parts.',
        sources: [noteSource],
        quantity: { value: '380', status: 'estimated' },
        relies_on: { fields: ['quantity'], sources: [noteSource] },
      },
    })
    assert.equal(proposed.ok, true)
    const { path, base, questionId } = await askedQuestion({ fixture, capture, url, a })
    const answered = await fixture.http(path, { ...base, steps: fullAnswer })
    assert.equal(answered.status, 200, JSON.stringify(answered.value))
    const receipt = answered.value as { capture_revision: string; answer_id: string }
    // A quantity edit and a note edit: two capture revisions.
    assert.equal(BigInt(receipt.capture_revision), BigInt(base.expected_capture_revision) + 2n)
    assert.deepEqual(await lotQuantity(fixture, capture.batch.id, capture.packetA.id), {
      mode: 'set',
      value: '380',
    })
    assert.ok(
      (await notes(fixture, capture.batch.id, capture.packetA.id)).includes(
        'Are both packets the same Part? — Yes, same Part\nWhere does it go? — Drawer R4',
      ),
    )
    const question = (await snapshot(fixture, capture.batch.id)).jobs
      .find((job) => job.id === a.job)!
      .questions.find((item) => item.id === questionId)!
    assert.equal(question.state, 'answered')
    // The proposal that relied on the lot's quantity is stale.
    const stale = await fixture.db.pool.query<{ reason: string }>(
      'SELECT s.reason FROM processing_proposal_stale s JOIN processing_proposal p ON p.id=s.proposal_id WHERE p.attempt_id=$1',
      [a.attempt],
    )
    assert.deepEqual(
      stale.rows.map((row) => row.reason),
      ['answer_received'],
    )
    // One inbox item with each step's value, the option's ID and label and the number's basis.
    const read = await call(url, a.token, 'read_inbox', { after_seq: '0' })
    const answers = read.items!.filter((item) => item.kind === 'answer')
    assert.equal(answers.length, 1)
    assert.deepEqual(answers[0].payload, {
      question_id: questionId,
      answer_id: receipt.answer_id,
      steps: [
        {
          step_id: 'same_part',
          value: { kind: 'choice', option_id: 'same', label: 'Yes, same Part' },
        },
        { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
        {
          step_id: 'place',
          value: { kind: 'choice', option_id: 'drawer_r4', label: 'Drawer R4' },
        },
      ],
    })
  })
})

test('a refused note edit after the quantity edit rolls the whole answer back', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const { questionId, base } = await askedQuestion({ fixture, capture, url, a })
    // Inject a refusal of the second edit: the note names a subject the batch doesn't hold.
    const refusingNote: LockCapture = async (client, binding, batchId, expected) => {
      const locked = await lockCaptureForEdit(client, binding, batchId, expected)
      return {
        ...locked,
        applyInOrder: (edits: readonly CaptureEditDto[]) => {
          assert.equal(edits.length, 2)
          const [quantity, note] = edits
          assert.equal(note.change.kind, 'note')
          return locked.applyInOrder([
            quantity,
            { ...note, change: { ...note.change, subject_id: randomUUID() } } as CaptureEditDto,
          ])
        },
      }
    }
    await assert.rejects(
      answerQuestion(
        fixture.api.pool,
        fixture.config,
        refusingNote,
        capture.batch.id,
        questionId,
        randomUUID(),
        { ...base, steps: fullAnswer } satisfies ProcessingAnswerV2Dto,
      ),
      (error: { code?: string }) => error.code === 'subject_not_found',
    )
    assert.equal(await captureRevision(fixture, capture.batch.id), base.expected_capture_revision)
    assert.deepEqual(await lotQuantity(fixture, capture.batch.id, capture.packetA.id), {
      mode: 'inherit',
    })
    assert.deepEqual(await answerRows(fixture, a.job), { answers: '0', inbox: '0' })
    const question = (await snapshot(fixture, capture.batch.id)).jobs
      .find((job) => job.id === a.job)!
      .questions.find((item) => item.id === questionId)!
    assert.equal(question.state, 'open')
  })
})

test('a combined note over the limit or an inbox payload over its limit is refused before any edit', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const prompt = (n: number) => `${n} `.padEnd(500, 'p')
    const textSteps = [1, 2, 3, 4].map((n) => ({
      id: `t${n}`,
      prompt: prompt(n),
      assumption: 'None yet.',
      answer: { kind: 'text' },
    }))
    const long = await askedQuestion({ fixture, capture, url, a }, textSteps)
    const words = 'w'.repeat(2048)
    const overNote = await fixture.http(long.path, {
      ...long.base,
      steps: textSteps.map((step) => ({ step_id: step.id, value: { kind: 'text', text: words } })),
    })
    assert.equal(overNote.status, 422)
    // Three lines fit in 8192 characters; the fourth crosses the limit.
    assert.deepEqual(
      [(overNote.value as { code: string }).code, (overNote.value as { step_id?: string }).step_id],
      ['invalid_answer', 't4'],
    )

    // The note fits, but escaped text in the delivered payload doesn't, as jsonb measures it.
    const short = [1, 2, 3].map((n) => ({
      id: `e${n}`,
      prompt: `Step ${n}?`,
      assumption: 'None yet.',
      answer: { kind: 'text' },
    }))
    const escapedQuestion = await askedQuestion({ fixture, capture, url, a }, short)
    const payload = (texts: string[]) => ({
      question_id: escapedQuestion.questionId,
      answer_id: randomUUID(),
      steps: short.map((step, index) => ({
        step_id: step.id,
        value: { kind: 'text', text: texts[index] },
      })),
    })
    // Fill to just under 32,768 bytes as compact JSON; jsonb's spacing then crosses the limit.
    const escaped = (count: number) => '\u0001'.repeat(count)
    const fill = (padding: number) => [
      escaped(2048),
      escaped(2048),
      `${escaped(1250)}${'x'.repeat(padding)}`,
    ]
    const compactBytes = (texts: string[]) => Buffer.byteLength(JSON.stringify(payload(texts)))
    let padding = 0
    while (compactBytes(fill(padding + 1)) <= 32760) {
      padding += 1
    }
    const texts = fill(padding)
    assert.ok(compactBytes(texts) <= 32768, 'fits as compact JSON')
    const measured = await fixture.db.pool.query<{ bytes: number }>(
      'SELECT octet_length($1::jsonb::text)::int AS bytes',
      [JSON.stringify(payload(texts))],
    )
    assert.ok(measured.rows[0].bytes > 32768, `jsonb text is ${measured.rows[0].bytes} bytes`)
    const overPayload = await fixture.http(escapedQuestion.path, {
      ...escapedQuestion.base,
      expected_capture_revision: await captureRevision(fixture, capture.batch.id),
      steps: short.map((step, index) => ({
        step_id: step.id,
        value: { kind: 'text', text: texts[index] },
      })),
    })
    assert.equal(overPayload.status, 422, JSON.stringify(overPayload.value))
    assert.equal((overPayload.value as { code: string }).code, 'invalid_answer')
    assert.equal(
      await captureRevision(fixture, capture.batch.id),
      long.base.expected_capture_revision,
    )
    assert.deepEqual(await answerRows(fixture, a.job), { answers: '0', inbox: '0' })
  })
})

test('a wrong kind, an unknown option or a missing step is refused with nothing recorded', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const { path, base } = await askedQuestion({ fixture, capture, url, a })
    const refused: [string, unknown[], string | undefined][] = [
      [
        'a number for a choice step',
        [
          { step_id: 'same_part', value: { kind: 'number', value: '2', basis: 'counted' } },
          ...fullAnswer.slice(1),
        ],
        'same_part',
      ],
      [
        'an unknown option',
        [
          { step_id: 'same_part', value: { kind: 'choice', option_id: 'maybe' } },
          ...fullAnswer.slice(1),
        ],
        'same_part',
      ],
      [
        '"Something else" where the step does not allow it',
        [
          { step_id: 'same_part', value: { kind: 'choice', other: 'Unsure' } },
          ...fullAnswer.slice(1),
        ],
        'same_part',
      ],
      ['a missing step', fullAnswer.slice(0, 2), 'place'],
      [
        'a step the question does not have',
        [...fullAnswer, { step_id: 'extra', value: { kind: 'text', text: 'x' } }],
        undefined,
      ],
      ['a /1 answer to a /2 question', [], undefined],
    ]
    for (const [label, steps, stepId] of refused) {
      const body = steps.length
        ? { ...base, steps }
        : {
            ...base,
            schema_version: 'bench-intake-answer/1',
            value: { kind: 'clarification', text: 'Same.' },
          }
      const result = await fixture.http(path, body)
      assert.equal(result.status, 422, `${label}: ${JSON.stringify(result.value)}`)
      const error = result.value as { code: string; step_id?: string }
      assert.deepEqual([error.code, error.step_id], ['invalid_answer', stepId], label)
    }
    assert.equal(await captureRevision(fixture, capture.batch.id), base.expected_capture_revision)
    assert.deepEqual(await answerRows(fixture, a.job), { answers: '0', inbox: '0' })
  })
})

test('a number step answered in words writes a one-line note and leaves the quantity alone', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const { path, base, questionId } = await askedQuestion({ fixture, capture, url, a }, [
      numberStep,
    ])
    const answered = await fixture.http(path, {
      ...base,
      steps: [
        { step_id: 'left', value: { kind: 'text', text: 'Still sealed\r\n  in\u0085the\vreel' } },
      ],
    })
    assert.equal(answered.status, 200, JSON.stringify(answered.value))
    assert.deepEqual(await lotQuantity(fixture, capture.batch.id, capture.packetA.id), {
      mode: 'inherit',
    })
    // The note keeps one line per step; the session gets the words as written.
    assert.ok(
      (await notes(fixture, capture.batch.id, capture.packetA.id)).includes(
        'How many are left? — Still sealed in the reel',
      ),
    )
    const read = await call(url, a.token, 'read_inbox', { after_seq: '0' })
    const answer = read.items!.find((item) => item.kind === 'answer')!
    assert.deepEqual(answer.payload.steps, [
      { step_id: 'left', value: { kind: 'text', text: 'Still sealed\r\n  in\u0085the\vreel' } },
    ])
    assert.equal(answer.payload.question_id, questionId)
  })
})

test('answers replay by key and adopt or refuse by payload', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const { path, base } = await askedQuestion({ fixture, capture, url, a })
    const answer = { ...base, steps: fullAnswer }
    const changed = {
      ...base,
      steps: [
        fullAnswer[0],
        fullAnswer[1],
        { step_id: 'place', value: { kind: 'choice', option_id: 'reel_rack' } },
      ],
    }
    const key = randomUUID()
    const first = await fixture.http(path, answer, key)
    assert.equal(first.status, 200, JSON.stringify(first.value))
    assert.deepEqual(await fixture.http(path, answer, key), first)
    const otherPayloadSameKey = await fixture.http(path, changed, key)
    assert.equal(otherPayloadSameKey.status, 409)
    assert.equal((otherPayloadSameKey.value as { code: string }).code, 'payload_conflict')
    const adopted = await fixture.http(path, answer, randomUUID())
    assert.deepEqual(adopted.value, first.value)
    const conflicting = await fixture.http(path, changed, randomUUID())
    assert.equal(conflicting.status, 409)
    assert.equal((conflicting.value as { code: string }).code, 'payload_conflict')
    assert.deepEqual(await answerRows(fixture, a.job), { answers: '1', inbox: '1' })
  })
})

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
  const accepted = await acceptEnvelope(fixture.runner.pool, fixture.config, claimed.channelToken, {
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
  assert.equal(accepted, 'accepted')
  return (await snapshot(fixture, capture.batch.id)).jobs.find((item) => item.id === job.id)!
}

test('a /2 answer to an earlier runner question is refused, and its /1 answer still succeeds', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const job = await runnerQuestion(fixture, capture)
    const question = job.questions[0]
    assert.ok('spec' in question)
    assert.equal(question.assumption, undefined)
    const path = `/batches/${capture.batch.id}/questions/${question.id}/answers`
    const base = {
      expected_question_revision: question.revision,
      expected_capture_revision: await captureRevision(fixture, capture.batch.id),
      attempt_id: job.attempt_id,
      input_sha256: job.input_sha256,
    }
    const stepped = await fixture.http(path, {
      ...base,
      schema_version: 'bench-intake-answer/2',
      steps: [{ step_id: 'answer', value: { kind: 'number', value: '20', basis: 'counted' } }],
    })
    assert.equal(stepped.status, 422, JSON.stringify(stepped.value))
    assert.equal((stepped.value as { code: string }).code, 'invalid_answer')
    const single = await fixture.http(path, {
      ...base,
      schema_version: 'bench-intake-answer/1',
      value: { kind: 'quantity', value: '20', basis: 'counted' },
    })
    assert.equal(single.status, 200, JSON.stringify(single.value))
  } finally {
    await fixture.dispose()
  }
})

test('the ask schema has steps, and the tool and opening carry the one-question guidance', async () => {
  await withSessions(async ({ url, a }) => {
    const client = await connect(url, a.token)
    try {
      const tool = (await client.listTools()).tools.find((item) => item.name === 'ask')!
      assert.match(tool.description ?? '', /^Ask the operator one question\./)
      assert.match(tool.description ?? '', /split unrelated questions/)
      assert.match(tool.description ?? '', /Offer 2–6 options/)
      const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties
      assert.ok('steps' in properties && 'schema_version' in properties)
      assert.equal('prompt' in properties, false)
    } finally {
      await client.close()
    }
    // Claude and Codex sessions both open with the same instructions.
    const opening = JSON.parse(openingText(a.manifest, 0, false)) as { instructions: string }
    assert.ok(opening.instructions.includes(ASK_GUIDANCE))
  })
})

test('ask refuses unstorable text and a subject outside the session, naming the field', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const nul = await call(
      url,
      a.token,
      'ask',
      stepped(capture.packetA.id, [choiceStep, { ...numberStep, assumption: 'About\u0000380' }]),
    )
    assert.equal(nul.error, 'validation_failed')
    assert.ok(nul.issues?.some((issue) => issue.path === '/steps/1/assumption'))
    const surrogate = await call(url, a.token, 'ask', {
      ...stepped(capture.packetA.id, [choiceStep]),
      reason: 'Half a pair \ud800 here.',
    })
    assert.ok(surrogate.issues?.some((issue) => issue.path === '/reason'))
    // A number about another lot: refused at the subject, naming the number step.
    const elsewhere = await call(url, a.token, 'ask', stepped(randomUUID(), [numberStep]))
    assert.equal(elsewhere.error, 'validation_failed')
    assert.match(elsewhere.message ?? '', /Step 1 \(left\) asks for a number/)
    assert.ok(elsewhere.issues?.some((issue) => issue.path === '/subject_id'))
    assert.deepEqual(await questionCount(fixture, a.job), { questions: '0', messages: '0' })
  })
})

test('an empty answer or unstorable text is refused naming the step, with nothing recorded', async () => {
  await withSessions(async ({ fixture, capture, url, a }) => {
    const one = await askedQuestion({ fixture, capture, url, a }, [placeStep])
    const empty = await fixture.http(one.path, { ...one.base, steps: [] })
    assert.equal(empty.status, 422, JSON.stringify(empty.value))
    assert.equal((empty.value as { step_id?: string }).step_id, 'place')
    const nul = await fixture.http(one.path, {
      ...one.base,
      steps: [{ step_id: 'place', value: { kind: 'choice', other: 'Bin\u000012' } }],
    })
    assert.equal(nul.status, 422, JSON.stringify(nul.value))
    assert.equal((nul.value as { step_id?: string }).step_id, 'place')
    assert.equal(
      await captureRevision(fixture, capture.batch.id),
      one.base.expected_capture_revision,
    )
    assert.deepEqual(await answerRows(fixture, a.job), { answers: '0', inbox: '0' })
  })
})

test('Unclear quantity: the lead asks one number step, its estimate is provisional and Research goes on', async () => {
  await withSessions(async ({ fixture, capture, url, a, issue }) => {
    const lead = await leadSession(fixture, capture)
    const leadToken = await issue(lead.attempt)
    const note = a.manifest.notes.find((item) => item.subject_id === capture.packetA.id)!
    const noteSource = {
      kind: 'note',
      note_id: note.id,
      text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
    }
    const propose = (token: string, summary: string, extra: Record<string, unknown>) =>
      call(url, token, 'propose', {
        proposal: {
          schema_version: 'bench-intake-proposal/5',
          subject_id: capture.packetA.id,
          summary,
          sources: [noteSource],
          ...extra,
        },
      })
    const estimate = await propose(leadToken, 'Estimated 10 parts.', {
      quantity: { value: '10', status: 'estimated' },
      relies_on: { fields: ['quantity'], sources: [noteSource] },
    })
    assert.equal(estimate.ok, true, JSON.stringify(estimate))
    const identity = await propose(leadToken, 'Identity from the label.', {
      relies_on: { fields: ['identity'], sources: [noteSource] },
    })
    assert.equal(identity.ok, true, JSON.stringify(identity))

    const asked = await call(url, leadToken, 'ask', {
      schema_version: 'bench-intake-question/2',
      subject_id: capture.packetA.id,
      reason: 'The reel label is torn across the count.',
      fields: ['quantity'],
      steps: [
        {
          id: 'count',
          prompt: 'Does the reel hold 10 or 12 parts?',
          assumption: 'An estimated 10.',
          answer: { kind: 'number' },
        },
      ],
    })
    assert.equal(asked.ok, true, JSON.stringify(asked))

    // The estimate is provisional on the open question; the identity stays current.
    const leadJob = (await snapshot(fixture, capture.batch.id)).jobs.find(
      (job) => job.id === lead.job,
    )!
    const currentness = (summary: string) =>
      leadJob.proposals.find((proposal) => proposal.value.summary === summary)?.currentness?.state
    assert.equal(currentness('Estimated 10 parts.'), 'provisional')
    assert.equal(currentness('Identity from the label.'), 'current')
    // Research is not held by the lead's question.
    const research = await propose(a.token, 'Research goes on.', {
      relies_on: { fields: ['identity'], sources: [noteSource] },
    })
    assert.equal(research.ok, true, JSON.stringify(research))
    // The attention read's number row for this question is checked in attention.test.ts.
  })
})
