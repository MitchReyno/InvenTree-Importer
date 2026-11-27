import { IntakeRequestError } from '@invimport/contracts/client'
import {
  validate,
  type MatchAnswerDto,
  type MatchAnswerRecordDto,
  type MatchQuestionDto,
  type QuestionView,
} from '@invimport/contracts'
import type { QuestionStanding } from './question-standing'
import { stepValue, type StepDraft } from './stepped-answer'
import { partCandidates, partName } from './match-view'

/** A match question read as the stepped form reads a question: its title over its one step. */
export function matchQuestionView(question: MatchQuestionDto): QuestionView {
  return {
    version: 2,
    title: question.title,
    // The later lines repeat the candidates, which the card lists in full.
    reason: question.reason.split('\n')[0],
    steps: question.steps.map((step) => ({
      id: step.id,
      prompt: step.prompt,
      assumption: step.assumption,
      answer: step.answer,
    })),
  }
}

/** The answer the form's drafts make, pinned to the question's revision. */
export function matchAnswerInput(
  question: MatchQuestionDto,
  drafts: readonly StepDraft[],
): MatchAnswerDto {
  const input: MatchAnswerDto = {
    expected_question_revision: question.revision,
    steps: question.steps.map((step, index) => ({
      step_id: step.id,
      value: stepValue(drafts[index]),
    })),
  }
  validate('MatchAnswer', input)
  return Object.freeze(input)
}

/**
 * Why a pinned match question can or can't take a new answer, from the latest Match read and the
 * form's own confirmed answer. A newer search replaces the question rather than reopening it.
 */
export function matchStanding(
  pinned: MatchQuestionDto,
  current: MatchQuestionDto | undefined,
  answeredHere: boolean,
): QuestionStanding {
  if (answeredHere) {
    return 'answered_here'
  }
  if (!current) {
    return 'gone'
  }
  if (current.state === 'answered') {
    return 'answered_elsewhere'
  }
  if (current.state === 'superseded') {
    return 'replaced'
  }

  return current.revision === pinned.revision ? 'open' : 'closed'
}

/** The server read the answer and refused it: the question moved on, or the answer was invalid. */
export function matchAnswerRefusal(failure: unknown) {
  if (!(failure instanceof IntakeRequestError)) {
    return null
  }
  if (failure.status === 409 && failure.code === 'stale_question') {
    return { kind: 'stale' as const }
  }
  // A newer search is pending: the same question may be answered once it settles.
  if (failure.status === 409 && failure.code === 'match_waiting') {
    return {
      kind: 'retry' as const,
      message: 'Match is searching again for this lot. Send your answer once it finishes.',
    }
  }
  if (failure.status === 422 && failure.code === 'invalid_match_answer') {
    return { kind: 'invalid' as const }
  }

  return null
}

/** The option the batch answer picks for each question: add stock to its first, exact Part. */
export const BATCH_ADD_STOCK_OPTION = 'add_stock_1'

/**
 * Open questions the batch answer "Add stock to each" can take: each asks about candidates, and
 * its first option adds stock to an exact Part candidate.
 */
export function batchAddStockQuestions(questions: readonly MatchQuestionDto[]) {
  return questions.filter((question) => {
    if (question.state !== 'open' || question.kind !== 'candidates') {
      return false
    }
    const [step] = question.steps
    const first = step?.answer.kind === 'choice' ? step.answer.options[0] : undefined
    const [part] = partCandidates(question.candidates)

    return first?.id === BATCH_ADD_STOCK_OPTION && part?.verdict === 'exact'
  })
}

/** The exact Part a batch answer adds a question's lot's stock to. */
export function batchTarget(question: MatchQuestionDto) {
  const [part] = partCandidates(question.candidates)

  return part ? partName(part) : undefined
}

/** What the operator decided, from Match's record of the answer. */
export function answerWords(question: MatchQuestionDto, answer: MatchAnswerRecordDto) {
  if (answer.text) {
    return `Something else: “${answer.text}”`
  }
  const part = partCandidates(question.candidates).find(
    (candidate) => candidate.part.pk === answer.part_pk,
  )
  const name = part ? partName(part) : 'the existing Part'
  switch (answer.decision) {
    case 'add_stock':
      return `Add stock to ${name}`
    case 'fill_gaps':
      return `Add stock to ${name}, and fill what’s missing`
    case 'new_part':
      return 'It’s a new Part'
    case 'already_imported':
      return 'Already imported: the lot is left out'
    case undefined:
      return 'Answered'
  }
}

/** Match commands' own refusals in words; anything else leaves the outcome unknown. */
export function matchCommandFailure(failure: unknown) {
  if (failure instanceof IntakeRequestError) {
    switch (failure.code) {
      case 'match_waiting':
        return 'Match is still searching or waiting for your answer for this lot.'
      case 'match_not_searchable':
        return 'Match has nothing to search InvenTree with for a lot yet.'
      case 'stale_question':
        return 'A newer search replaced these questions. Check them again before answering.'
      case 'batch_archived':
        return 'The batch is archived. Resume it to change its matches.'
    }
  }

  return 'Not confirmed: the server didn’t answer. Check the lots before trying again.'
}
