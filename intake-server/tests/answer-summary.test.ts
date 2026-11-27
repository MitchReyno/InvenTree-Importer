import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ANSWER_SUMMARY_BYTES,
  questionView,
  type ProcessingQuestionDto,
} from '@invimport/contracts'
import {
  answerMemberBytes,
  answeredValues,
  budgetAnswers,
  compactAnswerSummary,
  fullAnswerSummary,
  type BudgetedAnswer,
} from '#/processing/answer-summary.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const base = {
  id: id(1),
  job_id: id(2),
  attempt_id: id(3),
  input_sha256: 'a'.repeat(64),
  revision: '2',
  state: 'answered' as const,
  subject_id: id(4),
}
const stepped = {
  ...base,
  schema_version: 'bench-intake-question/2' as const,
  fields: ['identity' as const, 'quantity' as const],
  reason: 'Two packets.',
  steps: [
    {
      id: 'same',
      prompt: 'Same Part?',
      assumption: 'Same.',
      answer: {
        kind: 'choice' as const,
        options: [
          { id: 'yes', label: 'Yes, same Part' },
          { id: 'no', label: 'No' },
        ],
        other: true,
      },
    },
    { id: 'left', prompt: 'How many?', assumption: '380.', answer: { kind: 'number' as const } },
    { id: 'where', prompt: 'Where?', assumption: 'R4.', answer: { kind: 'text' as const } },
  ],
} satisfies ProcessingQuestionDto
const answerBase = {
  expected_question_revision: '1',
  expected_capture_revision: '3',
  attempt_id: id(3),
  input_sha256: 'a'.repeat(64),
}

test('each step reads as the Answered line shows it: a label, "Something else", a number, text', () => {
  const values = answeredValues(questionView(stepped), {
    ...answerBase,
    schema_version: 'bench-intake-answer/2',
    steps: [
      { step_id: 'same', value: { kind: 'choice', option_id: 'yes' } },
      { step_id: 'left', value: { kind: 'number', value: '186', basis: 'counted' } },
      { step_id: 'where', value: { kind: 'text', text: 'Drawer R4' } },
    ],
  })
  const summary = fullAnswerSummary({
    answerId: id(9),
    answeredAt: '2026-11-24T02:08:00.000Z',
    values,
    effects: [],
  })!
  assert.ok('values' in summary)
  assert.deepEqual(
    summary.values.map((value) => [value.step_id, value.prompt, value.text, value.truncated]),
    [
      ['same', 'Same Part?', 'Yes, same Part', false],
      ['left', 'How many?', '186 · counted', false],
      ['where', 'Where?', 'Drawer R4', false],
    ],
  )
  const other = answeredValues(questionView(stepped), {
    ...answerBase,
    schema_version: 'bench-intake-answer/2',
    steps: [{ step_id: 'same', value: { kind: 'choice', other: 'A close variant' } }],
  })
  assert.equal(other[0].value.kind, 'choice')
  const runner = answeredValues(
    questionView({
      ...base,
      subject_id: id(4),
      spec: { kind: 'quantity', prompt: 'How many in Packet A?', reason: 'Torn.' },
    }),
    {
      ...answerBase,
      schema_version: 'bench-intake-answer/1',
      value: { kind: 'quantity', value: '20', basis: 'estimated' },
    },
  )
  assert.deepEqual(
    runner.map((value) => [value.stepId, value.prompt]),
    [[null, 'How many in Packet A?']],
  )
})

