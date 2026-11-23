import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_QUESTION_STEP_ID,
  questionView,
  validate,
  validationIssues,
  type ProcessingAnswerV2Dto,
  type ProcessingQuestionDto,
} from '../src/index.ts'
import { IntakeRequestError, processingClient } from '../generated/client.ts'

const id = (n: number) => `7c3e1d04-92ab-4f6e-b81d-${n.toString(16).padStart(12, '0')}`
const digest = (c: string) => c.repeat(64)

const choiceStep = {
  id: 'variant',
  prompt: 'Which part is it?',
  assumption: 'Working on ATmega328P-AU.',
  answer: {
    kind: 'choice',
    options: [
      { id: 'p', label: 'ATmega328P-AU' },
      { id: 'pb', label: 'ATmega328PB-AU', detail: 'The PB has a second UART.' },
    ],
    other: true,
  },
}
const numberStep = {
  id: 'left',
  prompt: 'How many are left?',
  assumption: 'Estimated 380.',
  answer: { kind: 'number' },
}
const textStep = {
  id: 'where',
  prompt: 'Where does it go?',
  assumption: 'Drawer R4.',
  answer: { kind: 'text' },
}
const ask = {
  schema_version: 'bench-intake-question/2',
  subject_id: id(1),
  reason: 'The packets differ in date code.',
  fields: ['identity', 'quantity'],
  title: 'Same Part, count and place',
  steps: [choiceStep, numberStep, textStep],
}

function issuePaths(name: Parameters<typeof validationIssues>[0], value: unknown) {
  return validationIssues(name, value).map((issue) => issue.path)
}

test('a /2 ask holds 1 to 4 steps, each with a prompt, an assumption and an answer kind', () => {
  validate('SessionAskArgsV2', ask)
  validate('SessionAskArgsV2', { ...ask, title: undefined, steps: [choiceStep] })
  const { title: _title, ...untitled } = ask
  validate('SessionAskArgsV2', untitled)
  validate('SessionAskArgsV2', { ...ask, subject_id: null })
  validate('SessionAskArgsV2', { ...ask, steps: [choiceStep, numberStep, textStep, textStep] })
  assert.ok(
    issuePaths('SessionAskArgsV2', { ...ask, steps: [...ask.steps, textStep, textStep] }).some(
      (path) => path.startsWith('/steps'),
    ),
  )
  assert.ok(issuePaths('SessionAskArgsV2', { ...ask, steps: [] }).includes('/steps'))
  const { assumption: _assumption, ...noAssumption } = textStep
  assert.ok(
    issuePaths('SessionAskArgsV2', { ...ask, steps: [noAssumption] }).includes(
      '/steps/0/assumption',
    ),
  )
  assert.throws(() => validate('SessionAskArgsV2', { ...ask, fields: [] }))
  const { fields: _fields, ...noFields } = ask
  assert.throws(() => validate('SessionAskArgsV2', noFields))
  // The /1 shape is refused by the /2 schema, with issues showing the /2 shape.
  assert.ok(
    validationIssues('SessionAskArgsV2', {
      kind: 'quantity',
      subject_id: id(1),
      prompt: 'How many?',
      reason: 'Torn label.',
      fields: ['quantity'],
      assumption: 'Ten.',
    }).length,
  )
})

test('a /2 ask bounds options, labels, details, prompts and the title', () => {
  const withOptions = (options: unknown[]) => ({
    ...ask,
    steps: [{ ...choiceStep, answer: { ...choiceStep.answer, options } }],
  })
  const option = (n: number) => ({ id: `o${n}`, label: `Option ${n}` })
  validate('SessionAskArgsV2', withOptions([1, 2, 3, 4, 5, 6].map(option)))
  assert.ok(
    issuePaths('SessionAskArgsV2', withOptions([option(1)])).includes('/steps/0/answer/options'),
  )
  assert.ok(
    issuePaths('SessionAskArgsV2', withOptions([1, 2, 3, 4, 5, 6, 7].map(option))).includes(
      '/steps/0/answer/options',
    ),
  )
  validate('SessionAskArgsV2', withOptions([option(1), { id: 'x', label: 'x'.repeat(80) }]))
  assert.ok(
    issuePaths(
      'SessionAskArgsV2',
      withOptions([option(1), { id: 'x', label: 'x'.repeat(81) }]),
    ).includes('/steps/0/answer/options/1/label'),
  )
  validate(
    'SessionAskArgsV2',
    withOptions([option(1), { id: 'x', label: 'x', detail: 'd'.repeat(160) }]),
  )
  assert.throws(() =>
    validate(
      'SessionAskArgsV2',
      withOptions([option(1), { id: 'x', label: 'x', detail: 'd'.repeat(161) }]),
    ),
  )
  assert.throws(() =>
    validate('SessionAskArgsV2', withOptions([option(1), { id: 'Bad ID', label: 'x' }])),
  )
  validate('SessionAskArgsV2', { ...ask, steps: [{ ...textStep, prompt: 'p'.repeat(500) }] })
  assert.ok(
    issuePaths('SessionAskArgsV2', {
      ...ask,
      steps: [{ ...textStep, prompt: 'p'.repeat(501) }],
    }).includes('/steps/0/prompt'),
  )
  validate('SessionAskArgsV2', { ...ask, title: 't'.repeat(120) })
  assert.throws(() => validate('SessionAskArgsV2', { ...ask, title: 't'.repeat(121) }))
  assert.throws(() =>
    validate('SessionAskArgsV2', {
      ...ask,
      steps: [{ ...choiceStep, answer: { kind: 'choice', options: choiceStep.answer.options } }],
    }),
  )
})

