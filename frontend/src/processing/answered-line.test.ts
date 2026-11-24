import { describe, expect, it } from 'vitest'
import {
  answered,
  choiceQuestion,
  fullAnswer,
  quantityQuestion,
  Q,
} from '#/test/answered-questions'
import { answeredLine, newestAnsweredFirst } from './answered-line'
import { sentAnswerValues } from './answer-outcomes'

const stage = 'Examine'

describe('answeredLine', () => {
  it('says what was chosen and that it waits for the running session', () => {
    const line = answeredLine({
      question: answered(choiceQuestion(), fullAnswer('Contents verified')),
      sessionState: 'running',
      stage,
    })
    expect(line.icon).toBe('clock')
    expect(line.answer).toEqual({ verb: 'You chose', text: 'Contents verified' })
    expect(line.status).toBe('waiting for Examine to read it')
  })

  it('says a session that isn’t running reads it when it resumes', () => {
    for (const sessionState of ['waiting_input', 'queued', 'finished'] as const) {
      const line = answeredLine({
        question: answered(choiceQuestion(), fullAnswer('Contents verified')),
        sessionState,
        stage,
      })
      expect(line.status).toBe('Examine will read it when it resumes')
    }
  })

  it('turns the clock into a tick once read, with its time when one was kept', () => {
    const read = answeredLine({
      question: answered(
        choiceQuestion(),
        fullAnswer('Contents verified', {
          delivery: { state: 'read', read_at: '2026-11-24T02:14:00.000Z' },
        }),
      ),
      stage,
    })
    expect(read.icon).toBe('tick')
    expect(read.status).toBe('Examine read it')
    expect(read.readAt).toBe('2026-11-24T02:14:00.000Z')
    const untimed = answeredLine({
      question: answered(
        choiceQuestion(),
        fullAnswer('Contents verified', { delivery: { state: 'read', read_at: null } }),
      ),
      stage,
    })
    expect(untimed.icon).toBe('tick')
    expect(untimed.readAt).toBeNull()
  })

  it('shows a confirmed answer as saved until a read returns the question answered', () => {
    const question = choiceQuestion()
    const values = sentAnswerValues(question, {
      schema_version: 'bench-intake-answer/2',
      expected_question_revision: '1',
      expected_capture_revision: '8',
      attempt_id: Q.attempt,
      input_sha256: 'a'.repeat(64),
      steps: [{ step_id: 'labels', value: { kind: 'choice', option_id: 'verified' } }],
    })
    const confirmed = { questionId: question.id, answerId: Q.answer, values, savedAt: 'x' }
    const saved = answeredLine({ question, confirmed, sessionState: 'running', stage })
    expect(saved.icon).toBe('saved')
    expect(saved.answer?.text).toBe('Contents verified')
    expect(saved.status).toBe('saved')
    // Once the read has it, the read wins and the delivery shows.
    const read = answeredLine({
      question: answered(question, fullAnswer('Contents verified')),
      confirmed,
      sessionState: 'running',
      stage,
    })
    expect(read.icon).toBe('clock')
  })

  it('marks cut values and labels a several-value answer as answered', () => {
    const line = answeredLine({
      question: answered(
        quantityQuestion(),
        fullAnswer('186 · counted', {
          values: [{ step_id: null, prompt: 'How many?', text: 'a'.repeat(200), truncated: true }],
          delivery: undefined,
        }),
      ),
      stage,
    })
    expect(line.answer).toEqual({ verb: 'You answered', text: `${'a'.repeat(200)}…` })
    // An earlier runner's answer has no inbox, so nothing about reading.
    expect(line.status).toBeNull()
    expect(line.icon).toBe('answered')
  })

  it('falls back to the session, or to no details, when the values had no room', () => {
    const compact = answered(choiceQuestion(), {
      answered_at: '2026-11-24T02:12:00.000Z',
      values_omitted: true,
      delivery: { state: 'read', read_at: null },
    })
    expect(answeredLine({ question: compact, stage }).status).toBe(
      'Answered · see the session · Examine read it',
    )
    const runner = answered(choiceQuestion(5, { session_history: false }), {
      answered_at: '2026-11-24T02:12:00.000Z',
      values_omitted: true,
    })
    expect(answeredLine({ question: runner, stage }).status).toBe('Answered · details not shown')
    const stateOnly = answeredLine({ question: answered(choiceQuestion()), stage })
    expect(stateOnly.status).toBe('Answered · see the session')
    expect(stateOnly.answeredAt).toBeNull()
  })
})

describe('newestAnsweredFirst', () => {
  it('puts the newest answer first and untimed answers last in the order asked', () => {
    const lines = [
      answered(choiceQuestion(1)),
      answered(choiceQuestion(2), fullAnswer('a', { answered_at: '2026-11-24T02:10:00.000Z' })),
      answered(choiceQuestion(3), fullAnswer('b', { answered_at: '2026-11-24T02:20:00.000Z' })),
      answered(choiceQuestion(0)),
    ].map((question) => ({ question, line: answeredLine({ question, stage }) }))
    expect(newestAnsweredFirst(lines).map((item) => item.question.id)).toEqual([
      Q.question(3),
      Q.question(2),
      Q.question(0),
      Q.question(1),
    ])
  })
})