test('a summary is cut to 200 code points, then further until its JSON fits 1 KiB', () => {
  const long = '漢'.repeat(500)
  const escaped = '"\\\u0001'.repeat(300)
  const values = [long, escaped, long, escaped].map((text, index) => ({
    stepId: `s${index}`,
    prompt: long,
    value: { kind: 'text' as const, text },
  }))
  const summary = fullAnswerSummary({
    answerId: id(9),
    answeredAt: '2026-11-24T02:08:00.000Z',
    values,
    effects: [{ kind: 'note', subject_id: id(4) }],
    delivery: { state: 'read', read_at: '2026-11-24T02:09:00.000Z' },
  })!
  assert.ok(answerMemberBytes(summary) <= MAX_ANSWER_SUMMARY_BYTES)
  assert.ok('values' in summary)
  assert.ok(summary.values.every((value) => value.truncated))
  assert.ok(summary.values.every((value) => [...value.text].length <= 200))

  const short = fullAnswerSummary({
    answerId: id(9),
    answeredAt: '2026-11-24T02:08:00.000Z',
    values: [{ stepId: null, prompt: 'Which?', value: { kind: 'text', text: 'x'.repeat(201) } }],
    effects: [],
  })!
  assert.ok('values' in short)
  assert.deepEqual([[...short.values[0].text].length, short.values[0].truncated], [200, true])
})

test('a compact answer with a read time stays small, and tiers run newest first', () => {
  const input = {
    answerId: id(9),
    answeredAt: '2026-11-24T02:08:00.000Z',
    values: [{ stepId: null, prompt: 'Which?', value: { kind: 'text' as const, text: 'One' } }],
    effects: [],
    delivery: { state: 'read' as const, read_at: '2026-11-24T02:09:00.000Z' },
  }
  const compact = compactAnswerSummary(input)
  assert.ok(answerMemberBytes(compact) <= 160, `${answerMemberBytes(compact)} bytes`)

  const answers: BudgetedAnswer[] = [1, 2, 3].map((minute) => {
    const at = `2026-11-24T02:0${minute}:00.000Z`
    return {
      question: {},
      full: fullAnswerSummary({ ...input, answeredAt: at }),
      compact: compactAnswerSummary({ ...input, answeredAt: at }),
      answeredAt: at,
    }
  })
  const fullBytes = answerMemberBytes(answers[2].full!)
  const compactBytes = answerMemberBytes(answers[1].compact)
  budgetAnswers(answers, fullBytes + compactBytes)
  assert.equal(answers[2].question.answer, answers[2].full)
  assert.equal(answers[1].question.answer, answers[1].compact)
  assert.equal(answers[0].question.answer, undefined)
})

test("tiers only step down newest first, whatever each answer's size", () => {
  const at = (minute: number) => `2026-11-24T02:${minute.toString().padStart(2, '0')}:00.000Z`
  const sized = (minute: number, text: string, delivery?: { state: 'read'; read_at: string }) => {
    const input = {
      answerId: id(minute),
      answeredAt: at(minute),
      values: [{ stepId: null, prompt: 'Which?', value: { kind: 'text' as const, text } }],
      effects: [],
      ...(delivery ? { delivery } : {}),
    }
    const answer: BudgetedAnswer = {
      question: {},
      full: fullAnswerSummary(input),
      compact: compactAnswerSummary(input),
      answeredAt: input.answeredAt,
    }
    return answer
  }
  const read = { state: 'read' as const, read_at: at(59) }

  // Full to compact: a newer long answer can't fit in full, so a shorter older one stays compact.
  const fullBoundary = [sized(1, 'x'), sized(2, 'y'.repeat(200), read), sized(3, 'z', read)]
  const newestFull = answerMemberBytes(fullBoundary[2].full!)
  budgetAnswers(
    fullBoundary,
    newestFull +
      answerMemberBytes(fullBoundary[1].compact) +
      answerMemberBytes(fullBoundary[0].full!),
  )
  assert.equal(fullBoundary[2].question.answer, fullBoundary[2].full)
  assert.equal(fullBoundary[1].question.answer, fullBoundary[1].compact)
  assert.equal(fullBoundary[0].question.answer, fullBoundary[0].compact)

  // Compact to none: a newer compact member with a read time doesn't fit, so a smaller older
  // runner one without delivery gets none too.
  const noneBoundary = [sized(1, 'x'), sized(2, 'y', read)]
  const olderCompact = answerMemberBytes(noneBoundary[0].compact)
  assert.ok(olderCompact < answerMemberBytes(noneBoundary[1].compact))
  budgetAnswers(noneBoundary, olderCompact)
  assert.equal(noneBoundary[1].question.answer, undefined)
  assert.equal(noneBoundary[0].question.answer, undefined)
})
