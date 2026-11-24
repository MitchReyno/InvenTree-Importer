import {
  validate,
  type ProcessingAnswerSummaryDto,
  type ProcessingQuestionDto,
  type ProcessingQuestionV1Dto,
  type ProcessingQuestionV2Dto,
} from '@invimport/contracts'

export const Q = {
  job: '30000000-0000-4000-8000-000000000003',
  attempt: '40000000-0000-4000-8000-000000000004',
  lot: '20000000-0000-4000-8000-000000000002',
  answer: 'c0000000-0000-4000-8000-000000000003',
  question: (n: number) => `50000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
}

const base = (n: number) => ({
  id: Q.question(n),
  job_id: Q.job,
  attempt_id: Q.attempt,
  input_sha256: 'a'.repeat(64),
  revision: '1',
  state: 'open' as const,
  subject_id: Q.lot,
  asked_at: `2026-11-24T02:0${n % 10}:00.000Z`,
  session_history: true,
})

/** A one-step choice question from Examine about Packet A. */
export function choiceQuestion(n = 5, extra: Partial<ProcessingQuestionV2Dto> = {}) {
  const question: ProcessingQuestionV2Dto = {
    ...base(n),
    schema_version: 'bench-intake-question/2',
    fields: ['identity'],
    reason: 'Sealed packages may not show all contents.',
    steps: [
      {
        id: 'labels',
        prompt: 'Are package labels reliable descriptions of their current contents?',
        assumption: 'Treat labels as provisional identification.',
        answer: {
          kind: 'choice',
          options: [
            { id: 'unchecked', label: 'Not checked' },
            { id: 'verified', label: 'Contents verified' },
          ],
          other: true,
        },
      },
    ],
    ...extra,
  }
  validate('ProcessingQuestion', question)
  return question
}

/** A `/1` number question, as a session asked it before stepped questions. */
export function quantityQuestion(n = 6, extra: Partial<ProcessingQuestionV1Dto> = {}) {
  const question: ProcessingQuestionV1Dto = {
    ...base(n),
    spec: {
      kind: 'quantity',
      prompt: 'How many 1N4148 diodes are in the loose bag?',
      reason: 'The bag is half full; about 200 by eye.',
    },
    fields: ['quantity'],
    assumption: '200 (estimate)',
    ...extra,
  }
  validate('ProcessingQuestion', question)
  return question
}

export const fullAnswer = (
  text: string,
  extra: Partial<Extract<ProcessingAnswerSummaryDto, { values: unknown }>> = {},
): ProcessingAnswerSummaryDto => ({
  answer_id: Q.answer,
  answered_at: '2026-11-24T02:12:00.000Z',
  values: [{ step_id: 'labels', prompt: 'Are package labels reliable?', text, truncated: false }],
  effects: [{ kind: 'note', subject_id: Q.lot }],
  delivery: { state: 'waiting', read_at: null },
  ...extra,
})

/** The question, answered with the given summary, or with none for the state-only tier. */
export function answered<T extends ProcessingQuestionDto>(
  question: T,
  answer?: ProcessingAnswerSummaryDto,
): T {
  const value = { ...question, state: 'answered' as const, revision: '2', ...(answer ? { answer } : {}) }
  validate('ProcessingQuestion', value)
  return value
}
