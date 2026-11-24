import { describe, expect, it } from 'vitest'
import { answered, choiceQuestion, fullAnswer, Q } from '#/test/answered-questions'
import { questionStanding, standingWarning, type StandingInput } from './question-standing'

const pinned = choiceQuestion()

function standing(input: Partial<StandingInput>) {
  return questionStanding({
    pinned,
    pinnedCaptureRevision: '8',
    current: pinned,
    currentCaptureRevision: '8',
    answeredHere: false,
    ...input,
  })
}

describe('questionStanding', () => {
  it('names why a pinned form is or is not answerable', () => {
    expect(standing({})).toBe('open')
    expect(standing({ currentCaptureRevision: '9' })).toBe('context_moved')
    expect(standing({ answeredHere: true, current: answered(pinned, fullAnswer('x')) })).toBe(
      'answered_here',
    )
    expect(standing({ current: answered(pinned, fullAnswer('x')) })).toBe('answered_elsewhere')
    expect(
      standing({ current: { ...pinned, state: 'superseded', replaced_by: Q.question(9) } }),
    ).toBe('replaced')
    expect(standing({ current: { ...pinned, state: 'superseded' } })).toBe('closed')
    expect(standing({ current: undefined })).toBe('gone')
  })

  it('reads a confirmed answer as answered here even before any read returns it', () => {
    expect(standing({ answeredHere: true })).toBe('answered_here')
    expect(standing({ answeredHere: true, current: undefined })).toBe('answered_here')
  })
})

describe('standingWarning', () => {
  it('warns only for a form that can no longer send what it holds', () => {
    expect(standingWarning('open', false)).toBeNull()
    expect(standingWarning('answered_here', false)).toBeNull()
    expect(standingWarning('context_moved', false)).toMatch(/^Its saved context changed/)
    expect(standingWarning('answered_elsewhere', false)).toBe(
      'Answered elsewhere; your unsaved answer can’t be sent.',
    )
    for (const closed of ['replaced', 'closed', 'gone'] as const) {
      expect(standingWarning(closed, false)).toMatch(/superseded/)
      // An unconfirmed retry may still send its exact original answer.
      expect(standingWarning(closed, true)).toMatch(/Try again sends only the original/)
    }
  })
})