const answerBase = {
  schema_version: 'bench-intake-answer/2',
  expected_question_revision: '1',
  expected_capture_revision: '3',
  attempt_id: id(2),
  input_sha256: digest('a'),
}

test('a /2 answer gives one value per step, and a /1 answer still validates', () => {
  validate('ProcessingAnswer', {
    ...answerBase,
    steps: [
      { step_id: 'variant', value: { kind: 'choice', option_id: 'pb' } },
      { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
      { step_id: 'where', value: { kind: 'text', text: 'Drawer R4' } },
    ],
  })
  validate('ProcessingAnswer', {
    ...answerBase,
    steps: [
      { step_id: 'variant', value: { kind: 'choice', other: 'A clone' } },
      { step_id: 'left', value: { kind: 'text', text: 'Still sealed in the reel' } },
    ],
  })
  validate('ProcessingAnswer', {
    ...answerBase,
    schema_version: 'bench-intake-answer/1',
    value: { kind: 'quantity', value: '10', basis: 'counted' },
  })
  const refused = [
    { ...answerBase, steps: [] },
    { ...answerBase, steps: Array(5).fill({ step_id: 'a', value: { kind: 'text', text: 'x' } }) },
    {
      ...answerBase,
      steps: [{ step_id: 'a', value: { kind: 'number', value: 'about 380', basis: 'counted' } }],
    },
    {
      ...answerBase,
      steps: [{ step_id: 'a', value: { kind: 'choice', option_id: 'p', other: 'x' } }],
    },
    { ...answerBase, steps: [{ step_id: 'a', value: { kind: 'text', text: 'x'.repeat(2049) } }] },
    { ...answerBase, value: { kind: 'quantity', value: '10', basis: 'counted' } },
  ]
  for (const value of refused) {
    assert.throws(() => validate('ProcessingAnswer', value))
  }
})

const sessionBinding = {
  schema_version: 'bench-intake-session/1',
  job_id: id(3),
  attempt_id: id(2),
  command_id: id(4),
  input_sha256: digest('b'),
  sequence: '2',
}

test('the session envelope and inbox read both question and answer versions', () => {
  validate('SessionEnvelope', { ...sessionBinding, kind: 'question', payload: ask })
  validate('SessionEnvelope', {
    ...sessionBinding,
    kind: 'question',
    payload: {
      kind: 'quantity',
      subject_id: id(1),
      prompt: 'How many?',
      reason: 'Torn label.',
      fields: ['quantity'],
      assumption: 'Ten.',
    },
  })
  const inboxBase = { id: id(5), seq: '1', created_at: '2026-11-23T01:02:03.004Z', kind: 'answer' }
  validate('SessionInboxItem', {
    ...inboxBase,
    payload: {
      question_id: id(6),
      answer_id: id(7),
      value: { kind: 'clarification', text: 'Same part.' },
    },
  })
  validate('SessionInboxItem', {
    ...inboxBase,
    payload: {
      question_id: id(6),
      answer_id: id(7),
      steps: [
        { step_id: 'variant', value: { kind: 'choice', option_id: 'pb', label: 'ATmega328PB-AU' } },
        { step_id: 'left', value: { kind: 'number', value: '380', basis: 'estimated' } },
        { step_id: 'where', value: { kind: 'text', text: 'Drawer R4' } },
      ],
    },
  })
  // A delivered option carries its label.
  assert.throws(() =>
    validate('SessionInboxItem', {
      ...inboxBase,
      payload: {
        question_id: id(6),
        answer_id: id(7),
        steps: [{ step_id: 'variant', value: { kind: 'choice', option_id: 'pb' } }],
      },
    }),
  )
})

const questionBase = {
  id: id(8),
  job_id: id(3),
  attempt_id: id(2),
  input_sha256: digest('a'),
  revision: '1',
  state: 'open',
  subject_id: id(1),
}

test('the read model sends each question once, in its version, and questionView normalises both', () => {
  const stepped = {
    ...questionBase,
    schema_version: 'bench-intake-question/2',
    fields: ask.fields,
    title: ask.title,
    reason: ask.reason,
    steps: ask.steps,
  }
  validate('ProcessingQuestion', stepped)
  assert.throws(() =>
    validate('ProcessingQuestion', {
      ...stepped,
      spec: { kind: 'quantity', prompt: 'How many?', reason: 'Torn label.' },
    }),
  )
  const sessionV1 = {
    ...questionBase,
    spec: { kind: 'quantity', prompt: 'How many?', reason: 'Torn label.' },
    fields: ['quantity'],
    assumption: 'Ten.',
  }
  const runner = {
    ...questionBase,
    spec: { kind: 'clarification', prompt: 'Which variant?', reason: 'Two markings.' },
  }
  validate('ProcessingQuestion', sessionV1)
  validate('ProcessingQuestion', runner)

  const view = questionView(stepped as ProcessingQuestionDto)
  assert.equal(view.version, 2)
  assert.equal(view.title, 'Same Part, count and place')
  assert.deepEqual(
    view.steps.map((step) => [step.id, step.answer.kind, step.assumption]),
    [
      ['variant', 'choice', 'Working on ATmega328P-AU.'],
      ['left', 'number', 'Estimated 380.'],
      ['where', 'text', 'Drawer R4.'],
    ],
  )
  const { title: _title, ...untitled } = stepped
  assert.equal(questionView(untitled as ProcessingQuestionDto).title, 'Which part is it?')

  assert.deepEqual(questionView(sessionV1 as ProcessingQuestionDto), {
    version: 1,
    title: 'How many?',
    reason: 'Torn label.',
    steps: [
      {
        id: LEGACY_QUESTION_STEP_ID,
        prompt: 'How many?',
        assumption: 'Ten.',
        answer: { kind: 'number' },
        legacy_kind: 'quantity',
      },
    ],
  })
  const runnerView = questionView(runner as ProcessingQuestionDto)
  assert.equal(runnerView.steps[0].answer.kind, 'text')
  // An earlier runner question recorded no assumption, and the view doesn't invent one.
  assert.equal(runnerView.steps[0].assumption, null)
})

test('an invalid answer may name its step, and the client keeps it on the error', async () => {
  const body = {
    code: 'invalid_answer',
    message: 'Processing request could not be accepted.',
    recovery: 'none',
    correlation_id: 'c',
    step_id: 'left',
  }
  validate('ErrorDto', body)
  assert.throws(() => validate('ErrorDto', { ...body, step_id: 'Not a step' }))
  const client = processingClient('http://127.0.0.1:4310', '', async () =>
    Response.json(body, { status: 422 }),
  )
  const input: ProcessingAnswerV2Dto = {
    ...answerBase,
    schema_version: 'bench-intake-answer/2',
    steps: [{ step_id: 'left', value: { kind: 'number', value: '380', basis: 'counted' } }],
  }
  await assert.rejects(
    client.answer(id(1), id(8), input, id(9)),
    (error) =>
      error instanceof IntakeRequestError &&
      error.status === 422 &&
      error.code === 'invalid_answer' &&
      error.stepId === 'left',
  )
  const { step_id: _step, ...unnamed } = body
  const plain = processingClient('http://127.0.0.1:4310', '', async () =>
    Response.json(unnamed, { status: 422 }),
  )
  await assert.rejects(
    plain.answer(id(1), id(8), input, id(9)),
    (error) => error instanceof IntakeRequestError && error.stepId === undefined,
  )
})

test('an attention question item carries each step kind and assumption', () => {
  const item = {
    key: `question:${id(8)}`,
    group: 'question',
    tab: 'processing',
    title: 'Same Part, count and place',
    detail: 'Working on ATmega328P-AU.',
    route: `${id(1)}/processing/research/${id(8)}`,
    question: {
      steps: [
        { kind: 'choice', options: 2, assumption: 'Working on ATmega328P-AU.' },
        { kind: 'number', assumption: 'Estimated 380.' },
        { kind: 'text', assumption: null },
      ],
    },
  }
  validate('AttentionItem', item)
  assert.throws(() =>
    validate('AttentionItem', {
      ...item,
      question: { steps: [{ kind: 'choice', options: 1, assumption: null }] },
    }),
  )
})
